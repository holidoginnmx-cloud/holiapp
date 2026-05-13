import { FastifyInstance } from "fastify";
import {
  CreatePetSchema,
  UpdatePetSchema,
  CreateVaccineSchema,
  CreateDewormingSchema,
} from "@holidoginn/shared";
import { createAuthMiddleware } from "../middleware/auth";
import { notifyUsers } from "../lib/notify";

export default async function petsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  const isStaffOrAdmin = (role?: string) => role === "ADMIN" || role === "STAFF";
  const isAdmin = (role?: string) => role === "ADMIN";

  // Notifica a todos los admins que hay una cartilla pendiente de revisión.
  async function notifyAdminsNewCartilla(
    petId: string,
    petName: string,
    ownerName: string
  ) {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      select: { id: true },
    });
    if (admins.length === 0) return;
    await notifyUsers(
      prisma,
      admins.map((a) => a.id),
      {
        type: "GENERAL",
        title: "Cartilla pendiente de revisión",
        body: `${ownerName} subió la cartilla de ${petName}. Revisa en Cartillas.`,
        data: { petId, kind: "CARTILLA_UPLOADED" },
      }
    );
  }

  // GET /pets — OWNER sees only own pets; STAFF/ADMIN can filter by any ownerId
  fastify.get<{ Querystring: { ownerId?: string } }>(
    "/pets",
    { preHandler: [authMiddleware] },
    async (request) => {
      const { ownerId: queryOwnerId } = request.query;
      const filterOwnerId = isStaffOrAdmin(request.userRole)
        ? queryOwnerId
        : request.userId;

      const pets = await prisma.pet.findMany({
        where: {
          ...(filterOwnerId ? { ownerId: filterOwnerId } : {}),
          isActive: true,
        },
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, email: true } },
          vaccines: {
            orderBy: { appliedAt: "desc" },
            include: {
              catalog: { select: { id: true, code: true, displayName: true } },
            },
          },
          reservations: {
            where: {
              status: { in: ["CONFIRMED", "CHECKED_IN"] },
            },
            select: {
              id: true,
              checkIn: true,
              checkOut: true,
              status: true,
              paymentType: true,
              totalAmount: true,
              payments: {
                where: { status: { in: ["PAID", "PARTIAL"] } },
                select: { amount: true },
              },
            },
            orderBy: { checkIn: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      return pets.map((p) => ({
        ...p,
        reservations: p.reservations.map((r) => {
          const totalPaid = r.payments.reduce(
            (sum, pay) => sum + Number(pay.amount),
            0,
          );
          const { payments: _, ...rest } = r;
          return {
            ...rest,
            hasBalance: Number(r.totalAmount) - totalPaid > 0.01,
          };
        }),
      }));
    }
  );

  // GET /pets/:id — obtener uno con vacunas (owner o staff/admin)
  fastify.get<{ Params: { id: string } }>(
    "/pets/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const pet = await prisma.pet.findUnique({
        where: { id: request.params.id },
        include: {
          vaccines: {
            orderBy: { appliedAt: "desc" },
            include: {
              catalog: { select: { id: true, code: true, displayName: true } },
            },
          },
          owner: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      if (!isStaffOrAdmin(request.userRole) && pet.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      return pet;
    }
  );

  // POST /pets — crear (solo para sí mismo, salvo ADMIN)
  fastify.post(
    "/pets",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CreatePetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      if (!isAdmin(request.userRole) && parsed.data.ownerId !== request.userId) {
        return reply
          .status(403)
          .send({ error: "Solo puedes crear mascotas para tu propia cuenta" });
      }

      const owner = await prisma.user.findUnique({ where: { id: parsed.data.ownerId } });
      if (!owner) {
        return reply.status(404).send({ error: "Dueño no encontrado" });
      }

      // Si el owner subió cartilla en el create (uno o más fotos), marcar PENDING.
      // Soportamos tanto `cartillaUrl` (legacy, single) como `cartillaPhotos`
      // (nuevo, array). Si llega `cartillaUrl` y no `cartillaPhotos`, lo
      // promovemos al array para que el flujo nuevo lo encuentre.
      const photos =
        parsed.data.cartillaPhotos && parsed.data.cartillaPhotos.length > 0
          ? parsed.data.cartillaPhotos
          : parsed.data.cartillaUrl
            ? [parsed.data.cartillaUrl]
            : [];
      const hasCartilla = photos.length > 0;
      const cartillaStatus = hasCartilla ? "PENDING" as const : null;
      const pet = await prisma.pet.create({
        data: {
          ...parsed.data,
          cartillaPhotos: photos,
          cartillaUrl: parsed.data.cartillaUrl ?? photos[0] ?? null,
          cartillaStatus,
        },
      });

      if (cartillaStatus === "PENDING") {
        await notifyAdminsNewCartilla(
          pet.id,
          pet.name,
          `${owner.firstName} ${owner.lastName}`
        );
      }

      return reply.status(201).send(pet);
    }
  );

  // PATCH /pets/:id — actualizar (owner del pet o admin)
  fastify.patch<{ Params: { id: string } }>(
    "/pets/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = UpdatePetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const pet = await prisma.pet.findUnique({ where: { id: request.params.id } });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      // Staff y admin pueden editar cualquier mascota; owner solo la suya.
      if (!isStaffOrAdmin(request.userRole) && pet.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      // Si cambió la cartilla, resetear el estado de revisión a PENDING.
      // Owners no pueden setear cartillaStatus (el schema lo excluye).
      // Staff editando un perfil NO puede modificar cartilla (debe pasar por
      // el flujo de revisión de admin).
      const data: Record<string, unknown> = { ...parsed.data };
      if (request.userRole === "STAFF") {
        delete data.cartillaUrl;
        delete data.cartillaPhotos;
      }

      const incomingPhotos = data.cartillaPhotos as string[] | undefined;
      const incomingUrl = data.cartillaUrl as string | null | undefined;
      const photosChanged =
        incomingPhotos !== undefined &&
        JSON.stringify(incomingPhotos) !== JSON.stringify(pet.cartillaPhotos);
      const urlChanged =
        incomingUrl !== undefined && incomingUrl !== pet.cartillaUrl;

      if (photosChanged || urlChanged) {
        // Normalizamos: si llegó cartillaUrl pero no cartillaPhotos, lo promovemos
        // al array (y viceversa para mantener compatibilidad con clients viejos).
        if (incomingPhotos === undefined && incomingUrl !== undefined) {
          data.cartillaPhotos = incomingUrl ? [incomingUrl] : [];
        }
        if (incomingUrl === undefined && incomingPhotos !== undefined) {
          data.cartillaUrl = incomingPhotos[0] ?? null;
        }
        const finalPhotos = (data.cartillaPhotos as string[] | undefined) ?? [];
        data.cartillaStatus = finalPhotos.length > 0 ? "PENDING" : null;
        data.cartillaReviewedAt = null;
        data.cartillaReviewedById = null;
        data.cartillaRejectionReason = null;
      }

      const updated = await prisma.pet.update({
        where: { id: request.params.id },
        data,
      });

      if (data.cartillaStatus === "PENDING") {
        const ownerRecord = await prisma.user.findUnique({
          where: { id: pet.ownerId },
          select: { firstName: true, lastName: true },
        });
        if (ownerRecord) {
          await notifyAdminsNewCartilla(
            updated.id,
            updated.name,
            `${ownerRecord.firstName} ${ownerRecord.lastName}`
          );
        }
      }

      return updated;
    }
  );

  // POST /pets/:id/vaccines — agregar vacuna (owner del pet o staff/admin)
  fastify.post<{ Params: { id: string } }>(
    "/pets/:id/vaccines",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CreateVaccineSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const pet = await prisma.pet.findUnique({ where: { id: request.params.id } });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      if (!isStaffOrAdmin(request.userRole) && pet.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      // Validar catalogId contra el catálogo activo; siempre derivamos `name`
      // del catálogo (no confiamos en el cliente para el nombre canónico).
      const catalog = await prisma.vaccineCatalog.findFirst({
        where: { id: parsed.data.catalogId, isActive: true },
      });
      if (!catalog) {
        return reply.status(400).send({ error: "Tipo de vacuna inválido" });
      }

      const vaccine = await prisma.vaccine.create({
        data: {
          ...parsed.data,
          name: catalog.displayName,
          petId: request.params.id,
        },
      });
      return reply.status(201).send(vaccine);
    }
  );

  // GET /pets/:id/dewormings — listar desparasitaciones
  fastify.get<{ Params: { id: string } }>(
    "/pets/:id/dewormings",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const pet = await prisma.pet.findUnique({ where: { id: request.params.id } });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      if (!isStaffOrAdmin(request.userRole) && pet.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      const dewormings = await prisma.deworming.findMany({
        where: { petId: request.params.id },
        orderBy: { appliedAt: "desc" },
      });
      return dewormings;
    }
  );

  // POST /pets/:id/dewormings — registrar desparasitación
  fastify.post<{ Params: { id: string } }>(
    "/pets/:id/dewormings",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CreateDewormingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const pet = await prisma.pet.findUnique({ where: { id: request.params.id } });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      if (!isStaffOrAdmin(request.userRole) && pet.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      const deworming = await prisma.deworming.create({
        data: { ...parsed.data, petId: request.params.id },
      });
      return reply.status(201).send(deworming);
    }
  );

  // DELETE /pets/:petId/dewormings/:id — eliminar desparasitación
  fastify.delete<{ Params: { petId: string; id: string } }>(
    "/pets/:petId/dewormings/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const deworming = await prisma.deworming.findUnique({
        where: { id: request.params.id },
      });
      if (!deworming || deworming.petId !== request.params.petId) {
        return reply.status(404).send({ error: "Desparasitación no encontrada" });
      }
      const pet = await prisma.pet.findUnique({ where: { id: deworming.petId } });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      if (!isStaffOrAdmin(request.userRole) && pet.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      await prisma.deworming.delete({ where: { id: deworming.id } });
      return reply.status(204).send();
    }
  );

  // GET /pets/:id/history — historial de estancias (owner o staff/admin)
  fastify.get<{ Params: { id: string } }>(
    "/pets/:id/history",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const pet = await prisma.pet.findUnique({
        where: { id: request.params.id },
      });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      if (!isStaffOrAdmin(request.userRole) && pet.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      const reservations = await prisma.reservation.findMany({
        where: { petId: request.params.id },
        orderBy: { checkIn: "desc" },
        include: {
          room: { select: { id: true, name: true } },
          updates: { orderBy: { createdAt: "desc" }, take: 4 },
          checklists: { orderBy: { date: "desc" } },
          review: true,
        },
      });

      const behaviorTags = await prisma.behaviorTag.findMany({
        where: { petId: request.params.id },
        orderBy: { createdAt: "desc" },
        include: {
          staff: {
            select: { firstName: true, lastName: true },
          },
        },
      });

      return { pet, reservations, behaviorTags };
    }
  );

  // GET /pets/:id/alerts — incidentes/alertas del staff por mascota.
  // Owner ve los suyos, staff/admin ven cualquiera.
  fastify.get<{
    Params: { id: string };
    Querystring: { resolved?: string };
  }>(
    "/pets/:id/alerts",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const pet = await prisma.pet.findUnique({
        where: { id: request.params.id },
        select: { id: true, ownerId: true },
      });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      if (!isStaffOrAdmin(request.userRole) && pet.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      const filterResolved = request.query.resolved;
      const where: any = { petId: request.params.id };
      if (filterResolved === "true") where.isResolved = true;
      else if (filterResolved === "false") where.isResolved = false;

      const alerts = await prisma.staffAlert.findMany({
        where,
        orderBy: [{ isResolved: "asc" }, { createdAt: "desc" }],
        include: {
          staff: { select: { id: true, firstName: true, lastName: true } },
          reservation: {
            select: {
              id: true,
              checkIn: true,
              checkOut: true,
              reservationType: true,
              appointmentAt: true,
              room: { select: { id: true, name: true } },
            },
          },
        },
      });
      return alerts;
    }
  );
}
