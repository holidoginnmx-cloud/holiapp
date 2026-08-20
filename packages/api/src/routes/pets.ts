import { FastifyInstance } from "fastify";
import {
  CreatePetSchema,
  UpdatePetSchema,
  CreateVaccineSchema,
  CreateDewormingSchema,
} from "@holidoginn/shared";
import { createAuthMiddleware, createAdminMiddleware } from "../middleware/auth";
import { notifyUser, notifyUsers, notifyPetAudience } from "../lib/notify";
import {
  canAccessPet,
  isCoOwner,
  sharedPetIds,
  accessiblePetFilter,
  invalidatePetAccessCache,
} from "../lib/petAccess";

export default async function petsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();

  const isStaffOrAdmin = (role?: string) => role === "ADMIN" || role === "STAFF";
  const isAdmin = (role?: string) => role === "ADMIN";
  // El equipo (admin + staff) captura mascotas a nombre del cliente cuando
  // llega un walk-in. Deliberadamente NO es lo mismo que `isAdmin`: borrar una
  // mascota sigue siendo solo del dueño o de un admin.
  const isEquipo = (role?: string) => role === "ADMIN" || role === "STAFF";

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

      // El cliente ve las suyas MÁS las que le comparten (pareja/familia que
      // comparte perro). Dos caminos a propósito: sin nada compartido —el caso
      // de casi todos— la consulta es idéntica a la de siempre y sigue usando
      // el índice (ownerId, isActive). Un OR con subconsulta correlacionada
      // degradaría a seq scan para TODOS.
      const shared = isStaffOrAdmin(request.userRole)
        ? []
        : await sharedPetIds(prisma, request.userId!);

      const where =
        shared.length > 0
          ? {
              isActive: true,
              OR: [{ ownerId: request.userId! }, { id: { in: shared } }],
            }
          : {
              ...(filterOwnerId ? { ownerId: filterOwnerId } : {}),
              isActive: true,
            };

      const pets = await prisma.pet.findMany({
        where,
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, email: true } },
          // Para pintar "Compartida con X" en ambas cuentas.
          coOwners: {
            select: {
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
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
      // Defensa: omite mascotas con owner roto (datos legacy con FK huérfana).
      return pets.filter((p) => p.owner).map((p) => ({
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
          coOwners: {
            select: {
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      if (!(await canAccessPet(prisma, pet, request))) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      return pet;
    }
  );

  // POST /pets — crear (solo para sí mismo, salvo el equipo)
  fastify.post(
    "/pets",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CreatePetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      // El dueño se deriva del usuario autenticado (el auth middleware siempre
      // setea request.userId, autoprovisionando el registro de la BD). Para un
      // OWNER se ignora cualquier ownerId que mande el cliente; el equipo
      // (admin o staff) sí puede crear para otro dueño pasando ownerId
      // explícito. Esto evita el 400 cuando el cliente aún no sincronizó su
      // userId (carrera con /users/me tras el login) y previene crear mascotas
      // para terceros. Si el staff no pudiera pasar ownerId, la mascota del
      // walk-in quedaría colgando de la cuenta de quien la capturó.
      const ownerId =
        isEquipo(request.userRole) && parsed.data.ownerId
          ? parsed.data.ownerId
          : request.userId;
      if (!ownerId) {
        return reply.status(401).send({ error: "No autorizado" });
      }

      const owner = await prisma.user.findUnique({ where: { id: ownerId } });
      if (!owner) {
        return reply.status(404).send({ error: "Dueño no encontrado" });
      }

      // Candado anti-duplicado: si el dueño ya tiene una mascota activa con el
      // mismo nombre, avisamos en vez de crear otra. Esto evita que un cliente
      // preexistente (cuyo perro ya estaba en la BD) lo registre de nuevo, y
      // que el admin lo recapture al dar de alta a un walk-in que ya existía.
      // Quien crea puede forzarlo con `allowDuplicateName` (dos perros que sí
      // se llaman igual).
      const allowDuplicateName =
        (request.body as { allowDuplicateName?: unknown })
          ?.allowDuplicateName === true;
      if (!allowDuplicateName) {
        // Cuenta también las mascotas COMPARTIDAS: si la pareja ya tiene a Nala
        // registrada y a esta persona se la compartieron, registrarla de nuevo
        // es justo el duplicado que queremos evitar.
        const accessible = await accessiblePetFilter(prisma, ownerId);
        const dup = await prisma.pet.findFirst({
          where: {
            ...accessible,
            isActive: true,
            name: { equals: parsed.data.name, mode: "insensitive" },
          },
          select: { id: true, name: true },
        });
        if (dup) {
          return reply.status(409).send({
            error: "DUPLICATE_PET",
            petId: dup.id,
            message: `Ya tienes registrado a ${dup.name}.`,
          });
        }
      }

      // Si se subió cartilla en el create (uno o más fotos), marcar PENDING.
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
      // La revisión existe para validar lo que sube el CLIENTE. Si quien captura
      // al perro es del equipo (admin o staff), la cartilla ya la está leyendo
      // esa persona al registrarla: se aprueba en el acto y se le acredita la
      // revisión, en vez de mandarse un ticket a sí misma.
      const registradaPorEquipo = isStaffOrAdmin(request.userRole);
      const cartillaStatus = hasCartilla
        ? registradaPorEquipo
          ? ("APPROVED" as const)
          : ("PENDING" as const)
        : null;
      const pet = await prisma.pet.create({
        data: {
          ...parsed.data,
          // Dato de operación: lo anota quien baña al perro, no el dueño.
          groomingMinutes: registradaPorEquipo
            ? (parsed.data.groomingMinutes ?? null)
            : null,
          ownerId,
          cartillaPhotos: photos,
          cartillaUrl: parsed.data.cartillaUrl ?? photos[0] ?? null,
          cartillaStatus,
          cartillaReviewedAt: cartillaStatus === "APPROVED" ? new Date() : null,
          cartillaReviewedById:
            cartillaStatus === "APPROVED" ? request.userId : null,
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
      if (!(await canAccessPet(prisma, pet, request))) {
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
      // Cuánto tarda el baño de este perro es un dato de operación: lo anota
      // quien lo baña, no el dueño.
      if (!isStaffOrAdmin(request.userRole)) {
        delete data.groomingMinutes;
      }

      const incomingPhotos = data.cartillaPhotos as string[] | undefined;
      const incomingUrl = data.cartillaUrl as string | null | undefined;

      // `cartillaPhotos` (array) es la fuente de verdad. Si llega, manda.
      // Si solo llega `cartillaUrl` (cliente viejo), NO sobreescribimos
      // `cartillaPhotos`: solo actualizamos el legacy url. Esto evita perder
      // fotos previas cuando un cliente que aún no soporta el array envía PATCH.
      if (incomingPhotos !== undefined) {
        const photosChanged =
          JSON.stringify(incomingPhotos) !== JSON.stringify(pet.cartillaPhotos);
        if (incomingUrl === undefined) {
          data.cartillaUrl = incomingPhotos[0] ?? null;
        }
        if (photosChanged) {
          // Misma regla que en el create: si la cartilla la sube el equipo, no
          // necesita revisión (ver POST /pets).
          const autoAprobada =
            incomingPhotos.length > 0 && isStaffOrAdmin(request.userRole);
          data.cartillaStatus =
            incomingPhotos.length > 0
              ? autoAprobada
                ? "APPROVED"
                : "PENDING"
              : null;
          data.cartillaReviewedAt = autoAprobada ? new Date() : null;
          data.cartillaReviewedById = autoAprobada ? request.userId : null;
          data.cartillaRejectionReason = null;
          data.cartillaApprovalNote = null;
        }
      } else if (incomingUrl !== undefined && incomingUrl !== pet.cartillaUrl) {
        request.log.warn(
          { petId: pet.id, incomingUrl },
          "Legacy PATCH with cartillaUrl only — preserving existing cartillaPhotos"
        );
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

      // El equipo subió la cartilla de un perro que aún no la tenía aprobada:
      // avisamos al dueño igual que lo hace la revisión manual del admin. Si ya
      // estaba aprobada (p. ej. sólo se agregó una foto más), no molestamos.
      if (
        data.cartillaStatus === "APPROVED" &&
        pet.cartillaStatus !== "APPROVED"
      ) {
        await notifyPetAudience(prisma, { petId: pet.id, ownerId: pet.ownerId }, {
          type: "GENERAL",
          title: `Cartilla aprobada: ${updated.name}`,
          body: `La cartilla de ${updated.name} fue aprobada. Ya puedes reservar estancias.`,
          data: { petId: updated.id, kind: "CARTILLA_REVIEW", action: "APPROVE" },
        });
      }

      return updated;
    }
  );

  // DELETE /pets/:id — eliminar (soft delete: isActive=false). Owner del pet o admin.
  // Bloquea si la mascota tiene reservaciones activas (CONFIRMED/CHECKED_IN) para
  // no romper estancias en curso. El registro se conserva por integridad histórica.
  fastify.delete<{ Params: { id: string } }>(
    "/pets/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const pet = await prisma.pet.findUnique({ where: { id: request.params.id } });
      if (!pet || !pet.isActive) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      // Solo el dueño (o co-dueño) o un admin pueden eliminar (staff no).
      if (
        !isAdmin(request.userRole) &&
        pet.ownerId !== request.userId &&
        !(await isCoOwner(prisma, pet.id, request.userId))
      ) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      const activeReservations = await prisma.reservation.count({
        where: {
          petId: pet.id,
          status: { in: ["CONFIRMED", "CHECKED_IN"] },
        },
      });
      if (activeReservations > 0) {
        return reply.status(409).send({
          error:
            "No puedes eliminar a tu mascota mientras tenga reservaciones activas.",
        });
      }

      await prisma.pet.update({
        where: { id: pet.id },
        data: { isActive: false },
      });
      return reply.status(204).send();
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
      if (!(await canAccessPet(prisma, pet, request))) {
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
      if (!(await canAccessPet(prisma, pet, request))) {
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
      if (!(await canAccessPet(prisma, pet, request))) {
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
      if (!(await canAccessPet(prisma, pet, request))) {
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
      if (!(await canAccessPet(prisma, pet, request))) {
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
      if (!(await canAccessPet(prisma, pet, request))) {
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

  // ─── Co-dueños ───────────────────────────────────────────
  // Un perro puede estar en dos cuentas (pareja/familia). El vínculo lo hace
  // SOLO el equipo: no hay autoservicio ni invitación desde la app del cliente.

  // GET /pets/:id/co-owners — quiénes comparten esta mascota
  fastify.get<{ Params: { id: string } }>(
    "/pets/:id/co-owners",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const pet = await prisma.pet.findUnique({
        where: { id: request.params.id },
        select: {
          id: true,
          name: true,
          owner: {
            select: { id: true, firstName: true, lastName: true, phone: true, email: true },
          },
        },
      });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      const coOwners = await prisma.petCoOwner.findMany({
        where: { petId: pet.id },
        orderBy: { createdAt: "asc" },
        select: {
          createdAt: true,
          createdByEmail: true,
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          user: {
            select: { id: true, firstName: true, lastName: true, phone: true, email: true },
          },
        },
      });
      return { pet: { id: pet.id, name: pet.name }, owner: pet.owner, coOwners };
    }
  );

  // POST /pets/:id/co-owners — vincular a alguien más
  fastify.post<{ Params: { id: string }; Body: { userId?: string } }>(
    "/pets/:id/co-owners",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const userId = request.body?.userId;
      if (!userId) {
        return reply.status(400).send({ error: "Falta userId" });
      }
      const pet = await prisma.pet.findUnique({
        where: { id: request.params.id },
        select: { id: true, name: true, ownerId: true },
      });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      if (pet.ownerId === userId) {
        return reply
          .status(409)
          .send({ error: "ALREADY_OWNER", message: "Esa persona ya es la dueña." });
      }
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true, firstName: true },
      });
      if (!user || !user.isActive) {
        return reply.status(404).send({ error: "Cliente no encontrado" });
      }
      if (user.role !== "OWNER") {
        return reply.status(400).send({
          error: "NOT_OWNER_ROLE",
          message: "Solo se puede compartir con una cuenta de cliente.",
        });
      }

      const existing = await prisma.petCoOwner.findUnique({
        where: { petId_userId: { petId: pet.id, userId } },
      });
      if (existing) {
        return reply.status(409).send({
          error: "ALREADY_CO_OWNER",
          message: `${user.firstName} ya es co-dueño de ${pet.name}.`,
        });
      }

      const link = await prisma.petCoOwner.create({
        data: {
          petId: pet.id,
          userId,
          createdById: request.userId,
          createdByEmail: request.dbUser?.email ?? null,
        },
      });
      // Los dos lados cambian de vista: el co-dueño gana la mascota y el dueño
      // empieza a ver las reservas que haga el otro.
      invalidatePetAccessCache(userId);
      invalidatePetAccessCache(pet.ownerId);

      // Sin este aviso la app del co-dueño no se enteraría: la lista de
      // mascotas tiene staleTime de 5 min y no refetchea al volver a la
      // pestaña, así que el estado vacío se quedaría pegado. El push la
      // invalida (kind PET_SHARED) y de paso avisa a la persona.
      await notifyUser(prisma, {
        userId,
        type: "GENERAL",
        title: `${pet.name} ya está en tu cuenta 🐾`,
        body: `Ya puedes ver su cartilla, sus reportes y reservar por tu cuenta.`,
        data: { petId: pet.id, kind: "PET_SHARED" },
      });

      return { ok: true, id: link.id };
    }
  );

  // DELETE /pets/:id/co-owners/:userId — quitar el vínculo
  fastify.delete<{ Params: { id: string; userId: string } }>(
    "/pets/:id/co-owners/:userId",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const { id: petId, userId } = request.params;
      const pet = await prisma.pet.findUnique({
        where: { id: petId },
        select: { ownerId: true },
      });
      const deleted = await prisma.petCoOwner.deleteMany({
        where: { petId, userId },
      });
      if (deleted.count === 0) {
        return reply.status(404).send({ error: "Ese vínculo no existe" });
      }
      invalidatePetAccessCache(userId);
      invalidatePetAccessCache(pet?.ownerId);
      return { ok: true };
    }
  );
}
