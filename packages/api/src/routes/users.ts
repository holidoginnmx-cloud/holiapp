import { FastifyInstance } from "fastify";
import { clerkClient } from "@clerk/fastify";
import { CreateUserSchema, UpdateUserSchema } from "@holidoginn/shared";
import { createAuthMiddleware, createAdminMiddleware } from "../middleware/auth";
import { normalizePhone } from "../lib/phone";
import {
  claimPetsIntoAccount,
  ClaimUnavailableError,
  ClaimForbiddenError,
} from "../lib/userMerge";

export default async function usersRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();
  const adminAuth = [authMiddleware, adminMiddleware];

  // GET /users — listar todos (solo admin)
  fastify.get("/users", { preHandler: adminAuth }, async (request) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { pushTokens: true } } },
    });
    // `hasApp` se computa en el servidor (no se confía en el cliente):
    // tiene cuenta vinculada (clerkId) o al menos un push token registrado
    // = el cliente descargó e inició sesión en la app.
    return users.map(({ _count, ...u }) => ({
      ...u,
      hasApp: !!u.clerkId || _count.pushTokens > 0,
    }));
  });

  // GET /users/me — obtener usuario autenticado por token de Clerk
  fastify.get(
    "/users/me",
    { preHandler: [createAuthMiddleware(prisma)] },
    async (request, reply) => {
      return request.dbUser;
    }
  );

  // POST /users/claim/lookup — el cliente recién registrado busca su cuenta
  // preexistente (creada por el admin, aún sin app vinculada) por teléfono y,
  // como respaldo, por correo. Devuelve datos mínimos para reconocerla
  // (primer nombre + mascotas). Es el primer paso de la pantalla "¿Ya eres
  // cliente?".
  fastify.post<{ Body: { phone?: string; email?: string } }>(
    "/users/claim/lookup",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const currentUserId = request.userId!;
      const phone = normalizePhone(request.body?.phone);
      const email = request.body?.email?.trim().toLowerCase() || null;
      if (!phone && !email) {
        return reply
          .status(400)
          .send({ error: "Ingresa tu teléfono o tu correo" });
      }

      // Por teléfono: la columna está en formato libre, así que comparamos los
      // últimos 10 dígitos vía SQL. Solo cuentas OWNER activas SIN app vinculada.
      let candidateIds: string[] = [];
      if (phone) {
        const rows = await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM users
          WHERE "clerkId" IS NULL AND "isActive" = true AND role = 'OWNER'
            AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${phone}
          LIMIT 10
        `;
        candidateIds = rows.map((r) => r.id);
      }
      // Respaldo por correo exacto si el teléfono no encontró nada.
      if (candidateIds.length === 0 && email) {
        const byEmail = await prisma.user.findFirst({
          where: { email, clerkId: null, isActive: true, role: "OWNER" },
          select: { id: true },
        });
        if (byEmail) candidateIds = [byEmail.id];
      }

      candidateIds = candidateIds.filter((id) => id !== currentUserId);
      if (candidateIds.length === 0) {
        return reply.send({ candidates: [] });
      }

      const users = await prisma.user.findMany({
        where: { id: { in: candidateIds } },
        select: {
          id: true,
          firstName: true,
          pets: {
            where: { isActive: true },
            select: { id: true, name: true, breed: true, photoUrl: true },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      return reply.send({
        candidates: users.map((u) => ({
          candidateId: u.id,
          firstName: u.firstName,
          pets: u.pets,
        })),
      });
    }
  );

  // POST /users/claim/confirm — el cliente confirma cuáles mascotas son suyas.
  // Consolida su cuenta nueva (Clerk) con esas mascotas bajo un solo registro,
  // reuniendo las que estaban repartidas en registros legacy duplicados.
  // Ver lib/userMerge.ts (claimPetsIntoAccount).
  fastify.post<{
    Body: {
      petIds?: string[];
      candidateId?: string; // compat con apps previas (un solo registro)
      phone?: string;
      email?: string;
    };
  }>(
    "/users/claim/confirm",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const fresh = request.dbUser!;

      // La cuenta actual debe ser nueva (sin historial) para no perder datos al
      // consolidar en el registro legacy.
      const [petCount, resCount] = await Promise.all([
        prisma.pet.count({ where: { ownerId: fresh.id } }),
        prisma.reservation.count({ where: { ownerId: fresh.id } }),
      ]);
      if (petCount > 0 || resCount > 0) {
        return reply.status(409).send({
          error:
            "Tu cuenta ya tiene información registrada; escríbenos para vincularla.",
        });
      }

      const selectedPetIds = Array.isArray(request.body?.petIds)
        ? [
            ...new Set(
              request.body!.petIds.filter(
                (id) => typeof id === "string" && id.length > 0
              )
            ),
          ]
        : [];

      let allowedIds: string[];
      let petIds: string[];

      if (selectedPetIds.length > 0) {
        // Flujo nuevo (selección por mascota). Autorización: re-derivar los
        // registros legacy permitidos con la MISMA lógica del lookup (teléfono
        // últimos-10, respaldo por correo). No confiamos en ids del cliente:
        // las mascotas se validan contra estos registros dentro de la
        // transacción de claimPetsIntoAccount.
        const phone = normalizePhone(request.body?.phone);
        const email = request.body?.email?.trim().toLowerCase() || null;
        if (!phone && !email) {
          return reply
            .status(400)
            .send({ error: "Falta el teléfono o correo con el que buscaste" });
        }
        allowedIds = [];
        if (phone) {
          const rows = await prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM users
            WHERE "clerkId" IS NULL AND "isActive" = true AND role = 'OWNER'
              AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${phone}
            LIMIT 20
          `;
          allowedIds = rows.map((r) => r.id);
        }
        if (allowedIds.length === 0 && email) {
          const byEmail = await prisma.user.findMany({
            where: { email, clerkId: null, isActive: true, role: "OWNER" },
            select: { id: true },
          });
          allowedIds = byEmail.map((u) => u.id);
        }
        allowedIds = allowedIds.filter((id) => id !== fresh.id);
        if (allowedIds.length === 0) {
          return reply
            .status(404)
            .send({ error: "No encontramos una cuenta con ese dato" });
        }
        petIds = selectedPetIds;
      } else if (request.body?.candidateId) {
        // Compat con apps previas: mandaban un `candidateId` (un solo registro).
        // Autorizamos ese registro directamente y reclamamos todas sus mascotas
        // (replica el comportamiento anterior de merge de un candidato).
        const candidateId = request.body.candidateId;
        if (candidateId === fresh.id) {
          return reply
            .status(400)
            .send({ error: "No puedes vincularte a tu propia cuenta" });
        }
        const candidate = await prisma.user.findFirst({
          where: {
            id: candidateId,
            clerkId: null,
            isActive: true,
            role: "OWNER",
          },
          select: { id: true },
        });
        if (!candidate) {
          return reply
            .status(404)
            .send({ error: "No encontramos esa cuenta para vincular" });
        }
        const pets = await prisma.pet.findMany({
          where: { ownerId: candidateId, isActive: true },
          select: { id: true },
        });
        if (pets.length === 0) {
          return reply
            .status(400)
            .send({ error: "Esa cuenta no tiene mascotas para vincular" });
        }
        allowedIds = [candidateId];
        petIds = pets.map((p) => p.id);
      } else {
        return reply
          .status(400)
          .send({ error: "Selecciona al menos una mascota" });
      }

      const enteredPhone = request.body?.phone?.trim() || null;
      try {
        const merged = await claimPetsIntoAccount(
          prisma,
          fresh,
          petIds,
          allowedIds,
          enteredPhone
        );
        return reply.send(merged);
      } catch (err) {
        if (err instanceof ClaimForbiddenError) {
          return reply.status(403).send({ error: err.message });
        }
        if (err instanceof ClaimUnavailableError) {
          return reply.status(409).send({ error: err.message });
        }
        throw err;
      }
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
          status: { in: ["CONFIRMED", "CHECKED_IN"] },
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
      if (process.env.NODE_ENV === "production") {
        return reply.status(403).send({ error: "forbidden in production" });
      }

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
