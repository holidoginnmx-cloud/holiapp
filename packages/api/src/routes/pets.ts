import { FastifyInstance } from "fastify";
import { CreatePetSchema, UpdatePetSchema, CreateVaccineSchema } from "@holidoginn/shared";
import { createAuthMiddleware } from "../middleware/auth";

export default async function petsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  const isStaffOrAdmin = (role?: string) => role === "ADMIN" || role === "STAFF";
  const isAdmin = (role?: string) => role === "ADMIN";

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
          vaccines: { orderBy: { appliedAt: "desc" } },
          reservations: {
            where: {
              status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
            },
            select: {
              id: true,
              checkIn: true,
              checkOut: true,
              status: true,
              paymentType: true,
              totalAmount: true,
            },
            orderBy: { checkIn: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      return pets;
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
          vaccines: { orderBy: { appliedAt: "desc" } },
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

      // If owner uploaded a cartilla in the create payload, mark it PENDING
      const cartillaStatus = parsed.data.cartillaUrl ? "PENDING" as const : null;
      const pet = await prisma.pet.create({
        data: { ...parsed.data, cartillaStatus },
      });
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
      if (!isAdmin(request.userRole) && pet.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      // If the cartilla image changed, reset review state to PENDING.
      // Owners cannot set cartillaStatus directly — schema already excludes it.
      const data: Record<string, unknown> = { ...parsed.data };
      if (
        Object.prototype.hasOwnProperty.call(parsed.data, "cartillaUrl") &&
        parsed.data.cartillaUrl !== pet.cartillaUrl
      ) {
        data.cartillaStatus = parsed.data.cartillaUrl ? "PENDING" : null;
        data.cartillaReviewedAt = null;
        data.cartillaReviewedById = null;
        data.cartillaRejectionReason = null;
      }

      const updated = await prisma.pet.update({
        where: { id: request.params.id },
        data,
      });
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

      const vaccine = await prisma.vaccine.create({
        data: { ...parsed.data, petId: request.params.id },
      });
      return reply.status(201).send(vaccine);
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
}
