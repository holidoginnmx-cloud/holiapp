import { FastifyInstance } from "fastify";
import {
  UpdateBathConfigSchema,
  CreateBathIntentSchema,
  ConfirmBathSchema,
} from "@holidoginn/shared";
import { Prisma, PetSize } from "@holidoginn/db";
import Stripe from "stripe";
import { createAuthMiddleware, createAdminMiddleware, createStaffMiddleware } from "../middleware/auth";
import { notifyUser, notifyUsers } from "../lib/notify";
import { quoteDelivery } from "../lib/delivery";
import { sizeFromWeight, bathSizeKey } from "../lib/pricing";
import { resolveDiscount } from "../lib/discounts";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

// Hermosillo (Sonora) no observa horario de verano → UTC-7 fijo.
export const TZ_OFFSET_HOURS = 7;
const BATH_CONFIG_ID = "singleton";

// Fixed deposit collected via Stripe at booking time. The remaining balance
// (price - deposit) is paid in person when the owner drops off the pet.
export const BATH_DEPOSIT_AMOUNT = 150;
// Grace period (minutes) past the appointment time before the slot is
// considered missed. Surfaced in the UI so owners know their margin.
export const BATH_LATE_TOLERANCE_MIN = 15;

export function describeBath(deslanado: boolean, corte: boolean): string {
  const extras: string[] = [];
  if (deslanado) extras.push("Deslanado");
  if (corte) extras.push("Corte");
  return extras.length > 0 ? `Baño + ${extras.join(" + ")}` : "Baño";
}

export type BathConfigRow = {
  id: string;
  openHour: number;
  closeHour: number;
  slotMinutes: number;
  maxConcurrentBaths: number;
  isActive: boolean;
  updatedAt: Date;
};

export function buildSlotsForDay(
  dateYMD: string,
  cfg: Pick<BathConfigRow, "openHour" | "closeHour" | "slotMinutes">
): Date[] {
  const [y, m, d] = dateYMD.split("-").map(Number);
  if (!y || !m || !d) return [];
  const startMin = cfg.openHour * 60;
  const endMin = cfg.closeHour * 60;
  const slots: Date[] = [];
  for (let min = startMin; min + cfg.slotMinutes <= endMin; min += cfg.slotMinutes) {
    const hh = Math.floor(min / 60);
    const mm = min % 60;
    // Local (Hermosillo) → UTC: sumamos el offset
    slots.push(new Date(Date.UTC(y, m - 1, d, hh + TZ_OFFSET_HOURS, mm)));
  }
  return slots;
}

export function isValidDateYMD(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function sameYMDLocal(a: Date, b: Date): boolean {
  // Comparar "mismo día" en hora local (Hermosillo)
  const shift = TZ_OFFSET_HOURS * 3600 * 1000;
  const aL = new Date(a.getTime() - shift);
  const bL = new Date(b.getTime() - shift);
  return (
    aL.getUTCFullYear() === bL.getUTCFullYear() &&
    aL.getUTCMonth() === bL.getUTCMonth() &&
    aL.getUTCDate() === bL.getUTCDate()
  );
}

export async function ensureConfig(prisma: FastifyInstance["prisma"]): Promise<BathConfigRow> {
  const existing = await prisma.bathConfig.findUnique({ where: { id: BATH_CONFIG_ID } });
  if (existing) return existing;
  return prisma.bathConfig.create({
    data: {
      id: BATH_CONFIG_ID,
      openHour: 9,
      closeHour: 18,
      slotMinutes: 60,
      maxConcurrentBaths: 1,
      isActive: true,
    },
  });
}

export async function notifyBathBooked(
  prisma: FastifyInstance["prisma"],
  params: {
    reservationId: string;
    petName: string;
    appointmentAt: Date;
    deslanado: boolean;
    corte: boolean;
    price: number;
  }
) {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  if (admins.length === 0) return;

  const when = params.appointmentAt.toLocaleString("es-MX", {
    timeZone: "America/Hermosillo",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const title = `Cita de baño: ${params.petName}`;
  const body = `${describeBath(params.deslanado, params.corte)} — ${when} — $${params.price.toLocaleString("es-MX")}`;

  await notifyUsers(prisma, admins.map((a) => a.id), {
    type: "GENERAL",
    title,
    body,
    data: {
      reservationId: params.reservationId,
      kind: "BATH_BOOKED",
      appointmentAt: params.appointmentAt.toISOString(),
    },
  });
}

// ────────────────────────────────────────────────────────────
//  Helper: cerrar baño suelto cuando ya quedó listo + sin saldo.
//  Bañó "concluido" = foto subida (addon.completedAt) Y sin extras
//  pendientes Y sin saldo de deposit. Si todo cuadra, status → CHECKED_OUT.
//  No-op si la reservación no es BATH o ya está CHECKED_OUT/CANCELLED.
// ────────────────────────────────────────────────────────────
export async function maybeConcludeStandaloneBath(
  prisma: Prisma.TransactionClient | import("@holidoginn/db").PrismaClient,
  reservationId: string,
): Promise<boolean> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      payments: { where: { status: "PAID" } },
      addons: { include: { variant: { include: { serviceType: true } } } },
    },
  });
  if (!reservation) return false;
  if (reservation.reservationType !== "BATH") return false;
  if (
    reservation.status === "CHECKED_OUT" ||
    reservation.status === "CANCELLED"
  ) {
    return false;
  }

  // Bath físicamente terminado: addon de baño con completedAt.
  const bathAddon = reservation.addons.find(
    (a) => a.variant?.serviceType?.code === "BATH",
  );
  if (!bathAddon?.completedAt) return false;

  // Extras: si tienen precio definido, deben estar PAID.
  const extrasPending = reservation.addons.some(
    (a) =>
      a.variant?.serviceType?.code === "BATH" &&
      a.extraPrice !== null &&
      a.extraPaymentStatus !== "PAID",
  );
  if (extrasPending) return false;

  // Si la variante incluye extras pero aún no se han cotizado, falta cobrar.
  const extrasNotPriced = reservation.addons.some(
    (a) =>
      a.variant?.serviceType?.code === "BATH" &&
      (a.variant.deslanado || a.variant.corte) &&
      a.extraPrice === null,
  );
  if (extrasNotPriced) return false;

  // Deposit balance: suma de payments PAID debe cubrir totalAmount.
  const totalPaid = reservation.payments.reduce(
    (sum, p) => sum + Number(p.amount),
    0,
  );
  const totalDue = Number(reservation.totalAmount);
  if (totalPaid + 0.01 < totalDue) return false;

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { status: "CHECKED_OUT" },
  });
  await prisma.reservationChangeRequest.updateMany({
    where: { reservationId, status: "PENDING" },
    data: { status: "CANCELLED", rejectionReason: "Reservación finalizada" },
  });
  return true;
}

