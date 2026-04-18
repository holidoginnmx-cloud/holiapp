import { FastifyInstance } from "fastify";
import { createAuthMiddleware, createAdminMiddleware } from "../middleware/auth";
import { ReviewCartillaSchema, CartillaStatusEnum } from "@holidoginn/shared";
import { notifyUser, notifyUsers } from "../lib/notify";

export default async function adminRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();

  // GET /admin/stats — dashboard statistics
  fastify.get(
    "/admin/stats",
    { preHandler: [authMiddleware, adminMiddleware] },
    async () => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart.getTime() + 86_400_000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [
        checkedInCount,
        todayCheckIns,
        todayCheckOuts,
        totalActiveRooms,
        occupiedRoomIds,
        monthRevenueResult,
        expiringVaccines,
        checkedInReservations,
      ] = await Promise.all([
        // Perros hospedados
        prisma.reservation.count({ where: { status: "CHECKED_IN" } }),

        // Check-ins programados hoy
        prisma.reservation.count({
          where: {
            status: { in: ["CONFIRMED", "CHECKED_IN"] },
            checkIn: { gte: todayStart, lt: todayEnd },
          },
        }),

        // Check-outs programados hoy
        prisma.reservation.count({
          where: {
            status: "CHECKED_IN",
            checkOut: { gte: todayStart, lt: todayEnd },
          },
        }),

        // Total cuartos activos
        prisma.room.count({ where: { isActive: true } }),

        // Cuartos ocupados (con reservación CHECKED_IN)
        prisma.reservation.findMany({
          where: { status: "CHECKED_IN", roomId: { not: null } },
          select: { roomId: true },
        }),

        // Ingresos del mes
        prisma.payment.aggregate({
          where: {
            status: "PAID",
            paidAt: { gte: monthStart, lt: todayEnd },
          },
          _sum: { amount: true },
        }),

        // Vacunas por vencer (próximos 30 días)
        prisma.vaccine.findMany({
          where: {
            expiresAt: {
              not: null,
              lte: new Date(now.getTime() + 30 * 86_400_000),
              gte: now,
            },
          },
          include: {
            pet: {
              select: {
                id: true,
                name: true,
                owner: { select: { firstName: true, lastName: true } },
              },
            },
          },
          orderBy: { expiresAt: "asc" },
        }),

        // Reservaciones CHECKED_IN para verificar evidencias
        prisma.reservation.findMany({
          where: { status: "CHECKED_IN" },
          include: {
            pet: { select: { id: true, name: true } },
            owner: { select: { firstName: true, lastName: true } },
            updates: {
              where: { createdAt: { gte: todayStart } },
              select: { id: true },
            },
          },
        }),
      ]);

      const availableRooms = totalActiveRooms - occupiedRoomIds.length;
      const monthRevenue = Number(monthRevenueResult._sum.amount ?? 0);

      const staysWithoutUpdates = checkedInReservations
        .filter((r) => r.updates.length === 0)
        .map((r) => ({
          reservationId: r.id,
          petName: r.pet.name,
          ownerName: `${r.owner.firstName} ${r.owner.lastName}`,
          checkIn: r.checkIn,
        }));

      return {
        checkedInCount,
        todayCheckIns,
        todayCheckOuts,
        availableRooms,
        totalActiveRooms,
        monthRevenue,
        expiringVaccines: expiringVaccines.map((v) => ({
          id: v.id,
          name: v.name,
          expiresAt: v.expiresAt,
          petName: v.pet.name,
          petId: v.pet.id,
          ownerName: `${v.pet.owner.firstName} ${v.pet.owner.lastName}`,
        })),
        staysWithoutUpdates,
      };
    }
  );

  // GET /admin/rooms/status — rooms with current occupancy
  fastify.get(
    "/admin/rooms/status",
    { preHandler: [authMiddleware, adminMiddleware] },
    async () => {
      const rooms = await prisma.room.findMany({
        orderBy: { name: "asc" },
      });

      const occupiedReservations = await prisma.reservation.findMany({
        where: { status: "CHECKED_IN", roomId: { not: null } },
        include: {
          pet: { select: { name: true } },
          owner: { select: { firstName: true, lastName: true } },
        },
      });

      const occupancyMap = new Map(
        occupiedReservations.map((r) => [
          r.roomId,
          {
            petName: r.pet.name,
            ownerName: `${r.owner.firstName} ${r.owner.lastName}`,
            checkOut: r.checkOut,
            reservationId: r.id,
          },
        ])
      );

      return rooms.map((room) => ({
        ...room,
        currentReservation: occupancyMap.get(room.id) ?? null,
      }));
    }
  );

  // POST /admin/notifications/send — send notification to users
  fastify.post<{
    Body: {
      userIds: string[] | "all";
      title: string;
      body: string;
      type?: string;
    };
  }>(
    "/admin/notifications/send",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const { userIds, title, body, type } = request.body;

      if (!title || !body) {
        return reply
          .status(400)
          .send({ error: "Título y mensaje son requeridos" });
      }

      let targetUserIds: string[];

      if (userIds === "all") {
        const owners = await prisma.user.findMany({
          where: { role: "OWNER", isActive: true },
          select: { id: true },
        });
        targetUserIds = owners.map((u) => u.id);
      } else {
        targetUserIds = userIds;
      }

      if (targetUserIds.length === 0) {
        return reply
          .status(400)
          .send({ error: "No hay usuarios destinatarios" });
      }

      await notifyUsers(prisma, targetUserIds, {
        type: (type as any) ?? "GENERAL",
        title,
        body,
      });

      return reply
        .status(201)
        .send({ sent: targetUserIds.length });
    }
  );

  // ─── GET /admin/alerts — alertas del staff ─────────────────────
  fastify.get<{ Querystring: { resolved?: string } }>(
    "/admin/alerts",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request) => {
      const showResolved = request.query.resolved === "true";
      const alerts = await prisma.staffAlert.findMany({
        where: { isResolved: showResolved },
        include: {
          pet: { select: { id: true, name: true, photoUrl: true } },
          reservation: {
            select: {
              id: true,
              checkIn: true,
              checkOut: true,
              status: true,
              room: { select: { name: true } },
              owner: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          staff: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return alerts;
    }
  );

  // ─── PATCH /admin/alerts/:id/resolve — resolver alerta ────────
  fastify.patch<{ Params: { id: string } }>(
    "/admin/alerts/:id/resolve",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const alert = await prisma.staffAlert.findUnique({
        where: { id: request.params.id },
      });
      if (!alert) {
        return reply.status(404).send({ error: "Alerta no encontrada" });
      }
      if (alert.isResolved) {
        return reply.status(400).send({ error: "La alerta ya fue resuelta" });
      }
      const updated = await prisma.staffAlert.update({
        where: { id: request.params.id },
        data: { isResolved: true, resolvedAt: new Date() },
      });
      return updated;
    }
  );

  // ─── PATCH /admin/reservations/:id/assign-staff — asignar staff ─
  fastify.patch<{ Params: { id: string }; Body: { staffId: string } }>(
    "/admin/reservations/:id/assign-staff",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const { staffId } = request.body as { staffId: string };
      if (!staffId) return reply.status(400).send({ error: "staffId requerido" });

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: { pet: { select: { name: true } } },
      });
      if (!reservation) return reply.status(404).send({ error: "Reservación no encontrada" });

      const staffUser = await prisma.user.findUnique({ where: { id: staffId } });
      if (!staffUser || staffUser.role !== "STAFF") {
        return reply.status(400).send({ error: "Usuario no es staff válido" });
      }

      const updated = await prisma.reservation.update({
        where: { id: request.params.id },
        data: { staffId },
        include: { staff: { select: { firstName: true, lastName: true } } },
      });

      // Notificar al staff (in-app + push)
      await notifyUser(prisma, {
        userId: staffId,
        type: "STAFF_ASSIGNED" as any,
        title: `Te asignaron a ${reservation.pet.name}`,
        body: `El admin te asignó como responsable de la estancia de ${reservation.pet.name}.`,
        data: { reservationId: reservation.id },
      });

      return updated;
    }
  );

  // ─── PATCH /admin/reservations/:id/assign-room — reasignar cuarto ─
  fastify.patch<{ Params: { id: string }; Body: { roomId: string } }>(
    "/admin/reservations/:id/assign-room",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const { roomId } = request.body as { roomId: string };
      if (!roomId) return reply.status(400).send({ error: "roomId requerido" });

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
      });
      if (!reservation) return reply.status(404).send({ error: "Reservación no encontrada" });

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || !room.isActive) {
        return reply.status(400).send({ error: "Cuarto no disponible" });
      }

      // Check room availability
      const conflict = await prisma.reservation.findFirst({
        where: {
          roomId,
          id: { not: reservation.id },
          status: { notIn: ["CANCELLED", "CHECKED_OUT"] as any },
          AND: [
            { checkIn: { lt: reservation.checkOut } },
            { checkOut: { gt: reservation.checkIn } },
          ],
        },
      });
      if (conflict) {
        return reply.status(409).send({ error: "Cuarto ocupado en esas fechas" });
      }

      const updated = await prisma.reservation.update({
        where: { id: request.params.id },
        data: { roomId },
        include: { room: true },
      });

      return updated;
    }
  );

  // ─── POST /admin/users/:id/credit-adjust — ajustar crédito manualmente ─
  fastify.post<{ Params: { id: string }; Body: { amount: number; description: string } }>(
    "/admin/users/:id/credit-adjust",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const { amount, description } = request.body as { amount: number; description: string };
      if (!amount || !description) {
        return reply.status(400).send({ error: "Monto y descripción requeridos" });
      }

      const user = await prisma.user.findUnique({ where: { id: request.params.id } });
      if (!user) return reply.status(404).send({ error: "Usuario no encontrado" });

      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { creditBalance: { increment: amount } },
      });

      await prisma.creditLedger.create({
        data: {
          userId: user.id,
          type: "CREDIT_ADJUSTED",
          amount,
          balanceAfter: Number(updatedUser.creditBalance),
          description: `[ADMIN] ${description}`,
        },
      });

      await notifyUser(prisma, {
        userId: user.id,
        type: "CREDIT_ADDED" as any,
        title: amount > 0 ? "Crédito agregado" : "Ajuste de crédito",
        body: `${amount > 0 ? "Se agregaron" : "Se ajustaron"} $${Math.abs(amount).toLocaleString("es-MX")} a tu saldo. Motivo: ${description}`,
        data: { amount },
      });

      return { creditBalance: Number(updatedUser.creditBalance) };
    }
  );

  // GET /admin/cartillas — list pets filtered by cartilla status
  fastify.get<{ Querystring: { status?: string } }>(
    "/admin/cartillas",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const statusQuery = request.query.status ?? "PENDING";
      const parsed = CartillaStatusEnum.safeParse(statusQuery);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Status inválido" });
      }
      const pets = await prisma.pet.findMany({
        where: { cartillaStatus: parsed.data, isActive: true },
        include: {
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          cartillaReviewedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: { updatedAt: "desc" },
      });
      return pets;
    }
  );

  // PATCH /admin/pets/:id/cartilla — approve or reject a cartilla
  fastify.patch<{ Params: { id: string } }>(
    "/admin/pets/:id/cartilla",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const parsed = ReviewCartillaSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { action, reason } = parsed.data;

      const pet = await prisma.pet.findUnique({ where: { id: request.params.id } });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      if (!pet.cartillaUrl) {
        return reply.status(400).send({ error: "La mascota no tiene cartilla subida" });
      }

      const reviewedAt = new Date();
      const updated = await prisma.pet.update({
        where: { id: pet.id },
        data:
          action === "APPROVE"
            ? {
                cartillaStatus: "APPROVED",
                cartillaReviewedAt: reviewedAt,
                cartillaReviewedById: request.userId,
                cartillaRejectionReason: null,
              }
            : {
                cartillaStatus: "REJECTED",
                cartillaReviewedAt: reviewedAt,
                cartillaReviewedById: request.userId,
                cartillaRejectionReason: reason?.trim() || null,
              },
      });

      // Notify the owner (in-app + push)
      await notifyUser(prisma, {
        userId: pet.ownerId,
        type: "GENERAL",
        title:
          action === "APPROVE"
            ? `Cartilla aprobada: ${pet.name}`
            : `Cartilla rechazada: ${pet.name}`,
        body:
          action === "APPROVE"
            ? `La cartilla de ${pet.name} fue aprobada. Ya puedes reservar estancias.`
            : `La cartilla de ${pet.name} fue rechazada${
                reason?.trim() ? `: ${reason.trim()}` : "."
              } Sube una nueva para revisarla.`,
        data: { petId: pet.id, kind: "CARTILLA_REVIEW", action },
      });

      return updated;
    }
  );
}
