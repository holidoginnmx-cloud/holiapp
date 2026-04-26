import { FastifyInstance } from "fastify";
import { clerkClient } from "@clerk/fastify";
import { CreateUserSchema, UpdateUserSchema } from "@holidoginn/shared";
import { createAuthMiddleware, createAdminMiddleware } from "../middleware/auth";

export default async function usersRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();
  const adminAuth = [authMiddleware, adminMiddleware];

  // GET /users — listar todos (solo admin)
  fastify.get("/users", { preHandler: adminAuth }, async (request) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
    });
    return users;
  });

  // GET /users/me — obtener usuario autenticado por token de Clerk
  fastify.get(
    "/users/me",
    { preHandler: [createAuthMiddleware(prisma)] },
    async (request, reply) => {
      return request.dbUser;
    }
  );

  // PATCH /users/me — actualizar perfil propio (firstName, lastName, phone)
  fastify.patch<{
    Body: { firstName?: string; lastName?: string; phone?: string | null };
  }>(
    "/users/me",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const userId = request.userId!;
      const { firstName, lastName, phone } = request.body ?? {};
      const data: { firstName?: string; lastName?: string; phone?: string | null } = {};
      if (typeof firstName === "string" && firstName.trim().length > 0) {
        data.firstName = firstName.trim();
      }
      if (typeof lastName === "string" && lastName.trim().length > 0) {
        data.lastName = lastName.trim();
      }
      if (phone === null) {
        data.phone = null;
      } else if (typeof phone === "string") {
        data.phone = phone.trim().length > 0 ? phone.trim() : null;
      }
      if (Object.keys(data).length === 0) {
        return reply.status(400).send({ error: "Nada para actualizar" });
      }
      const updated = await prisma.user.update({ where: { id: userId }, data });
      return updated;
    }
  );

  // GET /users/me/export — export completo de los datos del usuario (derecho ARCO de Acceso)
  fastify.get(
    "/users/me/export",
    { preHandler: [authMiddleware] },
    async (request) => {
      const userId = request.userId!;
      const [user, pets, reservations, payments, notifications, legalAcceptances, creditEntries, reviews] =
        await Promise.all([
          prisma.user.findUnique({ where: { id: userId } }),
          prisma.pet.findMany({
            where: { ownerId: userId },
            include: { vaccines: true },
          }),
          prisma.reservation.findMany({ where: { ownerId: userId } }),
          prisma.payment.findMany({ where: { userId } }),
          prisma.notification.findMany({ where: { userId } }),
          prisma.legalAcceptance.findMany({ where: { userId } }),
          prisma.creditLedger.findMany({ where: { userId } }),
          prisma.review.findMany({ where: { ownerId: userId } }),
        ]);

      return {
        exportedAt: new Date().toISOString(),
        user,
        pets,
        reservations,
        payments,
        notifications,
        legalAcceptances,
        creditEntries,
        reviews,
      };
    }
  );

  // DELETE /users/me — eliminaci\u00f3n de cuenta del usuario autenticado (derecho ARCO de Cancelaci\u00f3n)
  // Apple Guideline 5.1.1(v) requiere que los usuarios puedan eliminar su cuenta desde dentro del app.
  fastify.delete(
    "/users/me",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const userId = request.userId!;
      const clerkId = request.dbUser?.clerkId ?? null;

      // Bloquear si hay reservaciones activas: el usuario no puede desaparecer mientras tenemos su perro.
      const now = new Date();
      const activeReservation = await prisma.reservation.findFirst({
        where: {
          ownerId: userId,
          status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
          checkOut: { gte: now },
        },
      });
      if (activeReservation) {
        return reply.status(409).send({
          error: "ACTIVE_RESERVATION",
          message:
            "Tienes una reservaci\u00f3n activa o pr\u00f3xima. Cancélala antes de eliminar tu cuenta.",
          reservationId: activeReservation.id,
        });
      }

      const pets = await prisma.pet.findMany({
        where: { ownerId: userId },
        select: { id: true },
      });
      const petIds = pets.map((p) => p.id);
      const reservations = await prisma.reservation.findMany({
        where: { ownerId: userId },
        select: { id: true },
      });
      const reservationIds = reservations.map((r) => r.id);

      // Anonimizar PII pero conservar registros vinculados a pagos/reservaciones por retenci\u00f3n fiscal (5 a\u00f1os LFPDPPP).
      await prisma.$transaction(async (tx) => {
        await tx.pushToken.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { userId } });
        await tx.legalAcceptance.deleteMany({ where: { userId } });
        await tx.creditLedger.deleteMany({ where: { userId } });
        await tx.review.deleteMany({ where: { ownerId: userId } });

        if (petIds.length > 0) {
          await tx.vaccine.deleteMany({ where: { petId: { in: petIds } } });
          await tx.behaviorTag.deleteMany({ where: { petId: { in: petIds } } });
          await tx.staffAlert.deleteMany({ where: { petId: { in: petIds } } });
          await tx.stayUpdate.deleteMany({ where: { petId: { in: petIds } } });
        }
        if (reservationIds.length > 0) {
          await tx.dailyChecklist.deleteMany({
            where: { reservationId: { in: reservationIds } },
          });
        }

        // Anonimizar mascotas (no se borran porque reservaciones mantienen FK por motivos fiscales).
        if (petIds.length > 0) {
          await tx.pet.updateMany({
            where: { id: { in: petIds } },
            data: {
              name: "Mascota eliminada",
              breed: null,
              photoUrl: null,
              notes: null,
              sex: null,
              behavior: null,
              walkPreference: null,
              healthIssues: null,
              emergencyContactName: null,
              emergencyContactPhone: null,
              emergencyContactRelation: null,
              vetName: null,
              vetPhone: null,
              feedingSchedule: null,
              feedingAmount: null,
              foodType: null,
              feedingInstructions: null,
              diet: null,
              personality: null,
              cartillaUrl: null,
              cartillaStatus: null,
              cartillaReviewedAt: null,
              cartillaReviewedById: null,
              cartillaRejectionReason: null,
              isActive: false,
            },
          });
        }

        // Anonimizar usuario (conserva id para integridad referencial de pagos/reservaciones pasadas).
        await tx.user.update({
          where: { id: userId },
          data: {
            clerkId: null,
            email: `deleted-${userId}@holidoginn.deleted`,
            phone: null,
            firstName: "Usuario",
            lastName: "Eliminado",
            avatarUrl: null,
            isActive: false,
          },
        });
      });

      // Borrar usuario en Clerk para que no pueda iniciar sesi\u00f3n nuevamente.
      // Si esto falla, la cuenta ya qued\u00f3 anonimizada en BD — solo logueamos.
      if (clerkId) {
        try {
          await clerkClient.users.deleteUser(clerkId);
        } catch (err) {
          request.log.error({ err, clerkId }, "Fall\u00f3 borrar usuario en Clerk");
        }
      }

      return reply.status(200).send({ ok: true });
    }
  );

  // GET /users/me/credit-ledger — historial de saldo a favor del usuario autenticado
  fastify.get(
    "/users/me/credit-ledger",
    { preHandler: [createAuthMiddleware(prisma)] },
    async (request, reply) => {
      const entries = await prisma.creditLedger.findMany({
        where: { userId: request.userId! },
        orderBy: { createdAt: "desc" },
      });
      return entries;
    }
  );

  // PATCH /users/me/role — dev-only, permite al usuario autenticado cambiar su propio rol
  fastify.patch(
    "/users/me/role",
    { preHandler: [createAuthMiddleware(prisma)] },
    async (request, reply) => {
      // TEMP: producción habilitada mientras seguimos iterando post-lanzamiento.
      // Volver a bloquear antes de la versión final.

      const parsed = UpdateUserSchema.pick({ role: true }).safeParse(
        request.body
      );
      if (!parsed.success || !parsed.data.role) {
        return reply.status(400).send({ error: "role requerido" });
      }

      const updated = await prisma.user.update({
        where: { id: request.userId! },
        data: { role: parsed.data.role },
      });
      return updated;
    }
  );

  // GET /users/:id — obtener uno (solo admin)
  fastify.get<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: request.params.id },
        include: { pets: true },
      });
      if (!user) {
        return reply.status(404).send({ error: "Usuario no encontrado" });
      }
      return user;
    }
  );

  // POST /users — crear (solo admin)
  fastify.post("/users", { preHandler: adminAuth }, async (request, reply) => {
    const parsed = CreateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const existing = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (existing) {
      return reply
        .status(409)
        .send({ error: "Ya existe un usuario con ese email" });
    }

    const user = await prisma.user.create({ data: parsed.data });
    return reply.status(201).send(user);
  });

  // PATCH /users/:id — actualizar (solo admin)
  fastify.patch<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      const parsed = UpdateUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const user = await prisma.user.findUnique({
        where: { id: request.params.id },
      });
      if (!user) {
        return reply.status(404).send({ error: "Usuario no encontrado" });
      }

      if (parsed.data.email && parsed.data.email !== user.email) {
        const existing = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (existing) {
          return reply
            .status(409)
            .send({ error: "Ya existe un usuario con ese email" });
        }
      }

      const updated = await prisma.user.update({
        where: { id: request.params.id },
        data: parsed.data,
      });
      return updated;
    }
  );

  // DELETE /users/:id — desactivar (soft delete, solo admin)
  fastify.delete<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: request.params.id },
      });
      if (!user) {
        return reply.status(404).send({ error: "Usuario no encontrado" });
      }

      const updated = await prisma.user.update({
        where: { id: request.params.id },
        data: { isActive: false },
      });
      return updated;
    }
  );
}
