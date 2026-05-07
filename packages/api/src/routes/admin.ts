import { FastifyInstance } from "fastify";
import { createAuthMiddleware, createAdminMiddleware } from "../middleware/auth";
import { ReviewCartillaSchema, CartillaStatusEnum, UpdateVaccineSchema } from "@holidoginn/shared";
import { notifyUser, notifyUsers } from "../lib/notify";
import { autoCheckoutOverdueStays, notifyExpiringVaccines } from "../lib/auto-actions";

export default async function adminRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();

  // GET /admin/stats — dashboard statistics
  fastify.get(
    "/admin/stats",
    { preHandler: [authMiddleware, adminMiddleware] },
    async () => {
      await autoCheckoutOverdueStays(prisma);
      await notifyExpiringVaccines(prisma);
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart.getTime() + 86_400_000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      const [
        checkedInCount,
        todayCheckIns,
        todayCheckOuts,
        totalActiveRooms,
        occupiedRoomIds,
        monthRevenueResult,
        monthRefundsResult,
        expiringVaccines,
        checkedInReservations,
      ] = await Promise.all([
        // Perros hospedados
        prisma.reservation.count({
          where: { reservationType: "STAY", status: "CHECKED_IN" },
        }),

        // Check-ins programados hoy
        prisma.reservation.count({
          where: {
            reservationType: "STAY",
            status: { in: ["CONFIRMED", "CHECKED_IN"] },
            checkIn: { gte: todayStart, lt: todayEnd },
          },
        }),

        // Check-outs programados hoy
        prisma.reservation.count({
          where: {
            reservationType: "STAY",
            status: "CHECKED_IN",
            checkOut: { gte: todayStart, lt: todayEnd },
          },
        }),

        // Total cuartos activos
        prisma.room.count({ where: { isActive: true } }),

        // Cuartos ocupados (con reservación CHECKED_IN)
        prisma.reservation.findMany({
          where: {
            reservationType: "STAY",
            status: "CHECKED_IN",
            roomId: { not: null },
          },
          select: { roomId: true },
        }),

        // Ingresos del mes (brutos): suma PAID + PARTIAL en el mes calendario completo
        prisma.payment.aggregate({
          where: {
            status: { in: ["PAID", "PARTIAL"] },
            paidAt: { gte: monthStart, lt: monthEnd },
          },
          _sum: { amount: true },
        }),

        // Reembolsos del mes — restan al neto que se muestra en el dashboard.
        prisma.payment.aggregate({
          where: {
            status: "REFUNDED",
            paidAt: { gte: monthStart, lt: monthEnd },
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
          where: { reservationType: "STAY", status: "CHECKED_IN" },
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
      const monthGross = Number(monthRevenueResult._sum.amount ?? 0);
      const monthRefunded = Number(monthRefundsResult._sum.amount ?? 0);
      const monthRevenue = monthGross - monthRefunded;

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
        where: {
          reservationType: "STAY",
          status: "CHECKED_IN",
          roomId: { not: null },
        },
        include: {
          pet: { select: { id: true, name: true, breed: true, size: true, photoUrl: true } },
          owner: { select: { id: true, firstName: true, lastName: true } },
          staff: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      const occupancyMap = new Map(
        occupiedReservations.map((r) => [
          r.roomId,
          {
            reservationId: r.id,
            pet: r.pet,
            owner: { id: r.owner.id, name: `${r.owner.firstName} ${r.owner.lastName}` },
            staff: r.staff
              ? { id: r.staff.id, name: `${r.staff.firstName} ${r.staff.lastName}` }
              : null,
            checkIn: r.checkIn,
            checkOut: r.checkOut,
            // Mantengo legacy fields para no romper UI antigua
            petName: r.pet.name,
            ownerName: `${r.owner.firstName} ${r.owner.lastName}`,
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

  // ─── GET /admin/revenue/breakdown?month=YYYY-MM — pagos del mes ─
  fastify.get<{ Querystring: { month?: string } }>(
    "/admin/revenue/breakdown",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const monthStr = request.query.month;
      let monthStart: Date;
      let monthEnd: Date;
      if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
        const [y, m] = monthStr.split("-").map(Number);
        monthStart = new Date(y, m - 1, 1);
        monthEnd = new Date(y, m, 1);
      } else {
        const now = new Date();
        monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      }

      // Incluimos PAID/PARTIAL (cobrados) y REFUNDED (reembolsos por
      // cancelación). Los REFUNDED se restan al total y se marcan en la lista
      // para que admin vea claramente qué pagos quedaron cancelados.
      const payments = await prisma.payment.findMany({
        where: {
          status: { in: ["PAID", "PARTIAL", "REFUNDED"] },
          paidAt: { gte: monthStart, lt: monthEnd },
        },
        include: {
          reservation: {
            select: {
              id: true,
              reservationType: true,
              status: true,
              pet: { select: { name: true } },
              owner: { select: { firstName: true, lastName: true } },
            },
          },
          addons: {
            select: {
              unitPrice: true,
              variant: {
                select: {
                  serviceType: { select: { code: true } },
                },
              },
            },
          },
        },
        orderBy: { paidAt: "desc" },
      });

      // Classify each payment as HOTEL, BATH, or MIXED based on its
      // reservation type and the addons paid through it. Refunds inherit the
      // category of their reservation but are marked as kind="REFUND" so the
      // UI can show them in red and we can subtract them from totals.
      const enriched = payments.map((p) => {
        const amount = Number(p.amount);
        const isRefund = p.status === "REFUNDED";
        const bathAddonsSum = (p.addons ?? [])
          .filter((a) => a.variant.serviceType.code === "BATH")
          .reduce((sum, a) => sum + Number(a.unitPrice), 0);

        let category: "HOTEL" | "BATH" | "MIXED";
        let hotelAmount: number;
        let bathAmount: number;

        if (p.reservation?.reservationType === "BATH") {
          category = "BATH";
          hotelAmount = 0;
          bathAmount = amount;
        } else if (bathAddonsSum > 0 && bathAddonsSum < amount - 0.01) {
          category = "MIXED";
          bathAmount = bathAddonsSum;
          hotelAmount = amount - bathAddonsSum;
        } else if (bathAddonsSum > 0) {
          category = "BATH";
          hotelAmount = 0;
          bathAmount = amount;
        } else {
          category = "HOTEL";
          hotelAmount = amount;
          bathAmount = 0;
        }

        return {
          ...p,
          kind: isRefund ? ("REFUND" as const) : ("PAYMENT" as const),
          category,
          hotelAmount,
          bathAmount,
        };
      });

      const gross = enriched.reduce(
        (acc, p) => (p.kind === "PAYMENT" ? acc + Number(p.amount) : acc),
        0
      );
      const refunded = enriched.reduce(
        (acc, p) => (p.kind === "REFUND" ? acc + Number(p.amount) : acc),
        0
      );
      const total = gross - refunded;

      const byMethod = enriched.reduce<Record<string, number>>((acc, p) => {
        const sign = p.kind === "REFUND" ? -1 : 1;
        acc[p.method] = (acc[p.method] ?? 0) + sign * Number(p.amount);
        return acc;
      }, {});
      const byCategory = enriched.reduce(
        (acc, p) => {
          const sign = p.kind === "REFUND" ? -1 : 1;
          acc.hotel += sign * p.hotelAmount;
          acc.bath += sign * p.bathAmount;
          return acc;
        },
        { hotel: 0, bath: 0 }
      );

      return reply.send({
        monthStart: monthStart.toISOString(),
        monthEnd: monthEnd.toISOString(),
        total,
        gross,
        refunded,
        byMethod,
        byCategory,
        payments: enriched,
      });
    }
  );

  // ─── GET /admin/lodging-pricing — tarifas de hospedaje (singleton) ─
  fastify.get(
    "/admin/lodging-pricing",
    { preHandler: [authMiddleware, adminMiddleware] },
    async () => {
      const row = await prisma.lodgingPricing.upsert({
        where: { id: "singleton" },
        update: {},
        create: { id: "singleton" },
      });
      return {
        pricePerDaySmall: Number(row.pricePerDaySmall),
        pricePerDayLarge: Number(row.pricePerDayLarge),
        largeWeightKg: Number(row.largeWeightKg),
        medicationSurchargePct: Number(row.medicationSurchargePct),
        updatedAt: row.updatedAt,
      };
    }
  );

  // ─── PATCH /admin/lodging-pricing — actualizar tarifas ────────
  fastify.patch<{
    Body: Partial<{
      pricePerDaySmall: number;
      pricePerDayLarge: number;
      largeWeightKg: number;
      medicationSurchargePct: number;
    }>;
  }>(
    "/admin/lodging-pricing",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const body = request.body ?? {};
      const data: Record<string, number> = {};

      if (body.pricePerDaySmall != null) {
        if (!(body.pricePerDaySmall > 0)) {
          return reply.status(400).send({ error: "pricePerDaySmall debe ser > 0" });
        }
        data.pricePerDaySmall = body.pricePerDaySmall;
      }
      if (body.pricePerDayLarge != null) {
        if (!(body.pricePerDayLarge > 0)) {
          return reply.status(400).send({ error: "pricePerDayLarge debe ser > 0" });
        }
        data.pricePerDayLarge = body.pricePerDayLarge;
      }
      if (body.largeWeightKg != null) {
        if (!(body.largeWeightKg > 0)) {
          return reply.status(400).send({ error: "largeWeightKg debe ser > 0" });
        }
        data.largeWeightKg = body.largeWeightKg;
      }
      if (body.medicationSurchargePct != null) {
        if (body.medicationSurchargePct < 0 || body.medicationSurchargePct > 1) {
          return reply
            .status(400)
            .send({ error: "medicationSurchargePct debe estar entre 0 y 1" });
        }
        data.medicationSurchargePct = body.medicationSurchargePct;
      }

      if (Object.keys(data).length === 0) {
        return reply.status(400).send({ error: "No hay cambios" });
      }

      const row = await prisma.lodgingPricing.upsert({
        where: { id: "singleton" },
        update: data,
        create: { id: "singleton", ...data },
      });
      return {
        pricePerDaySmall: Number(row.pricePerDaySmall),
        pricePerDayLarge: Number(row.pricePerDayLarge),
        largeWeightKg: Number(row.largeWeightKg),
        medicationSurchargePct: Number(row.medicationSurchargePct),
        updatedAt: row.updatedAt,
      };
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
      if (reservation.reservationType !== "STAY" || !reservation.checkIn || !reservation.checkOut) {
        return reply.status(400).send({ error: "Solo se pueden asignar cuartos a hospedajes" });
      }

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || !room.isActive) {
        return reply.status(400).send({ error: "Cuarto no disponible" });
      }

      // Check room availability (solo hospedajes)
      const conflict = await prisma.reservation.findFirst({
        where: {
          reservationType: "STAY",
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

  // ─── POST /admin/reservations/:id/cancel ───────────────────────
  // El admin marca la reserva como CANCELLED y envía push al cliente para
  // que él elija cómo recibir el reembolso (tarjeta o saldo a favor). El
  // refund mismo se procesa cuando el cliente confirma vía POST
  // /reservations/:id/issue-refund.
  fastify.post<{ Params: { id: string } }>(
    "/admin/reservations/:id/cancel",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: { payments: true, pet: true },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
      if (!["PENDING", "CONFIRMED"].includes(reservation.status)) {
        return reply.status(400).send({
          error: "Solo se pueden cancelar reservas pendientes o confirmadas",
        });
      }

      const refundAmount = reservation.payments
        .filter((p) => p.status === "PAID" || p.status === "PARTIAL")
        .reduce((s, p) => s + Number(p.amount), 0);

      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: "CANCELLED" },
      });

      // Notifica al cliente. Si hay monto pagado, le pedimos elegir cómo
      // recibir el reembolso; si no, solo informamos la cancelación.
      if (refundAmount > 0) {
        await notifyUser(prisma, {
          userId: reservation.ownerId,
          type: "GENERAL",
          title: "Tu reserva fue cancelada",
          body: `Cancelamos la reserva de ${reservation.pet.name}. Toca para elegir cómo recibir tu reembolso de $${refundAmount.toLocaleString("es-MX")}.`,
          data: {
            action: "CHOOSE_REFUND",
            reservationId: reservation.id,
            refundAmount,
          },
        });
      } else {
        await notifyUser(prisma, {
          userId: reservation.ownerId,
          type: "GENERAL",
          title: "Tu reserva fue cancelada",
          body: `Cancelamos la reserva de ${reservation.pet.name}.`,
          data: { reservationId: reservation.id },
        });
      }

      return reply.send({
        success: true,
        reservationId: reservation.id,
        refundAmount,
        awaitingClientChoice: refundAmount > 0,
      });
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

      return { creditBalance: Number(updatedUser.creditBalance) };
    }
  );

  // GET /admin/cartillas/pending-count — cuántas cartillas están esperando revisión
  fastify.get(
    "/admin/cartillas/pending-count",
    { preHandler: [authMiddleware, adminMiddleware] },
    async () => {
      const pending = await prisma.pet.count({
        where: { cartillaStatus: "PENDING", isActive: true },
      });
      return { pending };
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
          vaccines: {
            orderBy: { appliedAt: "desc" },
            include: {
              catalog: {
                select: { id: true, code: true, displayName: true },
              },
            },
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
      const data = parsed.data;

      const pet = await prisma.pet.findUnique({ where: { id: request.params.id } });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      if (!pet.cartillaUrl) {
        return reply.status(400).send({ error: "La mascota no tiene cartilla subida" });
      }

      const reviewedAt = new Date();

      if (data.action === "APPROVE") {
        const vaccines = data.vaccines ?? [];

        // Validar catalogIds antes de la transacción para fallar rápido con 400.
        if (vaccines.length > 0) {
          const catalogIds = [...new Set(vaccines.map((v) => v.catalogId))];
          const catalogs = await prisma.vaccineCatalog.findMany({
            where: { id: { in: catalogIds }, isActive: true },
            select: { id: true, displayName: true },
          });
          if (catalogs.length !== catalogIds.length) {
            return reply
              .status(400)
              .send({ error: "Uno o más tipos de vacuna no son válidos" });
          }
          const catalogMap = new Map(catalogs.map((c) => [c.id, c]));

          await prisma.$transaction([
            prisma.pet.update({
              where: { id: pet.id },
              data: {
                cartillaStatus: "APPROVED",
                cartillaReviewedAt: reviewedAt,
                cartillaReviewedById: request.userId,
                cartillaRejectionReason: null,
              },
            }),
            ...vaccines.map((v) =>
              prisma.vaccine.create({
                data: {
                  petId: pet.id,
                  catalogId: v.catalogId,
                  name: catalogMap.get(v.catalogId)!.displayName,
                  appliedAt: v.appliedAt,
                  expiresAt: v.expiresAt,
                  vetName: v.vetName ?? null,
                },
              })
            ),
          ]);
        } else {
          await prisma.pet.update({
            where: { id: pet.id },
            data: {
              cartillaStatus: "APPROVED",
              cartillaReviewedAt: reviewedAt,
              cartillaReviewedById: request.userId,
              cartillaRejectionReason: null,
            },
          });
        }

        await notifyUser(prisma, {
          userId: pet.ownerId,
          type: "GENERAL",
          title: `Cartilla aprobada: ${pet.name}`,
          body: `La cartilla de ${pet.name} fue aprobada. Ya puedes reservar estancias.`,
          data: { petId: pet.id, kind: "CARTILLA_REVIEW", action: "APPROVE" },
        });

        const updated = await prisma.pet.findUnique({ where: { id: pet.id } });
        return updated;
      }

      // REJECT
      const reason = data.reason;
      const updated = await prisma.pet.update({
        where: { id: pet.id },
        data: {
          cartillaStatus: "REJECTED",
          cartillaReviewedAt: reviewedAt,
          cartillaReviewedById: request.userId,
          cartillaRejectionReason: reason?.trim() || null,
        },
      });

      await notifyUser(prisma, {
        userId: pet.ownerId,
        type: "GENERAL",
        title: `Cartilla rechazada: ${pet.name}`,
        body: `La cartilla de ${pet.name} fue rechazada${
          reason?.trim() ? `: ${reason.trim()}` : "."
        } Sube una nueva para revisarla.`,
        data: { petId: pet.id, kind: "CARTILLA_REVIEW", action: "REJECT" },
      });

      return updated;
    }
  );

  // PATCH /admin/vaccines/:id — editar una vacuna registrada
  // Si cambia expiresAt, se resetean los recordatorios para que vuelvan a
  // dispararse en las ventanas (30/7/0d) de la nueva fecha.
  fastify.patch<{ Params: { id: string } }>(
    "/admin/vaccines/:id",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const parsed = UpdateVaccineSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const patch = parsed.data;

      const vaccine = await prisma.vaccine.findUnique({
        where: { id: request.params.id },
      });
      if (!vaccine) {
        return reply.status(404).send({ error: "Vacuna no encontrada" });
      }

      const data: {
        catalogId?: string;
        name?: string;
        appliedAt?: Date;
        expiresAt?: Date;
        vetName?: string | null;
        reminded30dAt?: Date | null;
        reminded7dAt?: Date | null;
        reminded0dAt?: Date | null;
      } = {};

      if (patch.catalogId && patch.catalogId !== vaccine.catalogId) {
        const catalog = await prisma.vaccineCatalog.findFirst({
          where: { id: patch.catalogId, isActive: true },
        });
        if (!catalog) {
          return reply.status(400).send({ error: "Tipo de vacuna inválido" });
        }
        data.catalogId = catalog.id;
        data.name = catalog.displayName;
      }

      if (patch.appliedAt) data.appliedAt = patch.appliedAt;
      if (patch.vetName !== undefined) data.vetName = patch.vetName;

      if (patch.expiresAt) {
        const oldExpires = vaccine.expiresAt?.getTime();
        const newExpires = patch.expiresAt.getTime();
        data.expiresAt = patch.expiresAt;
        if (oldExpires !== newExpires) {
          data.reminded30dAt = null;
          data.reminded7dAt = null;
          data.reminded0dAt = null;
        }
      }

      const updated = await prisma.vaccine.update({
        where: { id: vaccine.id },
        data,
        include: {
          catalog: { select: { id: true, code: true, displayName: true } },
        },
      });
      return updated;
    }
  );

  // DELETE /admin/vaccines/:id — eliminar una vacuna
  fastify.delete<{ Params: { id: string } }>(
    "/admin/vaccines/:id",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const vaccine = await prisma.vaccine.findUnique({
        where: { id: request.params.id },
      });
      if (!vaccine) {
        return reply.status(404).send({ error: "Vacuna no encontrada" });
      }
      await prisma.vaccine.delete({ where: { id: vaccine.id } });
      return { id: vaccine.id };
    }
  );
}
