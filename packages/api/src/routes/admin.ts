import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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
  AdminUpdateReservationSchema,
  AdminCreateAddonSchema,
  AdminUpdateAddonSchema,
} from "@holidoginn/shared";
import { Prisma } from "@holidoginn/db";
import {
  notifyUsers,
  notifyPetAudience,
  notifyTeamReservationUpdated,
} from "../lib/notify";
import { triggerMaintenance } from "../lib/maintenance";
import { invalidateQuoteCatalog } from "../lib/quoteCatalog";
import { extraerCartilla } from "../lib/ocr";
import { dewormSizeFromWeight } from "../lib/pricing";
import {
  assignStaff,
  assignRoom,
  previewDatesChange,
  applyDatesChange,
  updateReservationBasics,
  addReservationAddon,
  updateReservationAddon,
  cancelReservations,
  type OpActor,
  type OpError,
} from "../lib/reservationAdminOps";
import {
  listPayouts,
  getPayoutBreakdown,
  syncRecentPayouts,
  listarCobrosSinRegistrar,
  registrarCobroDeLinea,
  avisarPayoutSincronizado,
} from "../lib/payouts";

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

        // Ingresos del mes (brutos): suma PAID + PARTIAL en el mes calendario
        // completo. Sin join a reservations, así que incluye TODO lo cobrado:
        // hospedaje, estética, guardería y las ventas de tienda (mostrador y en
        // línea, que desde la entrega de ventas de tienda sí generan Payment).
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
          order: { select: { id: true, orderNumber: true, channel: true } },
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

        let category: "HOTEL" | "BATH" | "MIXED" | "STORE";
        let hotelAmount: number;
        let bathAmount: number;

        // Venta de tienda (mostrador o en línea): no cuelga de una reserva, así
        // que no es hotel ni estética. Va primero porque sin esta rama caería en
        // el `else` final y se reportaría como HOTEL.
        if (p.orderId) {
          category = "STORE";
          hotelAmount = 0;
          bathAmount = 0;
        } else if (p.reservation?.reservationType === "BATH") {
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
          // Las ventas de tienda no reparten entre hotel/estética: el monto
          // entero es su propia banda (hotelAmount y bathAmount quedan en 0).
          if (p.category === "STORE") acc.store += sign * Number(p.amount);
          return acc;
        },
        { hotel: 0, bath: 0, store: 0 }
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

  // Más depósitos nuevos que esto en una sola corrida y el aviso se agrupa:
  // la primera vez que corre el cron trae todo el rezago de golpe.
  const AVISOS_INDIVIDUALES_MAX = 3;

  // ─── Depósitos de Stripe (SPEI) ──────────────────────────────────
  // Contestan "me llegó una transferencia de $X, ¿de qué reservas es?".
  // Leen de stripe_payouts/stripe_payout_lines, que el webhook payout.paid
  // mantiene al día — no llaman a Stripe salvo en /sync.

  // GET /admin/payouts?limit=20&amount=663.80
  fastify.get<{ Querystring: { limit?: string; amount?: string } }>(
    "/admin/payouts",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const limitRaw = Number(request.query.limit);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50)
        : 20;

      // El monto se teclea desde el estado de cuenta del banco ("663.80"), así
      // que se acepta con o sin separadores de miles.
      const amountRaw = request.query.amount?.replace(/[$,\s]/g, "");
      const amount = amountRaw ? Number(amountRaw) : undefined;
      if (amountRaw && (!Number.isFinite(amount) || amount! < 0)) {
        return reply.status(400).send({ error: "Monto inválido" });
      }

      return reply.send({ payouts: await listPayouts(prisma, { limit, amount }) });
    }
  );

  // GET /admin/payouts/:id — desglose línea por línea
  fastify.get<{ Params: { id: string } }>(
    "/admin/payouts/:id",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const detalle = await getPayoutBreakdown(prisma, request.params.id);
      if (!detalle) {
        return reply.status(404).send({ error: "Depósito no encontrado" });
      }
      return reply.send(detalle);
    }
  );

  // POST /admin/payouts/sync — refresco manual contra Stripe.
  // Red de seguridad para cuando el webhook no corrió (endpoint mal configurado,
  // API caída) o para traer depósitos anteriores a esta feature.
  fastify.post<{ Body?: { limit?: number } }>(
    "/admin/payouts/sync",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const limitRaw = Number(request.body?.limit);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50)
        : 10;
      try {
        const results = await syncRecentPayouts(prisma, { limit });
        // Un depósito que no se pudo bajar de Stripe NO es un descuadre: el
        // desglose no existe todavía. Mezclarlos haría que la app avisara "no
        // cuadra" de algo que ni siquiera alcanzó a conciliarse.
        return reply.send({
          synced: results.filter((r) => !r.error).length,
          descuadrados: results.filter((r) => !r.error && !r.cuadra).map((r) => r.payoutId),
          fallidos: results.filter((r) => r.error).map((r) => r.payoutId),
          results,
        });
      } catch (err) {
        request.log.error({ err }, "Falló el sync de depósitos de Stripe");
        return reply.status(502).send({ error: "No se pudo consultar Stripe" });
      }
    }
  );

  // GET /admin/payouts/sin-registrar — cobros que Stripe depositó pero que
  // nunca llegaron a `payments`. Es dinero que entró y que los ingresos no
  // cuentan; sin esta lista había que abrir depósito por depósito para verlos.
  // Va ANTES de /admin/payouts/:id sólo por claridad: Fastify da prioridad a la
  // ruta estática sobre la paramétrica, no depende del orden.
  fastify.get<{ Querystring: { limit?: string } }>(
    "/admin/payouts/sin-registrar",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const limitRaw = Number(request.query.limit);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(Math.trunc(limitRaw), 1), 60)
        : 30;
      return reply.send(await listarCobrosSinRegistrar(prisma, { limit }));
    }
  );

  // POST /admin/payouts/lines/:lineId/register-payment — dar de alta ese cobro.
  // Sólo admin: crea un ingreso, y el staff no toca dinero.
  fastify.post<{
    Params: { lineId: string };
    Body?: { reservationId?: string };
  }>(
    "/admin/payouts/lines/:lineId/register-payment",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const res = await registrarCobroDeLinea(prisma, {
        lineId: request.params.lineId,
        reservationId: request.body?.reservationId ?? null,
      });
      if (!res.ok) return reply.status(400).send({ error: res.error });
      return reply.status(res.data.creado ? 201 : 200).send(res.data);
    }
  );

  // POST /internal/payouts/lines/:lineId/register-payment
  // El mismo alta que la ruta de arriba, para el admin web. Se autentica como
  // los crons (x-cron-secret) porque el Clerk del panel web es otra instancia y
  // esta API no puede validar sus tokens. La lógica NO se duplica allá: guardar
  // el bruto, la comisión aparte y re-conciliar el depósito tiene demasiadas
  // formas de salir mal como para tenerlo escrito dos veces.
  fastify.post<{
    Params: { lineId: string };
    Body?: { reservationId?: string };
  }>("/internal/payouts/lines/:lineId/register-payment", async (request, reply) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers["x-cron-secret"] !== secret) {
      return reply.status(401).send({ error: "No autorizado" });
    }
    const res = await registrarCobroDeLinea(prisma, {
      lineId: request.params.lineId,
      reservationId: request.body?.reservationId ?? null,
    });
    if (!res.ok) return reply.status(400).send({ error: res.error });
    return reply.status(res.data.creado ? 201 : 200).send(res.data);
  });

  // ────────────────────────────────────────────────────────────
  //  POST /internal/payouts-sync — cron diario
  //  Trae de Stripe los depósitos recientes y los concilia.
  //
  //  Existe porque el webhook `payout.paid` era el ÚNICO camino: si se
  //  desconfigura, si Stripe agota sus reintentos (3 días y desiste) o si la API
  //  estaba caída, el depósito no entra NUNCA y nadie se entera — la pantalla
  //  simplemente se queda en la última fecha que alcanzó a llegar.
  //
  //  Protegido por x-cron-secret, igual que los demás /internal. Si el secreto
  //  falta, el endpoint queda cerrado (401) en vez de abierto.
  // ────────────────────────────────────────────────────────────
  fastify.post<{ Body?: { limit?: number } }>(
    "/internal/payouts-sync",
    async (request, reply) => {
      const secret = process.env.CRON_SECRET;
      if (!secret || request.headers["x-cron-secret"] !== secret) {
        return reply.status(401).send({ error: "No autorizado" });
      }

      const limitRaw = Number(request.body?.limit);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50)
        : 15;

      let results;
      try {
        results = await syncRecentPayouts(prisma, { limit });
      } catch (err) {
        request.log.error({ err }, "[payouts-sync] no se pudo consultar Stripe");
        return reply.status(502).send({ error: "No se pudo consultar Stripe" });
      }

      // Sólo se avisa de los que NO existían: el cron corre todos los días sobre
      // la misma ventana, y notificar los ya conocidos sería un push diario
      // repetido del mismo depósito.
      const nuevos = results.filter((r) => r.esNuevo && !r.error);
      if (nuevos.length > 0) {
        const fechas = new Map(
          (
            await prisma.stripePayout.findMany({
              where: { id: { in: nuevos.map((r) => r.payoutId) } },
              select: { id: true, arrivalDate: true },
            })
          ).map((p) => [p.id, p.arrivalDate])
        );

        // La PRIMERA corrida trae de golpe todo lo que el webhook nunca metió:
        // un push por depósito serían diez notificaciones seguidas de cosas que
        // pasaron hace semanas. A partir de tres, un solo aviso con el total.
        if (nuevos.length > AVISOS_INDIVIDUALES_MAX) {
          const total = nuevos.reduce((a, r) => a + r.amount, 0);
          const admins = await prisma.user.findMany({
            where: { role: "ADMIN", isActive: true },
            select: { id: true },
          });
          if (admins.length > 0) {
            await notifyUsers(
              prisma,
              admins.map((a) => a.id),
              {
                type: "PAYOUT_PAID",
                title: `🏦 ${nuevos.length} depósitos nuevos — $${total.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                body: "Se pusieron al día los depósitos de Stripe. Toca para ver de qué reservas vienen.",
                data: { kind: "STRIPE_PAYOUT_BATCH", count: nuevos.length, amount: total },
              }
            );
          }
        } else {
          for (const r of nuevos) {
            await avisarPayoutSincronizado(prisma, {
              payoutId: r.payoutId,
              amount: r.amount,
              lineCount: r.lineCount,
              arrivalDate: fechas.get(r.payoutId) ?? new Date(),
            });
          }
        }
      }

      const fallidos = results.filter((r) => r.error);
      const descuadrados = results.filter((r) => !r.error && !r.cuadra);

      // Sólo se avisa de los problemas que APARECEN hoy, no de los que siguen
      // ahí. El cron reevalúa la misma ventana de depósitos todos los días y un
      // descuadre no se corrige solo (hay que mirarlo en Stripe a mano): avisar
      // por estado y no por novedad manda la misma alerta de prioridad alta a
      // todos los admins cada mañana durante semanas, hasta que ese depósito
      // salga de la ventana. Los que siguen mal quedan en el log y con su
      // "No cuadra" a la vista en la pantalla.
      const problemasNuevos = [...fallidos, ...descuadrados].filter((r) => r.esNuevo);
      if (problemasNuevos.length > 0) {
        const fallidosNuevos = problemasNuevos.filter((r) => r.error);
        const descuadradosNuevos = problemasNuevos.filter((r) => !r.error);
        try {
          const admins = await prisma.user.findMany({
            where: { role: "ADMIN", isActive: true },
            select: { id: true },
          });
          if (admins.length > 0) {
            await notifyUsers(
              prisma,
              admins.map((a) => a.id),
              {
                type: "STAFF_ALERT",
                title: "⚠️ Depósitos de Stripe con problemas",
                body:
                  fallidosNuevos.length > 0
                    ? `${fallidosNuevos.length} depósito(s) no se pudieron conciliar. Revisa Depósitos de Stripe.`
                    : `${descuadradosNuevos.length} depósito(s) no cuadran con el desglose. Revisa Depósitos de Stripe.`,
                priority: "high",
              }
            );
          }
        } catch (err) {
          request.log.warn({ err }, "[payouts-sync] no se pudo avisar del problema");
        }
      }

      // Railway solo guarda logs: sin esto no hay forma de saber si el cron corrió.
      request.log.info(
        {
          sincronizados: results.length,
          nuevos: nuevos.map((r) => r.payoutId),
          descuadrados: descuadrados.map((r) => r.payoutId),
          fallidos: fallidos.map((r) => r.payoutId),
        },
        "[payouts-sync]"
      );

      return reply.send({
        synced: results.length,
        nuevos: nuevos.length,
        descuadrados: descuadrados.map((r) => r.payoutId),
        fallidos: fallidos.map((r) => r.payoutId),
        results,
      });
    }
  );

  // ─── GET /admin/lodging-pricing — tarifas de hospedaje (singleton) ─
  // Lectura abierta al equipo: el staff necesita la tarifa por hora para
  // cotizar una guardería al registrarla. Editarlas (PUT, más abajo) sigue
  // siendo de admin.
  fastify.get(
    "/admin/lodging-pricing",
    { preHandler: [authMiddleware, staffMiddleware] },
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

  // ══════════════════════════════════════════════════════════════
  //  Administración de reservas — la lógica vive en
  //  lib/reservationAdminOps.ts y la comparten estas rutas (app del
  //  equipo, Clerk) y las gemelas /internal/reservations/* que usa el
  //  admin web (routes/internalReservations.ts). Aquí solo se traduce
  //  el resultado a HTTP.
  // ══════════════════════════════════════════════════════════════

  const sendOpError = (reply: FastifyReply, res: OpError) =>
    reply.status(res.status).send({
      error: res.error,
      ...(res.code ? { code: res.code } : {}),
      ...(res.extra ?? {}),
    });
  const actorOf = (request: FastifyRequest): OpActor => ({
    userId: request.userId ?? null,
    isAdmin: request.userRole === "ADMIN",
  });

  // ─── PATCH /admin/reservations/:id/assign-staff — asignar staff ─
  fastify.patch<{ Params: { id: string }; Body: { staffId: string } }>(
    "/admin/reservations/:id/assign-staff",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const res = await assignStaff(prisma, {
        reservationId: request.params.id,
        staffId: request.body?.staffId,
      });
      if (!res.ok) return sendOpError(reply, res);
      return res.data;
    }
  );

  // ─── PATCH /admin/reservations/:id/assign-room — reasignar cuarto ─
  // STAFF y ADMIN pueden asignar/cambiar el cuarto de un hospedaje.
  fastify.patch<{ Params: { id: string }; Body: { roomId: string } }>(
    "/admin/reservations/:id/assign-room",
    { preHandler: [authMiddleware, staffMiddleware] },
    async (request, reply) => {
      const res = await assignRoom(prisma, {
        reservationId: request.params.id,
        roomId: request.body?.roomId,
      });
      if (!res.ok) return sendOpError(reply, res);
      return res.data;
    }
  );

  // ─── Cambio de fechas por el admin ─────────────────────────────
  // El nuevo total se obtiene por DELTA de hospedaje (computeChangeTotal):
  // noches × tarifa + recargo por medicamento, preservando add-ons,
  // domicilio y descuentos. Scope "single": la app mueve una fila (el
  // admin web mueve el grupo completo por su ruta interna).

  // ─── POST /admin/reservations/:id/dates/preview ────────────────
  fastify.post<{ Params: { id: string } }>(
    "/admin/reservations/:id/dates/preview",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const parsed = CreateChangeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const res = await previewDatesChange(prisma, {
        reservationId: request.params.id,
        newCheckIn: parsed.data.newCheckIn,
        newCheckOut: parsed.data.newCheckOut,
        scope: "single",
      });
      if (!res.ok) return sendOpError(reply, res);
      return reply.send(res.data.preview);
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
      const res = await applyDatesChange(prisma, {
        reservationId: request.params.id,
        newCheckIn: parsed.data.newCheckIn,
        newCheckOut: parsed.data.newCheckOut,
        scope: "single",
        actor: actorOf(request),
      });
      if (!res.ok) return sendOpError(reply, res);
      return reply.send(res.data);
    }
  );

  // ══════════════════════════════════════════════════════════════
  //  Edición de una reserva ya creada: precio, notas y add-ons
  // ══════════════════════════════════════════════════════════════

  // ─── PATCH /admin/reservations/:id — precio y notas ─────────────
  fastify.patch<{ Params: { id: string } }>(
    "/admin/reservations/:id",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const parsed = AdminUpdateReservationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const res = await updateReservationBasics(prisma, {
        reservationId: request.params.id,
        input: parsed.data,
        actor: actorOf(request),
      });
      if (!res.ok) return sendOpError(reply, res);
      return reply.send(res.data);
    }
  );

  // ─── POST /admin/reservations/:id/addons — agregar servicio ─────
  // Sumar un baño (o cualquier add-on) a una reserva que ya existe, sin pasar
  // por Stripe. NO confundir con POST /reservations/:id/addons/bath
  // (routes/services.ts), que es la ruta del CLIENTE pagando con tarjeta.
  // Abierto al equipo; el dinero (precio, cortesía) sigue siendo de admin.
  fastify.post<{ Params: { id: string } }>(
    "/admin/reservations/:id/addons",
    { preHandler: [authMiddleware, staffMiddleware] },
    async (request, reply) => {
      const parsed = AdminCreateAddonSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const res = await addReservationAddon(prisma, {
        reservationId: request.params.id,
        input: parsed.data,
        actor: actorOf(request),
      });
      if (!res.ok) return sendOpError(reply, res);
      return reply.send(res.data);
    }
  );

  // ─── PATCH /admin/reservations/:id/addons/:addonId ──────────────
  fastify.patch<{ Params: { id: string; addonId: string } }>(
    "/admin/reservations/:id/addons/:addonId",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const parsed = AdminUpdateAddonSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      // La lógica (delta del total, auditoría de la cortesía, aviso al equipo)
      // vive en lib/reservationAdminOps.ts y la comparte esta ruta con
      // PATCH /internal/reservations/:id/addons/:addonId (admin web).
      const res = await updateReservationAddon(prisma, {
        reservationId: request.params.id,
        addonId: request.params.addonId,
        input: parsed.data,
        actor: actorOf(request),
      });
      if (!res.ok) return sendOpError(reply, res);
      return reply.send(res.data);
    }
  );

  // ─── POST /admin/reservations/:id/cancel ───────────────────────
  // El admin marca la reserva como CANCELLED y envía push al cliente para
  // que él elija cómo recibir el reembolso (tarjeta o saldo a favor). El
  // refund mismo se procesa cuando el cliente confirma vía POST
  // /reservations/:id/issue-refund. Scope "single": esta ruta cancela UNA
  // fila, como siempre (el admin web cancela el grupo por su ruta interna).
  fastify.post<{ Params: { id: string } }>(
    "/admin/reservations/:id/cancel",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const res = await cancelReservations(prisma, {
        reservationId: request.params.id,
        refundChoice: "ASK_CLIENT",
        scope: "single",
        actor: actorOf(request),
      });
      if (!res.ok) return sendOpError(reply, res);
      const refundAmount = res.data.rows.reduce((s, r) => s + r.paid, 0);
      return reply.send({
        success: true,
        reservationId: request.params.id,
        refundAmount: Number(refundAmount.toFixed(2)),
        awaitingClientChoice: res.data.awaitingClientChoice,
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

  // GET /admin/pets/:id/deworming-price — precio sugerido del desparasitante
  // según el peso de la mascota, para prellenar la observación al aprobar la
  // cartilla. La talla usa la escala PROPIA del desparasitante
  // (dewormSizeFromWeight, no la del baño) y el precio se lee de
  // service_variants (fuente de verdad). price null = no cotizable (sin peso,
  // fuera de rango o sin variante activa).
  fastify.get<{ Params: { id: string } }>(
    "/admin/pets/:id/deworming-price",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const pet = await prisma.pet.findUnique({
        where: { id: request.params.id },
        select: { weight: true },
      });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }

      const petSize = dewormSizeFromWeight(pet.weight);
      if (!petSize) {
        return { weight: pet.weight, petSize: null, price: null };
      }

      const variant = await prisma.serviceVariant.findFirst({
        where: {
          petSize,
          deslanado: false,
          corte: false,
          isActive: true,
          serviceType: { code: "DEWORMING", isActive: true },
        },
        select: { price: true },
      });
      return {
        weight: pet.weight,
        petSize,
        price: variant ? Number(variant.price) : null,
      };
    }
  );

  // POST /admin/pets/:id/cartilla/ocr — lee las fotos de la cartilla con Claude
  // y devuelve SUGERENCIAS de vacunas/desparasitaciones para prellenar el
  // formulario de aprobación. No persiste nada.
  fastify.post<{ Params: { id: string } }>(
    "/admin/pets/:id/cartilla/ocr",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const pet = await prisma.pet.findUnique({
        where: { id: request.params.id },
        select: { id: true, cartillaPhotos: true, cartillaUrl: true },
      });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      const photos =
        pet.cartillaPhotos.length > 0
          ? pet.cartillaPhotos
          : pet.cartillaUrl
            ? [pet.cartillaUrl]
            : [];
      if (photos.length === 0) {
        return reply
          .status(400)
          .send({ error: "La mascota no tiene cartilla subida" });
      }

      // El catálogo va dentro del prompt: sin él Claude no puede devolver el
      // TIPO de vacuna y la app sólo prellena fechas.
      const catalog = await prisma.vaccineCatalog.findMany({
        where: { isActive: true },
        select: { code: true, displayName: true },
        orderBy: { displayName: "asc" },
      });

      try {
        const suggestions = await extraerCartilla(photos, catalog);
        return suggestions;
      } catch (err) {
        request.log.error({ err }, "Fallo el OCR de la cartilla");
        return reply.status(502).send({
          error:
            "No se pudo leer la cartilla automáticamente. Captura las vacunas manualmente.",
        });
      }
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
        const note = data.note?.trim() || null;

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
              // La revisión real es autoritativa sobre la nota; el flujo
              // "Agregar vacunas" (cartilla YA aprobada) no la toca salvo que
              // mande una nueva.
              ...(pet.cartillaStatus !== "APPROVED"
                ? { cartillaApprovalNote: note }
                : note
                ? { cartillaApprovalNote: note }
                : {}),
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

        // Sólo avisamos cuando la aprobación es un cambio de estado real. Este
        // mismo endpoint se usa para agregar vacunas a una cartilla YA aprobada
        // (admin/cartillas), y ahí notificar sería spam para el dueño.
        if (pet.cartillaStatus !== "APPROVED") {
          await notifyPetAudience(prisma, { petId: pet.id, ownerId: pet.ownerId }, {
            
            type: "GENERAL",
            title: `Cartilla aprobada: ${pet.name}`,
            // Sin truncar: este body es también lo que muestra el inbox, y el
            // detalle completo vive en /pet/{petId} (deep link por defecto).
            body: note
              ? `La cartilla de ${pet.name} fue aprobada. Ya puedes reservar. Nota del equipo: ${note}`
              : `La cartilla de ${pet.name} fue aprobada. Ya puedes reservar estancias.`,
            data: {
              petId: pet.id,
              kind: "CARTILLA_REVIEW",
              action: "APPROVE",
              hasNote: Boolean(note),
            },
          });
        }

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
          cartillaApprovalNote: null,
        },
      });

      await notifyPetAudience(prisma, { petId: pet.id, ownerId: pet.ownerId }, {
        
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
