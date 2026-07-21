import { FastifyInstance } from "fastify";
import {
  createAuthMiddleware,
  createAdminMiddleware,
  createStaffMiddleware,
  invalidateAuthCache,
} from "../middleware/auth";
import {
  ReviewCartillaSchema,
  CartillaStatusEnum,
  UpdateVaccineSchema,
  CreateChangeRequestSchema,
} from "@holidoginn/shared";
import { notifyUser, notifyUsers } from "../lib/notify";
import { triggerMaintenance } from "../lib/maintenance";
import {
  getLodgingPricing,
  computeDays,
  pricePerDayForWeight,
} from "../lib/pricing";

export default async function adminRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();
  const staffMiddleware = createStaffMiddleware();

  // GET /admin/stats — dashboard statistics
  fastify.get(
    "/admin/stats",
    { preHandler: [authMiddleware, adminMiddleware] },
    async () => {
      triggerMaintenance(prisma);
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

      // Acumulamos por roomId — un cuarto puede tener varias mascotas
      // hospedadas a la vez si su `capacity` es > 1.
      const occupancyByRoom = new Map<string, typeof occupiedReservations>();
      for (const r of occupiedReservations) {
        if (!r.roomId) continue;
        const list = occupancyByRoom.get(r.roomId) ?? [];
        list.push(r);
        occupancyByRoom.set(r.roomId, list);
      }

      return rooms.map((room) => {
        const list = occupancyByRoom.get(room.id) ?? [];
        const currentReservations = list.map((r) => ({
          reservationId: r.id,
          pet: r.pet,
          owner: { id: r.owner.id, name: `${r.owner.firstName} ${r.owner.lastName}` },
          staff: r.staff
            ? { id: r.staff.id, name: `${r.staff.firstName} ${r.staff.lastName}` }
            : null,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          // Legacy fields para no romper UI vieja
          petName: r.pet.name,
          ownerName: `${r.owner.firstName} ${r.owner.lastName}`,
        }));
        return {
          ...room,
          currentReservations,
          // Legacy: primera reservación. Deprecado; usar `currentReservations`.
          currentReservation: currentReservations[0] ?? null,
        };
      });
    }
  );

  // POST /admin/notifications/send — send notification to users
  fastify.post<{
    Body: {
      // Selección individual de usuarios, o broadcast por rol(es).
      userIds?: string[] | "all";
      roles?: ("OWNER" | "STAFF" | "ADMIN")[];
      title: string;
      body: string;
      type?: string;
    };
  }>(
    "/admin/notifications/send",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const { userIds, roles, title, body, type } = request.body;

      if (!title || !body) {
        return reply
          .status(400)
          .send({ error: "Título y mensaje son requeridos" });
      }

      let targetUserIds: string[];

      if (roles && roles.length > 0) {
        // Broadcast por rol: todos los usuarios activos de esos roles
        // (clientes/staff/admins, según selección).
        const users = await prisma.user.findMany({
          where: { role: { in: roles }, isActive: true },
          select: { id: true },
        });
        targetUserIds = users.map((u) => u.id);
      } else if (userIds === "all") {
        // Compat: "all" = todos los clientes (OWNER).
        const owners = await prisma.user.findMany({
          where: { role: "OWNER", isActive: true },
          select: { id: true },
        });
        targetUserIds = owners.map((u) => u.id);
      } else if (Array.isArray(userIds)) {
        targetUserIds = userIds;
      } else {
        targetUserIds = [];
      }

      if (targetUserIds.length === 0) {
        return reply
          .status(400)
          .send({ error: "No hay usuarios destinatarios" });
      }

      // `pushed` = cuántos recibieron push real (tienen la app); `sent` =
      // destinatarios totales (a todos se les crea la notificación in-app).
      const pushed = await notifyUsers(prisma, targetUserIds, {
        type: (type as any) ?? "GENERAL",
        title,
        body,
      });

      return reply
        .status(201)
        .send({ sent: targetUserIds.length, pushed });
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
        // Tarifa única por hora de guardería / horas extra (columna
        // daycareExtraHourPrice; nombre histórico de la migración web 0019).
        daycareHourPrice: Number(row.daycareExtraHourPrice),
        updatedAt: row.updatedAt,
      };
    }
  );

  // ─── Códigos de descuento (admin) ──────────────────────────────
  //   GET    /admin/discount-codes        listar
  //   POST   /admin/discount-codes        crear
  //   PATCH  /admin/discount-codes/:id    actualizar
  //   DELETE /admin/discount-codes/:id    borrar
  // Para el admin móvil; la web gestiona la MISMA tabla vía Supabase directo.
  const DISCOUNT_TYPES = ["PERCENT", "FIXED"] as const;

  // Normaliza + valida el cuerpo de un código. En creación (partial=false) exige
  // code/type/scope/value; en edición (partial=true) solo valida lo enviado.
  function parseDiscountBody(
    body: any,
    partial: boolean
  ): { error: string } | { data: Record<string, unknown> } {
    const data: Record<string, unknown> = {};
    if (!partial || body.code !== undefined) {
      const code = String(body.code ?? "").trim().toUpperCase();
      if (code.length < 2) return { error: "El código debe tener al menos 2 caracteres" };
      data.code = code;
    }
    if (!partial || body.type !== undefined) {
      if (!DISCOUNT_TYPES.includes(body.type)) return { error: "Tipo inválido" };
      data.type = body.type;
    }
    if (!partial || body.value !== undefined) {
      const value = Number(body.value);
      if (!Number.isFinite(value) || value <= 0) return { error: "El valor debe ser mayor a 0" };
      data.value = value;
    }
    if (body.minSubtotal !== undefined) {
      if (body.minSubtotal === null || body.minSubtotal === "") data.minSubtotal = null;
      else {
        const m = Number(body.minSubtotal);
        if (!Number.isFinite(m) || m < 0) return { error: "Mín. subtotal inválido" };
        data.minSubtotal = m;
      }
    }
    if (body.maxUses !== undefined) {
      if (body.maxUses === null || body.maxUses === "") data.maxUses = null;
      else {
        const n = Number(body.maxUses);
        if (!Number.isInteger(n) || n < 0) return { error: "Máx. usos inválido" };
        data.maxUses = n;
      }
    }
    if (body.firstOrderOnly !== undefined) data.firstOrderOnly = Boolean(body.firstOrderOnly);
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    return { data };
  }

  fastify.get(
    "/admin/discount-codes",
    { preHandler: [authMiddleware, adminMiddleware] },
    async () => {
      const rows = await prisma.discountCode.findMany({ orderBy: { code: "asc" } });
      return rows.map((d) => ({
        id: d.id,
        code: d.code,
        type: d.type,
        value: Number(d.value),
        minSubtotal: d.minSubtotal == null ? null : Number(d.minSubtotal),
        maxUses: d.maxUses,
        usesCount: d.usesCount,
        firstOrderOnly: d.firstOrderOnly,
        isActive: d.isActive,
      }));
    }
  );

  fastify.post(
    "/admin/discount-codes",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const parsed = parseDiscountBody(request.body ?? {}, false);
      if ("error" in parsed) return reply.status(400).send({ error: parsed.error });
      const code = parsed.data.code as string;
      const existing = await prisma.discountCode.findUnique({ where: { code } });
      if (existing) return reply.status(409).send({ error: "Ya existe un código con ese nombre" });
      const created = await prisma.discountCode.create({ data: parsed.data as any });
      return reply.status(201).send({ id: created.id });
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    "/admin/discount-codes/:id",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const parsed = parseDiscountBody(request.body ?? {}, true);
      if ("error" in parsed) return reply.status(400).send({ error: parsed.error });
      if (Object.keys(parsed.data).length === 0) {
        return reply.status(400).send({ error: "No hay cambios" });
      }
      // Si cambia el code, evitar colisión con otro registro.
      if (parsed.data.code) {
        const other = await prisma.discountCode.findUnique({
          where: { code: parsed.data.code as string },
        });
        if (other && other.id !== request.params.id) {
          return reply.status(409).send({ error: "Ya existe un código con ese nombre" });
        }
      }
      try {
        await prisma.discountCode.update({
          where: { id: request.params.id },
          data: parsed.data as any,
        });
      } catch {
        return reply.status(404).send({ error: "Código no encontrado" });
      }
      return { ok: true };
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    "/admin/discount-codes/:id",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      try {
        await prisma.discountCode.delete({ where: { id: request.params.id } });
      } catch {
        return reply.status(404).send({ error: "Código no encontrado" });
      }
      return { ok: true };
    }
  );

  // ─── PATCH /admin/lodging-pricing — actualizar tarifas ────────
  fastify.patch<{
    Body: Partial<{
      pricePerDaySmall: number;
      pricePerDayLarge: number;
      largeWeightKg: number;
      medicationSurchargePct: number;
      daycareHourPrice: number;
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
      if (body.daycareHourPrice != null) {
        if (!(body.daycareHourPrice > 0)) {
          return reply.status(400).send({ error: "daycareHourPrice debe ser > 0" });
        }
        data.daycareExtraHourPrice = body.daycareHourPrice;
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
        daycareHourPrice: Number(row.daycareExtraHourPrice),
        updatedAt: row.updatedAt,
      };
    }
  );

  // ─── GET /admin/delivery-config — config servicio a domicilio ──
  fastify.get(
    "/admin/delivery-config",
    { preHandler: [authMiddleware, adminMiddleware] },
    async () => {
      const row = await prisma.deliveryConfig.upsert({
        where: { id: "singleton" },
        update: {},
        create: { id: "singleton" },
      });
      return {
        baseFee: Number(row.baseFee),
        pricePerKm: Number(row.pricePerKm),
        isActive: row.isActive,
        updatedAt: row.updatedAt,
      };
    }
  );

  // ─── PATCH /admin/delivery-config — actualizar precios domicilio ─
  fastify.patch<{
    Body: Partial<{
      baseFee: number;
      pricePerKm: number;
      isActive: boolean;
    }>;
  }>(
    "/admin/delivery-config",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const body = request.body ?? {};
      const data: Record<string, number | boolean> = {};

      if (body.baseFee != null) {
        if (body.baseFee < 0) {
          return reply.status(400).send({ error: "baseFee no puede ser negativo" });
        }
        data.baseFee = body.baseFee;
      }
      if (body.pricePerKm != null) {
        if (body.pricePerKm < 0) {
          return reply.status(400).send({ error: "pricePerKm no puede ser negativo" });
        }
        data.pricePerKm = body.pricePerKm;
      }
      if (body.isActive != null) {
        data.isActive = body.isActive;
      }

      if (Object.keys(data).length === 0) {
        return reply.status(400).send({ error: "No hay cambios" });
      }

      const row = await prisma.deliveryConfig.upsert({
        where: { id: "singleton" },
        update: data,
        create: { id: "singleton", ...data },
      });
      return {
        baseFee: Number(row.baseFee),
        pricePerKm: Number(row.pricePerKm),
        isActive: row.isActive,
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
  // STAFF y ADMIN pueden asignar/cambiar el cuarto de un hospedaje.
  fastify.patch<{ Params: { id: string }; Body: { roomId: string } }>(
    "/admin/reservations/:id/assign-room",
    { preHandler: [authMiddleware, staffMiddleware] },
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

      // Capacity guard: ocupación actual + esta reserva ≤ capacity.
      const taken = await prisma.reservation.count({
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
      if (taken + 1 > room.capacity) {
        return reply.status(409).send({
          error: `Cuarto ${room.name} sin capacidad en esas fechas (${taken}/${room.capacity} ocupado).`,
          code: "ROOM_AT_CAPACITY",
        });
      }

      const updated = await prisma.reservation.update({
        where: { id: request.params.id },
        data: { roomId },
        include: { room: true },
      });

      return updated;
    }
  );

  // ─── Cambio de fechas por el admin ─────────────────────────────
  // A diferencia del flujo de change requests (que recalcula el total desde
  // cero), aquí el nuevo total se obtiene por DELTA de hospedaje: noches ×
  // tarifa vigente + recargo por medicamento. Así se preservan addons,
  // domicilio y descuentos que ya están dentro de totalAmount.
  async function buildAdminDatesChange(
    reservationId: string,
    newCheckIn: Date,
    newCheckOut: Date
  ) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { pet: true },
    });
    if (!reservation) {
      return { error: "Reservación no encontrada", statusCode: 404 as const };
    }
    if (
      reservation.reservationType !== "STAY" ||
      !reservation.checkIn ||
      !reservation.checkOut
    ) {
      return {
        error: "Solo se pueden modificar fechas de hospedajes",
        statusCode: 400 as const,
      };
    }
    if (!["CONFIRMED", "CHECKED_IN"].includes(reservation.status)) {
      return {
        error: "Solo se pueden modificar reservas confirmadas o activas",
        statusCode: 400 as const,
      };
    }
    if (newCheckOut <= newCheckIn) {
      return {
        error: "La fecha de salida debe ser posterior a la entrada",
        statusCode: 400 as const,
      };
    }

    const config = await getLodgingPricing(prisma);
    const pricePerDay = pricePerDayForWeight(reservation.pet.weight, config);
    const surchargePct = reservation.medicationNotes
      ? config.medicationSurchargePct
      : 0;
    const lodgingFor = (from: Date, to: Date) => {
      const days = computeDays(from, to);
      const lodging = pricePerDay * days;
      return { days, total: lodging + Math.ceil(lodging * surchargePct) };
    };
    const current = lodgingFor(reservation.checkIn, reservation.checkOut);
    const next = lodgingFor(newCheckIn, newCheckOut);
    const currentTotal = Number(reservation.totalAmount);
    const newTotal = Math.max(0, currentTotal + (next.total - current.total));

    return {
      reservation,
      preview: {
        newTotalDays: next.days,
        newTotal,
        currentTotal,
        delta: newTotal - currentTotal,
      },
    };
  }

  // ─── POST /admin/reservations/:id/dates/preview ────────────────
  fastify.post<{ Params: { id: string } }>(
    "/admin/reservations/:id/dates/preview",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const parsed = CreateChangeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const result = await buildAdminDatesChange(
        request.params.id,
        parsed.data.newCheckIn,
        parsed.data.newCheckOut
      );
      if ("error" in result) {
        return reply.status(result.statusCode ?? 400).send({ error: result.error });
      }
      return reply.send(result.preview);
    }
  );

  // ─── PATCH /admin/reservations/:id/dates — modificar estadía ───
  fastify.patch<{ Params: { id: string } }>(
    "/admin/reservations/:id/dates",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const parsed = CreateChangeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { newCheckIn, newCheckOut } = parsed.data;

      const result = await buildAdminDatesChange(
        request.params.id,
        newCheckIn,
        newCheckOut
      );
      if ("error" in result) {
        return reply.status(result.statusCode ?? 400).send({ error: result.error });
      }
      const { reservation, preview } = result;

      // Si el cliente tiene una solicitud de cambio pendiente, procesarla
      // primero evita pisar los montos que ella ya calculó.
      const pendingCR = await prisma.reservationChangeRequest.findFirst({
        where: { reservationId: reservation.id, status: "PENDING" },
      });
      if (pendingCR) {
        return reply.status(409).send({
          error:
            "El cliente tiene una solicitud de cambio pendiente. Apruébala o recházala antes de modificar las fechas.",
        });
      }

      // Capacity guard del cuarto asignado en las nuevas fechas.
      if (reservation.roomId) {
        const room = await prisma.room.findUnique({
          where: { id: reservation.roomId },
        });
        if (room) {
          const taken = await prisma.reservation.count({
            where: {
              reservationType: "STAY",
              roomId: reservation.roomId,
              id: { not: reservation.id },
              status: { notIn: ["CANCELLED", "CHECKED_OUT"] as any },
              AND: [
                { checkIn: { lt: newCheckOut } },
                { checkOut: { gt: newCheckIn } },
              ],
            },
          });
          if (taken + 1 > room.capacity) {
            return reply.status(409).send({
              error: `Cuarto ${room.name} sin capacidad en las nuevas fechas (${taken}/${room.capacity} ocupado).`,
              code: "ROOM_AT_CAPACITY",
            });
          }
        }
      }

      await prisma.reservation.update({
        where: { id: reservation.id },
        data: {
          checkIn: newCheckIn,
          checkOut: newCheckOut,
          totalDays: preview.newTotalDays,
          totalAmount: preview.newTotal,
          depositDeadline:
            reservation.paymentType === "DEPOSIT"
              ? newCheckIn
              : reservation.depositDeadline,
        },
      });

      // Las fechas se guardan como día UTC; formatear en UTC evita el
      // corrimiento de un día.
      const fmtDay = (d: Date) =>
        d.toLocaleDateString("es-MX", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        });
      const range = `${fmtDay(newCheckIn)} al ${fmtDay(newCheckOut)}`;
      const nightsLabel = `${preview.newTotalDays} ${preview.newTotalDays === 1 ? "noche" : "noches"}`;

      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "GENERAL",
        title: "Fechas de estadía actualizadas 📅",
        body: `La estadía de ${reservation.pet.name} ahora es del ${range} (${nightsLabel}). Nuevo total: $${preview.newTotal.toLocaleString("es-MX")}.`,
        data: { reservationId: reservation.id },
      });
      if (reservation.staffId) {
        await notifyUser(prisma, {
          userId: reservation.staffId,
          type: "GENERAL",
          title: `Cambio de fechas: ${reservation.pet.name}`,
          body: `El admin movió la estadía al ${range} (${nightsLabel}).`,
          data: { reservationId: reservation.id },
        });
      }

      return reply.send({ success: true, ...preview });
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
      if (reservation.status !== "CONFIRMED") {
        return reply.status(400).send({
          error: "Solo se pueden cancelar reservas confirmadas",
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
        data: {
          creditBalance: { increment: amount },
          lastCreditEntryAt: new Date(),
        },
      });
      // El saldo a favor se lee de /users/me — que no sirva una copia vieja.
      invalidateAuthCache(updatedUser.clerkId);

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
          dewormings: {
            orderBy: { appliedAt: "desc" },
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
      const hasCartilla =
        pet.cartillaPhotos.length > 0 || Boolean(pet.cartillaUrl);
      if (!hasCartilla) {
        return reply.status(400).send({ error: "La mascota no tiene cartilla subida" });
      }

      const reviewedAt = new Date();

      if (data.action === "APPROVE") {
        const vaccines = data.vaccines ?? [];
        const dewormings = data.dewormings ?? [];

        // Validar catalogIds antes de la transacción para fallar rápido con 400.
        // El tipo es opcional: solo validamos los renglones que sí lo traen.
        let catalogMap = new Map<string, { id: string; displayName: string }>();
        const catalogIds = [
          ...new Set(
            vaccines
              .map((v) => v.catalogId)
              .filter((id): id is string => Boolean(id))
          ),
        ];
        if (catalogIds.length > 0) {
          const catalogs = await prisma.vaccineCatalog.findMany({
            where: { id: { in: catalogIds }, isActive: true },
            select: { id: true, displayName: true },
          });
          if (catalogs.length !== catalogIds.length) {
            return reply
              .status(400)
              .send({ error: "Uno o más tipos de vacuna no son válidos" });
          }
          catalogMap = new Map(catalogs.map((c) => [c.id, c]));
        }

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
                catalogId: v.catalogId ?? null,
                name: v.catalogId
                  ? catalogMap.get(v.catalogId)!.displayName
                  : "Vacuna (sin especificar)",
                appliedAt: v.appliedAt,
                expiresAt: v.expiresAt,
                vetName: v.vetName ?? null,
              },
            })
          ),
          ...dewormings.map((d) =>
            prisma.deworming.create({
              data: {
                petId: pet.id,
                type: d.type,
                productName: d.productName ?? null,
                appliedAt: d.appliedAt,
                expiresAt: d.expiresAt ?? null,
                notes: d.notes ?? null,
              },
            })
          ),
        ]);

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

  // ────────────────────────────────────────────────────────────
  //  POST /internal/expire-credits — cron diario
  //  Expira saldo a favor con >90 días sin actividad y manda
  //  notificación de "expira pronto" 14 días antes.
  //  Protegido por header x-cron-secret. CRON_SECRET DEBE estar configurado en
  //  producción: si falta, el endpoint queda cerrado (401) en vez de abierto.
  // ────────────────────────────────────────────────────────────
  fastify.post("/internal/expire-credits", async (request, reply) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers["x-cron-secret"] !== secret) {
      return reply.status(401).send({ error: "No autorizado" });
    }

    const now = new Date();
    const expireCutoff = new Date(now.getTime() - 90 * 86_400_000);
    const warnCutoff = new Date(now.getTime() - 76 * 86_400_000);

    // 1) Expirar saldos inactivos por más de 90 días.
    const expirable = await prisma.user.findMany({
      where: {
        creditBalance: { gt: 0 },
        lastCreditEntryAt: { lt: expireCutoff },
      },
      select: {
        id: true,
        firstName: true,
        email: true,
        creditBalance: true,
      },
    });

    let expired = 0;
    for (const user of expirable) {
      const amount = Number(user.creditBalance);
      if (amount <= 0) continue;
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            creditBalance: 0,
            lastCreditEntryAt: new Date(),
          },
        });
        await tx.creditLedger.create({
          data: {
            userId: user.id,
            type: "CREDIT_EXPIRED",
            amount: -amount,
            balanceAfter: 0,
            description: "Saldo a favor expirado por 90 días de inactividad",
          },
        });
        await tx.notification.create({
          data: {
            userId: user.id,
            type: "GENERAL",
            title: "Tu saldo a favor expiró",
            body: `Tu saldo de $${amount.toLocaleString("es-MX")} expiró por inactividad. Si crees que es un error contáctanos.`,
            data: { kind: "credit_expired", amount },
          },
        });
      });
      expired++;
    }

    // 2) Avisar 14 días antes (entre 76 y 90 días sin actividad).
    const expiringSoon = await prisma.user.findMany({
      where: {
        creditBalance: { gt: 0 },
        lastCreditEntryAt: {
          lt: warnCutoff,
          gte: expireCutoff,
        },
      },
      select: {
        id: true,
        firstName: true,
        creditBalance: true,
        lastCreditEntryAt: true,
      },
    });

    let warned = 0;
    for (const user of expiringSoon) {
      // Idempotente: una sola advertencia por usuario por ventana de expiración.
      // Buscamos notificación de "credit_expiring" creada después de lastCreditEntryAt.
      const lastActivity = user.lastCreditEntryAt ?? new Date(0);
      const existingWarning = await prisma.notification.findFirst({
        where: {
          userId: user.id,
          type: "GENERAL",
          createdAt: { gte: lastActivity },
          data: { path: ["kind"], equals: "credit_expiring" },
        },
      });
      if (existingWarning) continue;

      const amount = Number(user.creditBalance);
      const expiresInDays = Math.ceil(
        (lastActivity.getTime() + 90 * 86_400_000 - now.getTime()) / 86_400_000,
      );
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: "GENERAL",
          title: "Tu saldo a favor expira pronto ⏰",
          body: `Tienes $${amount.toLocaleString("es-MX")} de saldo que expirará en ${expiresInDays} días si no lo usas. Aplícalo en tu próxima reserva.`,
          data: { kind: "credit_expiring", amount, expiresInDays },
        },
      });
      warned++;
    }

    return reply.send({
      expired,
      warned,
      checkedExpirable: expirable.length,
      checkedExpiring: expiringSoon.length,
    });
  });
}