export default async function bathsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();
  const staffMiddleware = createStaffMiddleware();
  const adminAuth = [authMiddleware, adminMiddleware];
  const staffAuth = [authMiddleware, staffMiddleware];

  // ────────────────────────────────────────────────────────────
  //  GET /baths/config — configuración actual (público autenticado)
  // ────────────────────────────────────────────────────────────
  fastify.get("/baths/config", { preHandler: [authMiddleware] }, async () => {
    const cfg = await ensureConfig(prisma);
    return cfg;
  });

  // ────────────────────────────────────────────────────────────
  //  PATCH /admin/baths/config — editar horario/capacidad (admin)
  // ────────────────────────────────────────────────────────────
  fastify.patch(
    "/admin/baths/config",
    { preHandler: adminAuth },
    async (request, reply) => {
      const parsed = UpdateBathConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const current = await ensureConfig(prisma);
      const next = { ...current, ...parsed.data };
      if (next.closeHour <= next.openHour) {
        return reply
          .status(400)
          .send({ error: "closeHour debe ser mayor que openHour" });
      }
      if ((next.closeHour - next.openHour) * 60 < next.slotMinutes) {
        return reply
          .status(400)
          .send({ error: "La ventana horaria no alcanza para un slot" });
      }
      const updated = await prisma.bathConfig.update({
        where: { id: BATH_CONFIG_ID },
        data: parsed.data,
      });
      return updated;
    }
  );

  // ────────────────────────────────────────────────────────────
  //  GET /baths/slots?date=YYYY-MM-DD — slots disponibles del día
  // ────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { date?: string } }>(
    "/baths/slots",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const date = request.query.date;
      if (!date || !isValidDateYMD(date)) {
        return reply.status(400).send({ error: "Parámetro date=YYYY-MM-DD requerido" });
      }
      const cfg = await ensureConfig(prisma);
      if (!cfg.isActive) {
        return { config: cfg, slots: [] };
      }

      const allSlots = buildSlotsForDay(date, cfg);
      if (allSlots.length === 0) return { config: cfg, slots: [] };

      const dayStart = allSlots[0];
      const dayEnd = new Date(
        allSlots[allSlots.length - 1].getTime() + cfg.slotMinutes * 60000
      );

      const existing = await prisma.reservation.findMany({
        where: {
          reservationType: "BATH",
          status: { not: "CANCELLED" },
          appointmentAt: { gte: dayStart, lt: dayEnd },
        },
        select: { appointmentAt: true },
      });

      const countByIso = new Map<string, number>();
      for (const r of existing) {
        if (!r.appointmentAt) continue;
        const key = r.appointmentAt.toISOString();
        countByIso.set(key, (countByIso.get(key) ?? 0) + 1);
      }

      const now = Date.now();
      const slots = allSlots.map((start) => {
        const taken = countByIso.get(start.toISOString()) ?? 0;
        const remaining = Math.max(0, cfg.maxConcurrentBaths - taken);
        const inPast = start.getTime() <= now;
        return {
          startUtc: start.toISOString(),
          available: !inPast && remaining > 0,
          remaining,
          inPast,
        };
      });

      return { config: cfg, slots };
    }
  );

  // ────────────────────────────────────────────────────────────
  //  POST /baths/create-intent — crea PaymentIntent para una cita
  //  Valida: slot válido, capacidad, misma mascota mismo día.
  // ────────────────────────────────────────────────────────────
  fastify.post(
    "/baths/create-intent",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CreateBathIntentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { petId, deslanado, corte, appointmentAt, notes, paymentType, homeDelivery, discountCode } = parsed.data;

      // Consultas independientes en paralelo — en serie sumaban latencia
      // acumulada contra DB/Google antes de siquiera llamar a Stripe.
      const wantsDelivery =
        !!homeDelivery &&
        Number.isFinite(homeDelivery.lat) &&
        Number.isFinite(homeDelivery.lng);
      const [pet, cfg, bath, deliveryQuoteResult] = await Promise.all([
        prisma.pet.findUnique({ where: { id: petId } }),
        ensureConfig(prisma),
        prisma.serviceType.findUnique({ where: { code: "BATH" } }),
        wantsDelivery
          ? quoteDelivery(prisma, homeDelivery!.lat, homeDelivery!.lng)
          : null,
      ]);
      if (!pet) return reply.status(404).send({ error: "Mascota no encontrada" });

      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      if (!isStaffOrAdmin && pet.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      // El baño no requiere cartilla de vacunación aprobada (solo el hospedaje).

      if (!cfg.isActive) {
        return reply.status(400).send({ error: "Agenda de baños deshabilitada" });
      }

      const appointmentDate = new Date(appointmentAt);
      if (Number.isNaN(appointmentDate.getTime())) {
        return reply.status(400).send({ error: "appointmentAt inválido" });
      }
      if (appointmentDate.getTime() <= Date.now()) {
        return reply.status(400).send({ error: "El slot ya pasó" });
      }

      // Validar que appointmentAt sea exactamente un slot configurado
      const ymdLocal = new Date(
        appointmentDate.getTime() - TZ_OFFSET_HOURS * 3600 * 1000
      );
      const dateYMD = `${ymdLocal.getUTCFullYear()}-${String(
        ymdLocal.getUTCMonth() + 1
      ).padStart(2, "0")}-${String(ymdLocal.getUTCDate()).padStart(2, "0")}`;
      const validSlots = buildSlotsForDay(dateYMD, cfg);
      const isValidSlot = validSlots.some(
        (s) => s.getTime() === appointmentDate.getTime()
      );
      if (!isValidSlot) {
        return reply.status(400).send({ error: "Horario fuera de los slots configurados" });
      }

      if (!bath) return reply.status(500).send({ error: "Servicio de baño no configurado" });

      const dayStart = validSlots[0];
      const dayEnd = new Date(
        validSlots[validSlots.length - 1].getTime() + cfg.slotMinutes * 60000
      );
      const petSize = bathSizeKey(sizeFromWeight(pet.weight ?? 0));

      // Capacidad + regla misma-mascota + variante + dueño, en paralelo.
      const [taken, sameDay, variant, owner] = await Promise.all([
        prisma.reservation.count({
          where: {
            reservationType: "BATH",
            status: { not: "CANCELLED" },
            appointmentAt: appointmentDate,
          },
        }),
        prisma.reservation.findFirst({
          where: {
            petId,
            reservationType: "BATH",
            status: { not: "CANCELLED" },
            appointmentAt: { gte: dayStart, lt: dayEnd },
          },
          select: { id: true },
        }),
        prisma.serviceVariant.findUnique({
          where: {
            serviceTypeId_petSize_deslanado_corte: {
              serviceTypeId: bath.id,
              petSize,
              deslanado,
              corte,
            },
          },
        }),
        prisma.user.findUnique({
          where: { id: pet.ownerId },
          select: { creditBalance: true },
        }),
      ]);

      if (taken >= cfg.maxConcurrentBaths) {
        return reply.status(409).send({ error: "Slot sin disponibilidad" });
      }
      if (sameDay) {
        return reply
          .status(409)
          .send({ error: "Ya existe una cita de baño para esta mascota ese día" });
      }
      if (!variant || !variant.isActive) {
        return reply.status(404).send({ error: "Variante de baño no encontrada" });
      }

      const ownerCredit = Number(owner?.creditBalance ?? 0);
      const price = Number(variant.price);

      // Código de descuento (alcance reservas). Aplica sobre el precio del baño;
      // NO sobre el envío a domicilio. Monto autoritativo (server-side); viaja en
      // el metadata del PI para que /baths/confirm lo persista al confirmar.
      const discount = await resolveDiscount(prisma, {
        code: discountCode,
        subtotal: price,      });
      if (discount.error) {
        return reply.status(400).send({ error: discount.error });
      }
      const discountTotal = discount.discountTotal;
      const discountedPrice = price - discountTotal;

      // Servicio a domicilio — fee RE-CALCULADA server-side desde lat/lng. Es
      // un add-on al precio del baño: el anticipo de slot (BATH_DEPOSIT_AMOUNT)
      // no cambia; la fee se suma al total y queda en el saldo a pagar al
      // recoger/entregar (salvo pago FULL, que la cobra ahora).
      let deliveryFee = 0;
      let deliveryDistanceKm = 0;
      let deliveryActive = false;
      if (deliveryQuoteResult?.active) {
        deliveryActive = true;
        deliveryFee = deliveryQuoteResult.fee;
        deliveryDistanceKm = deliveryQuoteResult.distanceKm;
      }
      const total = discountedPrice + deliveryFee;

      // Owner elige cuánto pagar ahora:
      //  - DEPOSIT: anticipo fijo (BATH_DEPOSIT_AMOUNT) y resto al recoger.
      //  - FULL: precio total (baño + domicilio). Si el total es ≤ anticipo,
      //    queda como FULL.
      const baseDeposit = Math.min(BATH_DEPOSIT_AMOUNT, total);
      const chargeBase = paymentType === "FULL" ? total : baseDeposit;
      const creditApplied = Math.min(ownerCredit, chargeBase);
      const chargeAmount = chargeBase - creditApplied;
      const remainingAmount = total - chargeBase;

      if (chargeAmount === 0) {
        return reply.send({
          clientSecret: null,
          paymentIntentId: null,
          coveredByCredit: true,
          creditApplied,
          price,
          depositAmount: chargeBase,
          remainingAmount,
          paymentType,
          variantId: variant.id,
          deliveryFee,
          deliveryDistanceKm,
          deliveryActive,
          discountTotal,
          discountCode: discount.dc?.code ?? null,
        });
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(chargeAmount * 100),
        currency: "mxn",
        automatic_payment_methods: { enabled: true },
        metadata: {
          ownerId: pet.ownerId,
          petId: pet.id,
          type: "bath_appointment",
          variantId: variant.id,
          appointmentAt: appointmentDate.toISOString(),
          creditApplied: String(creditApplied),
          depositAmount: String(chargeBase),
          paymentType,
          discountCode: discount.dc?.code ?? "",
          discountCodeId: discount.discountCodeId ?? "",
          discountTotal: String(discountTotal),
          ...(notes ? { notes } : {}),
          // Domicilio: persistimos los valores server-computed en el PI para que
          // /baths/confirm los use tal cual (no se recalcula en el flujo Stripe).
          ...(deliveryActive
            ? {
                deliveryFee: String(deliveryFee),
                deliveryDistanceKm: String(deliveryDistanceKm),
                deliveryAddress: homeDelivery!.address,
              }
            : {}),
        },
      });

      return reply.send({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        coveredByCredit: false,
        creditApplied,
        price,
        depositAmount: chargeBase,
        remainingAmount,
        paymentType,
        variantId: variant.id,
        deliveryFee,
        deliveryDistanceKm,
        deliveryActive,
        discountTotal,
        discountCode: discount.dc?.code ?? null,
      });
    }
  );

  // ────────────────────────────────────────────────────────────
  //  GET /staff/baths?date=YYYY-MM-DD — citas de baño del día
  //  Default: hoy (hora Hermosillo). Incluye todas, no filtradas por staff.
  // ────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { date?: string } }>(
    "/staff/baths",
    { preHandler: staffAuth },
    async (request, reply) => {
      const cfg = await ensureConfig(prisma);
      const dateQuery = request.query.date;
      if (dateQuery && !isValidDateYMD(dateQuery)) {
        return reply.status(400).send({ error: "date debe ser YYYY-MM-DD" });
      }

      // Hoy en hora local Hermosillo
      const now = new Date();
      const localNow = new Date(now.getTime() - TZ_OFFSET_HOURS * 3600 * 1000);
      const todayYMD = `${localNow.getUTCFullYear()}-${String(localNow.getUTCMonth() + 1).padStart(2, "0")}-${String(localNow.getUTCDate()).padStart(2, "0")}`;
      const dateYMD = dateQuery ?? todayYMD;

      // Rango: si se pasó date explícito, ese día solo. Si no, hoy + 30 días
      // (vista "todos los baños próximos" que usa el mobile por defecto).
      const RANGE_DAYS = dateQuery ? 1 : 31;

      const [yY, mY, dY] = dateYMD.split("-").map(Number);
      const dayStartLocal = new Date(
        Date.UTC(yY, mY - 1, dY, TZ_OFFSET_HOURS, 0),
      );
      const rangeEndLocal = new Date(
        dayStartLocal.getTime() + RANGE_DAYS * 24 * 3600 * 1000,
      );

      // Para vista de un solo día, restringimos las citas BATH al rango de
      // slots configurados. Para vista multi-día, permitimos todo el rango.
      const slots = buildSlotsForDay(dateYMD, cfg);
      const dayStart = dateQuery && slots[0] ? slots[0] : dayStartLocal;
      const dayEnd =
        dateQuery && slots.length > 0
          ? new Date(slots[slots.length - 1].getTime() + cfg.slotMinutes * 60000)
          : rangeEndLocal;

      const includeOpts = {
        pet: {
          select: {
            id: true,
            name: true,
            breed: true,
            weight: true,
            photoUrl: true,
            size: true,
            notes: true,
          },
        },
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
          },
        },
        addons: {
          include: {
            variant: { include: { serviceType: true } },
          },
        },
        // Foto subida al completar el baño (StayUpdate con mediaUrl).
        updates: {
          where: { mediaType: "image" },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
        // Para calcular saldo pendiente (deposit remainder) en el mobile.
        payments: {
          where: { status: "PAID" },
          select: { id: true, amount: true, method: true, paidAt: true },
        },
      } as const;

      const [standalone, staysWithBath] = await Promise.all([
        prisma.reservation.findMany({
          where: {
            reservationType: "BATH",
            status: { not: "CANCELLED" },
            appointmentAt: { gte: dayStart, lt: dayEnd },
          },
          include: includeOpts,
          orderBy: { appointmentAt: "asc" },
        }),
        prisma.reservation.findMany({
          where: {
            reservationType: "STAY",
            status: { in: ["CONFIRMED", "CHECKED_IN"] },
            checkOut: { gte: dayStartLocal, lt: rangeEndLocal },
            addons: {
              some: { variant: { serviceType: { code: "BATH" } } },
            },
          },
          include: includeOpts,
          orderBy: { checkOut: "asc" },
        }),
      ]);

      // Para que el mobile pueda usar el mismo render, exponemos appointmentAt
      // = checkOut en los stays con baño (el baño se hace antes del check-out).
      const stayBaths = staysWithBath.map((r) => ({
        ...r,
        appointmentAt: r.checkOut,
      }));

      const baths = [...standalone, ...stayBaths].sort((a, b) => {
        const ta = a.appointmentAt ? a.appointmentAt.getTime() : 0;
        const tb = b.appointmentAt ? b.appointmentAt.getTime() : 0;
        return ta - tb;
      });

      return { date: dateYMD, baths };
    },
  );

  // ────────────────────────────────────────────────────────────
  //  POST /staff/baths/:id/complete — marcar cita como finalizada
  //  Requiere foto del perro bañado (mediaUrl). Crea StayUpdate,
  //  setea status=CHECKED_OUT y addon.completedAt=now. Notifica.
  // ────────────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { mediaUrl?: string } }>(
    "/staff/baths/:id/complete",
    { preHandler: staffAuth },
    async (request, reply) => {
      const mediaUrl = request.body?.mediaUrl;
      if (typeof mediaUrl !== "string" || !mediaUrl.startsWith("http")) {
        return reply.status(400).send({
          error: "Se requiere una foto del baño completado",
        });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: {
          pet: { select: { id: true, name: true } },
          addons: { include: { variant: { include: { serviceType: true } } } },
        },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Cita no encontrada" });
      }
      if (reservation.status === "CANCELLED") {
        return reply.status(400).send({ error: "La cita está cancelada" });
      }

      const isStandaloneBath = reservation.reservationType === "BATH";
      const isStayWithBath =
        reservation.reservationType === "STAY" &&
        reservation.addons.some(
          (a) => a.variant?.serviceType?.code === "BATH",
        );

      if (!isStandaloneBath && !isStayWithBath) {
        return reply
          .status(400)
          .send({ error: "La reservación no tiene baño contratado" });
      }

      // Standalone: si ya está CHECKED_OUT, ya se completó.
      // STAY con baño: si ya hay addon BATH con completedAt, también.
      if (isStandaloneBath && reservation.status === "CHECKED_OUT") {
        return reply.status(409).send({ error: "La cita ya fue completada" });
      }
      const bathAddon = reservation.addons.find(
        (a) => a.variant?.serviceType?.code === "BATH",
      );
      if (isStayWithBath && bathAddon?.completedAt) {
        return reply.status(409).send({ error: "El baño ya fue completado" });
      }

      await prisma.$transaction(async (tx) => {
        // Marca el addon de baño como físicamente terminado (foto subida).
        // Para baños sueltos, la reservación NO se cierra aquí — se cierra
        // cuando se liquida el saldo (extras + deposit). Ver maybeConcludeStandaloneBath.
        await tx.reservationAddon.updateMany({
          where: {
            reservationId: reservation.id,
            completedAt: null,
            ...(isStandaloneBath
              ? {}
              : { variant: { serviceType: { code: "BATH" } } }),
          },
          data: { completedAt: new Date() },
        });
        await tx.stayUpdate.create({
          data: {
            reservationId: reservation.id,
            petId: reservation.pet.id,
            staffId: request.userId!,
            mediaUrl,
            mediaType: "image",
            caption: `${reservation.pet.name} listo después del baño`,
          },
        });
      });

      // Si es baño suelto sin saldo pendiente, concluir inmediatamente.
      if (isStandaloneBath) {
        await maybeConcludeStandaloneBath(prisma, reservation.id);
      }

      // Notificar al dueño
      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "CHECK_OUT",
        title: "¡Baño listo! 🛁",
        body: `${reservation.pet.name} ya está listo${isStandaloneBath ? ". Puedes pasar a recogerlo." : ", ahora a continuar la estancia."}`,
        data: { reservationId: reservation.id, kind: "BATH_COMPLETED" },
      });

      return reply.send({ success: true });
    },
  );

  // ────────────────────────────────────────────────────────────
  //  POST /staff/baths/:id/register-manual-payment
  //  Staff registra un pago manual (efectivo/transferencia) con monto
  //  específico. Crea un Payment record y, si el total acumulado cubre
  //  el saldo (deposit + extras), marca extras como PAID y concluye.
  //  Soporta pagos parciales: el staff puede registrar varios.
  // ────────────────────────────────────────────────────────────
  fastify.post<{
    Params: { id: string };
    Body: { amount?: number; method?: "CASH" | "TRANSFER"; notes?: string };
  }>(
    "/staff/baths/:id/register-manual-payment",
    { preHandler: staffAuth },
    async (request, reply) => {
      const method = request.body?.method ?? "CASH";
      const amount = request.body?.amount;
      if (!["CASH", "TRANSFER"].includes(method)) {
        return reply.status(400).send({ error: "Método inválido" });
      }
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        return reply.status(400).send({
          error: "El monto debe ser un número mayor a 0",
        });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: {
          pet: { select: { id: true, name: true } },
          payments: { where: { status: "PAID" } },
          addons: { include: { variant: { include: { serviceType: true } } } },
        },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Baño no encontrado" });
      }
      if (reservation.reservationType !== "BATH") {
        return reply.status(400).send({
          error: "Este endpoint sólo aplica a baños sueltos",
        });
      }
      if (reservation.status === "CANCELLED") {
        return reply.status(400).send({ error: "La reservación está cancelada" });
      }
      if (reservation.status === "CHECKED_OUT") {
        return reply.status(409).send({ error: "El baño ya está concluido" });
      }

      const totalPaidBefore = reservation.payments.reduce(
        (sum, p) => sum + Number(p.amount),
        0,
      );
      const pendingExtraAddons = reservation.addons.filter(
        (a) =>
          a.variant?.serviceType?.code === "BATH" &&
          a.extraPrice !== null &&
          a.extraPaymentStatus !== "PAID",
      );
      const extrasTotal = pendingExtraAddons.reduce(
        (sum, a) => sum + Number(a.extraPrice ?? 0),
        0,
      );
      const reservationTotal = Number(reservation.totalAmount);
      const totalOwed = reservationTotal + extrasTotal;
      const balance = Math.max(0, totalOwed - totalPaidBefore);
      if (balance <= 0.01) {
        return reply.status(400).send({
          error: "No hay saldo pendiente para registrar.",
        });
      }
      // Tolerar un sobrepago de hasta 1 peso (centavos por redondeo).
      if (amount - balance > 1) {
        return reply.status(400).send({
          error: `El monto excede el saldo pendiente ($${balance.toLocaleString(
            "es-MX",
          )}).`,
        });
      }

      const noteText =
        request.body?.notes?.trim() ||
        `Pago manual (${method}) registrado por staff`;

      await prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            amount: new Prisma.Decimal(amount),
            method,
            status: "PAID",
            paidAt: new Date(),
            reservationId: reservation.id,
            userId: reservation.ownerId,
            notes: noteText,
          },
        });
        // Si el acumulado cubre todo el saldo, marca extras pendientes como
        // PAID (su Payment ya quedó registrado en el record que acabamos de
        // crear más los anteriores).
        if (totalPaidBefore + amount + 0.01 >= totalOwed) {
          for (const a of pendingExtraAddons) {
            await tx.reservationAddon.update({
              where: { id: a.id },
              data: {
                extraPaymentStatus: "PAID",
                extraPaidAt: new Date(),
              },
            });
          }
        }
      });

      const concluded = await maybeConcludeStandaloneBath(
        prisma,
        reservation.id,
      );

      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "GENERAL",
        title: "Pago recibido",
        body: `Recibimos $${amount.toLocaleString("es-MX")} del baño de ${reservation.pet.name}. ¡Gracias!`,
        data: { reservationId: reservation.id, kind: "BATH_PAID" },
      });

      return reply.send({
        success: true,
        amount,
        concluded,
      });
    },
  );

  // ────────────────────────────────────────────────────────────
  //  POST /internal/bath-reminders — cron endpoint
  //  Envía recordatorio 24h antes de cada cita de baño pendiente.
  //  Protegido por header x-cron-secret. CRON_SECRET DEBE estar configurado en
  //  producción: si falta, el endpoint queda cerrado (401) en vez de abierto.
  //  Idempotente: no reenvía si ya hay una notificación RESERVATION_REMINDER
  //  para la misma reservación.
  // ────────────────────────────────────────────────────────────
  fastify.post("/internal/bath-reminders", async (request, reply) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers["x-cron-secret"] !== secret) {
      return reply.status(401).send({ error: "No autorizado" });
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() + 23 * 3600 * 1000);
    const windowEnd = new Date(now.getTime() + 25 * 3600 * 1000);

    const upcoming = await prisma.reservation.findMany({
      where: {
        reservationType: "BATH",
        status: { not: "CANCELLED" },
        appointmentAt: { gte: windowStart, lt: windowEnd },
      },
      include: {
        pet: { select: { name: true } },
      },
    });

    let sent = 0;
    for (const res of upcoming) {
      if (!res.appointmentAt) continue;

      const alreadyReminded = await prisma.notification.findFirst({
        where: {
          userId: res.ownerId,
          type: "RESERVATION_REMINDER",
          data: { path: ["reservationId"], equals: res.id },
        },
      });
      if (alreadyReminded) continue;

      const when = res.appointmentAt.toLocaleString("es-MX", {
        timeZone: "America/Hermosillo",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });

      await notifyUser(prisma, {
        userId: res.ownerId,
        type: "RESERVATION_REMINDER",
        title: "Recordatorio: cita de baño mañana 🛁",
        body: `${res.pet.name} tiene baño el ${when}. ¡Te esperamos!`,
        data: { reservationId: res.id, kind: "BATH_REMINDER" },
      });
      sent++;
    }

    return reply.send({ sent, checked: upcoming.length });
  });

  // ────────────────────────────────────────────────────────────
  //  POST /internal/reservation-reminders-90min
  //  Recordatorio 1.5 horas antes de la hora de cita:
  //   - BATH: 1.5h antes de appointmentAt
  //   - STAY: 1.5h antes de checkIn
  //  Idempotente: usa Notification.data.kind === "REMINDER_90MIN" para evitar
  //  duplicados.
  // ────────────────────────────────────────────────────────────
  fastify.post("/internal/reservation-reminders-90min", async (request, reply) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers["x-cron-secret"] !== secret) {
      return reply.status(401).send({ error: "No autorizado" });
    }

    const now = new Date();
    // Ventana de 1h centrada en t-1.5h. Toleramos cron cada ~30 min.
    const windowStart = new Date(now.getTime() + 60 * 60 * 1000);   // +60 min
    const windowEnd = new Date(now.getTime() + 120 * 60 * 1000);    // +120 min

    const upcoming = await prisma.reservation.findMany({
      where: {
        status: { notIn: ["CANCELLED", "CHECKED_OUT"] },
        OR: [
          {
            reservationType: "BATH",
            appointmentAt: { gte: windowStart, lt: windowEnd },
          },
          {
            reservationType: "STAY",
            checkIn: { gte: windowStart, lt: windowEnd },
          },
        ],
      },
      include: {
        pet: { select: { name: true } },
      },
    });

    let sent = 0;
    for (const res of upcoming) {
      const alreadyReminded = await prisma.notification.findFirst({
        where: {
          userId: res.ownerId,
          type: "RESERVATION_REMINDER",
          data: { path: ["kind"], equals: "REMINDER_90MIN" },
          AND: [{ data: { path: ["reservationId"], equals: res.id } }],
        },
      });
      if (alreadyReminded) continue;

      const target = res.reservationType === "BATH" ? res.appointmentAt : res.checkIn;
      if (!target) continue;

      const when = target.toLocaleString("es-MX", {
        timeZone: "America/Hermosillo",
        hour: "2-digit",
        minute: "2-digit",
      });
      const isBath = res.reservationType === "BATH";
      const title = isBath
        ? `Baño de ${res.pet.name} en 1.5 horas 🛁`
        : `Check-in de ${res.pet.name} en 1.5 horas 🏨`;
      const body = isBath
        ? `${res.pet.name} tiene cita a las ${when}. ¡Te esperamos!`
        : `${res.pet.name} entra al hotel a las ${when}. Prepara su cartilla y maletita.`;

      await notifyUser(prisma, {
        userId: res.ownerId,
        type: "RESERVATION_REMINDER",
        title,
        body,
        data: { reservationId: res.id, kind: "REMINDER_90MIN" },
      });
      sent++;
    }

    return reply.send({ sent, checked: upcoming.length });
  });

  // ────────────────────────────────────────────────────────────
  //  POST /baths/confirm — tras PI exitoso, crea la Reservation BATH
  //  Soporta también pagos 100% con crédito (paymentIntentId opcional).
  // ────────────────────────────────────────────────────────────
  fastify.post(
    "/baths/confirm",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const body = request.body as {
        paymentIntentId?: string;
        petId?: string;
        variantId?: string;
        appointmentAt?: string;
        notes?: string;
        homeDelivery?: { address: string; lat: number; lng: number; placeId?: string };
        discountCode?: string;
      };

      let ownerId: string;
      let petId: string;
      let variantId: string;
      let appointmentAtIso: string;
      let notes: string | undefined;
      let creditApplied = 0;
      let stripeAmount = 0;
      // Descuento: en Stripe se lee del metadata del PI; en credit-only se
      // re-valida contra el precio de la variante (más abajo).
      let discountTotal = 0;
      let discountCodeId: string | null = null;
      let paymentIntentId: string | null = null;
      let chosenPaymentType: "DEPOSIT" | "FULL" = "DEPOSIT";
      // Servicio a domicilio: en el flujo Stripe se leen los valores
      // server-computed del PI; en el flujo 100% crédito se recalculan aquí.
      let deliveryFee = 0;
      let deliveryDistanceKm = 0;
      let deliveryAddress: string | null = null;

      if (body.paymentIntentId) {
        const parsed = ConfirmBathSchema.safeParse(body);
        if (!parsed.success) {
          return reply.status(400).send({ error: parsed.error.flatten() });
        }
        const pi = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId);
        if (pi.status !== "succeeded") {
          return reply.status(400).send({ error: "El pago no fue completado" });
        }
        if (pi.metadata?.type !== "bath_appointment") {
          return reply.status(400).send({ error: "PaymentIntent no es de cita de baño" });
        }
        ownerId = String(pi.metadata.ownerId);
        petId = String(pi.metadata.petId);
        variantId = String(pi.metadata.variantId);
        appointmentAtIso = String(pi.metadata.appointmentAt);
        notes = typeof pi.metadata.notes === "string" ? pi.metadata.notes : undefined;
        creditApplied = Number(pi.metadata.creditApplied || 0);
        discountTotal = Number(pi.metadata.discountTotal || 0);
        discountCodeId = pi.metadata.discountCodeId || null;
        stripeAmount = pi.amount / 100;
        paymentIntentId = pi.id;
        if (pi.metadata?.paymentType === "FULL") {
          chosenPaymentType = "FULL";
        }
        if (pi.metadata?.deliveryFee) {
          deliveryFee = Number(pi.metadata.deliveryFee);
          deliveryDistanceKm = Number(pi.metadata.deliveryDistanceKm || 0);
          deliveryAddress = typeof pi.metadata.deliveryAddress === "string"
            ? pi.metadata.deliveryAddress
            : null;
        }
      } else {
        // Flujo 100% con crédito — el servidor recibe los datos directamente.
        if (!body.petId || !body.variantId || !body.appointmentAt) {
          return reply
            .status(400)
            .send({ error: "petId, variantId y appointmentAt son requeridos sin paymentIntent" });
        }
        const pet = await prisma.pet.findUnique({ where: { id: body.petId } });
        if (!pet) return reply.status(404).send({ error: "Mascota no encontrada" });
        if (pet.ownerId !== request.userId) {
          return reply.status(403).send({ error: "No autorizado" });
        }
        ownerId = pet.ownerId;
        petId = body.petId;
        variantId = body.variantId;
        appointmentAtIso = body.appointmentAt;
        notes = body.notes;
        // Recalcular fee server-side (no hay PI donde estuviera guardada).
        const hd = body.homeDelivery;
        if (hd && Number.isFinite(hd.lat) && Number.isFinite(hd.lng)) {
          const quote = await quoteDelivery(prisma, hd.lat, hd.lng);
          if (quote.active) {
            deliveryFee = quote.fee;
            deliveryDistanceKm = quote.distanceKm;
            deliveryAddress = hd.address;
          }
        }
      }

      const appointmentAt = new Date(appointmentAtIso);
      if (Number.isNaN(appointmentAt.getTime())) {
        return reply.status(400).send({ error: "appointmentAt inválido" });
      }

      // Revalidar capacidad dentro de transacción para evitar race condition.
      const cfg = await ensureConfig(prisma);
      const variant = await prisma.serviceVariant.findUnique({ where: { id: variantId } });
      if (!variant) return reply.status(404).send({ error: "Variante no encontrada" });

      // Descuento en credit-only (sin PI): re-validar server-side contra el
      // precio de la variante. En el flujo Stripe ya vino del metadata del PI.
      if (!paymentIntentId) {
        const d = await resolveDiscount(prisma, {
          code: body.discountCode,
          subtotal: Number(variant.price),        });
        if (d.error) {
          return reply.status(400).send({ error: d.error });
        }
        discountTotal = d.discountTotal;
        discountCodeId = d.discountCodeId;
      }
      // Acotar defensivamente al precio de la variante.
      discountTotal = Math.min(Math.max(0, discountTotal), Number(variant.price));

      try {
        const result = await prisma.$transaction(async (tx) => {
          // Lock transaccional por slot: serializa confirmaciones concurrentes
          // del MISMO horario para que el count-then-create sea atómico (con
          // READ COMMITTED dos confirmaciones verían ambas taken=0 y crearían
          // dos baños en un slot de capacidad 1). El lock se libera al cerrar la
          // transacción. Namespace 42 = slots de baño.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(42, hashtext(${appointmentAt.toISOString()}))`;
          const taken = await tx.reservation.count({
            where: {
              reservationType: "BATH",
              status: { not: "CANCELLED" },
              appointmentAt,
            },
          });
          if (taken >= cfg.maxConcurrentBaths) {
            throw new Error("SLOT_TAKEN");
          }

          const price = Number(variant.price);
          // Total = precio del baño (con descuento) + servicio a domicilio.
          const discountedPrice = price - discountTotal;
          const total = discountedPrice + deliveryFee;
          // El paymentType viene del intent (owner eligió DEPOSIT o FULL).
          // Si el total es ≤ anticipo, no hay saldo aunque haya elegido DEPOSIT.
          const baseDeposit = Math.min(BATH_DEPOSIT_AMOUNT, total);
          const paidNow = chosenPaymentType === "FULL" ? total : baseDeposit;
          const isPartial = paidNow < total;
          const reservation = await tx.reservation.create({
            data: {
              reservationType: "BATH",
              appointmentAt,
              status: "CONFIRMED",
              totalAmount: new Prisma.Decimal(total),
              ...(discountCodeId
                ? { discountCodeId, discountTotal: new Prisma.Decimal(discountTotal) }
                : {}),
              notes,
              legalAccepted: true,
              // DEPOSIT cuando aún hay saldo por cobrar al recoger;
              // FULL cuando el owner ya pagó todo (en línea o con crédito).
              paymentType: isPartial ? "DEPOSIT" : "FULL",
              depositDeadline: isPartial ? appointmentAt : null,
              ownerId,
              petId,
              // Servicio a domicilio
              ...(deliveryAddress
                ? {
                    homeDelivery: true,
                    homeDeliveryAddress: deliveryAddress,
                    homeDeliveryDistanceKm: deliveryDistanceKm,
                    homeDeliveryFee: new Prisma.Decimal(deliveryFee),
                  }
                : {}),
            },
          });

          // Status convention (matches reservations.ts): PARTIAL when there's
          // still a balance owed at check-in, PAID when fully covered.
          const paymentStatus = isPartial ? "PARTIAL" : "PAID";
          const paymentLabel = isPartial
            ? `Anticipo baño — ${describeBath(variant.deslanado, variant.corte)}`
            : `Baño estandalone — ${describeBath(variant.deslanado, variant.corte)}`;

          // Registrar pago Stripe (si aplica)
          let payment = null;
          if (paymentIntentId) {
            payment = await tx.payment.create({
              data: {
                amount: new Prisma.Decimal(stripeAmount),
                method: "STRIPE",
                status: paymentStatus,
                stripePaymentIntentId: paymentIntentId,
                paidAt: new Date(),
                notes: paymentLabel,
                reservationId: reservation.id,
                userId: ownerId,
              },
            });
          }

          // Aplicar crédito si hubo
          if (creditApplied > 0) {
            await tx.user.update({
              where: { id: ownerId },
              data: {
                creditBalance: { decrement: creditApplied },
                lastCreditEntryAt: new Date(),
              },
            });
            const user = await tx.user.findUnique({
              where: { id: ownerId },
              select: { creditBalance: true },
            });
            await tx.creditLedger.create({
              data: {
                type: "CREDIT_APPLIED",
                amount: new Prisma.Decimal(-creditApplied),
                balanceAfter: user?.creditBalance ?? new Prisma.Decimal(0),
                description: `Aplicado a cita de baño ${reservation.id}`,
                userId: ownerId,
                reservationId: reservation.id,
              },
            });
            await tx.payment.create({
              data: {
                amount: new Prisma.Decimal(creditApplied),
                method: "CREDIT",
                status: paymentStatus,
                paidAt: new Date(),
                notes: "Pago con saldo a favor",
                reservationId: reservation.id,
                userId: ownerId,
              },
            });
          }

          // Registrar addon para rastrear la variante contratada
          await tx.reservationAddon.create({
            data: {
              reservationId: reservation.id,
              variantId: variant.id,
              unitPrice: variant.price,
              paidWith: "BOOKING",
              paymentId: payment?.id,
            },
          });

          // Contar el uso del código UNA vez. En Stripe, el @unique de
          // Payment.stripePaymentIntentId evita doble conteo ante reintento.
          if (discountCodeId) {
            await tx.discountCode.update({
              where: { id: discountCodeId },
              data: { usesCount: { increment: 1 } },
            });
          }

          return { reservation, payment };
        });

        // Notificar a admins
        const pet = await prisma.pet.findUnique({
          where: { id: petId },
          select: { name: true },
        });
        if (pet) {
          // Fire-and-forget: el push a admins no debe bloquear la respuesta.
          notifyBathBooked(prisma, {
            reservationId: result.reservation.id,
            petName: pet.name,
            appointmentAt,
            deslanado: variant.deslanado,
            corte: variant.corte,
            price: Number(variant.price),
          }).catch((err) => fastify.log.error({ err }, "notifyBathBooked falló"));
        }

        return reply.send({ success: true, reservation: result.reservation });
      } catch (err) {
        if (err instanceof Error && err.message === "SLOT_TAKEN") {
          return reply.status(409).send({ error: "El slot ya fue tomado" });
        }
        throw err;
      }
    }
  );
}
