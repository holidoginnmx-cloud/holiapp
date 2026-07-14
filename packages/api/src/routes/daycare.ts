import { FastifyInstance } from "fastify";
import {
  CreateDaycareIntentSchema,
  ConfirmDaycareSchema,
} from "@holidoginn/shared";
import { Prisma } from "@holidoginn/db";
import Stripe from "stripe";
import {
  createAuthMiddleware,
  createStaffMiddleware,
} from "../middleware/auth";
import { notifyUser } from "../lib/notify";
import { quoteDelivery } from "../lib/delivery";
import { resolveDiscount } from "../lib/discounts";
import {
  getLodgingPricing,
  computeDaycareHours,
  computeDaycareExtraHours,
  isWithinDaycareHours,
  minutesFromHHmm,
  DAYCARE_OPEN_HOUR,
  DAYCARE_CLOSE_HOUR,
  DAYCARE_LATE_TOLERANCE_MIN,
  DAYCARE_MIN_HOURS,
} from "../lib/pricing";
import {
  createDaycareGroup,
  countDaycareOccupancy,
  daycareDayRange,
} from "../lib/daycareCreate";
import { TZ_OFFSET_HOURS, isValidDateYMD } from "./baths";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

/** "YYYY-MM-DD" de hoy en hora local del hotel (Hermosillo, UTC-7 fijo). */
export function todayYMDLocal(): string {
  const local = new Date(Date.now() - TZ_OFFSET_HOURS * 3600 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

/** Minutos desde medianoche AHORA en hora local del hotel. */
function nowMinutesLocal(): number {
  const local = new Date(Date.now() - TZ_OFFSET_HOURS * 3600 * 1000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/**
 * Valida día + horas de una guardería. Devuelve mensaje de error o null.
 * Reglas: día no pasado, horas dentro de la ventana 8:00–18:00, salida
 * posterior a la entrada y, si es hoy, entrada aún no pasada (con tolerancia).
 */
export function validateDaycareWindow(
  date: string,
  checkInTime: string,
  checkOutTime: string
): string | null {
  if (!isValidDateYMD(date)) return "Fecha inválida (YYYY-MM-DD)";
  const today = todayYMDLocal();
  if (date < today) return "El día ya pasó";
  if (!isWithinDaycareHours(checkInTime) || !isWithinDaycareHours(checkOutTime)) {
    return `El horario de guardería es de ${DAYCARE_OPEN_HOUR}:00 a ${DAYCARE_CLOSE_HOUR}:00`;
  }
  if (computeDaycareHours(checkInTime, checkOutTime) <= 0) {
    return "La hora de salida debe ser posterior a la de entrada";
  }
  if (date === today) {
    const entry = minutesFromHHmm(checkInTime);
    if (entry + DAYCARE_LATE_TOLERANCE_MIN < nowMinutesLocal()) {
      return "La hora de entrada ya pasó";
    }
  }
  return null;
}

// Snapshot de disponibilidad/tarifa que consumen móvil y tienda.
export async function daycareAvailabilityPayload(
  prisma: FastifyInstance["prisma"],
  date: string
) {
  const [{ occupied, maxCapacity }, pricing] = await Promise.all([
    countDaycareOccupancy(prisma, date),
    getLodgingPricing(prisma),
  ]);
  return {
    date,
    maxCapacity,
    occupied,
    remaining: Math.max(0, maxCapacity - occupied),
    openHour: DAYCARE_OPEN_HOUR,
    closeHour: DAYCARE_CLOSE_HOUR,
    lateToleranceMin: DAYCARE_LATE_TOLERANCE_MIN,
    minHours: DAYCARE_MIN_HOURS,
    hourPrice: pricing.daycareHourPrice,
  };
}

export default async function daycareRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const staffMiddleware = createStaffMiddleware();
  const staffAuth = [authMiddleware, staffMiddleware];

  // ────────────────────────────────────────────────────────────
  //  GET /daycare/availability?date=YYYY-MM-DD — cupo y tarifa del día
  // ────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { date?: string } }>(
    "/daycare/availability",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const date = request.query.date;
      if (!date || !isValidDateYMD(date)) {
        return reply
          .status(400)
          .send({ error: "Parámetro date=YYYY-MM-DD requerido" });
      }
      return daycareAvailabilityPayload(prisma, date);
    }
  );

  // ────────────────────────────────────────────────────────────
  //  POST /daycare/create-intent — cotiza y crea PaymentIntent
  //  Precio = horas estimadas × tarifa única × nº de mascotas
  //  (− descuento + domicilio). Sin cartilla requerida (como baño).
  // ────────────────────────────────────────────────────────────
  fastify.post(
    "/daycare/create-intent",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CreateDaycareIntentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { petIds, date, checkInTime, checkOutTime, notes, homeDelivery, discountCode } =
        parsed.data;

      const windowError = validateDaycareWindow(date, checkInTime, checkOutTime);
      if (windowError) return reply.status(400).send({ error: windowError });

      const uniquePetIds = [...new Set(petIds)];
      const wantsDelivery =
        !!homeDelivery &&
        Number.isFinite(homeDelivery.lat) &&
        Number.isFinite(homeDelivery.lng);
      const range = daycareDayRange(date)!;

      const [pets, occupancy, pricing, deliveryQuoteResult] = await Promise.all([
        prisma.pet.findMany({ where: { id: { in: uniquePetIds } } }),
        countDaycareOccupancy(prisma, date),
        getLodgingPricing(prisma),
        wantsDelivery
          ? quoteDelivery(prisma, homeDelivery!.lat, homeDelivery!.lng)
          : null,
      ]);

      if (pets.length !== uniquePetIds.length) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      const ownerId = pets[0].ownerId;
      if (
        pets.some((p) => p.ownerId !== ownerId) ||
        (!isStaffOrAdmin && ownerId !== request.userId)
      ) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      // La guardería no requiere cartilla aprobada (solo el hospedaje).

      if (occupancy.occupied + pets.length > occupancy.maxCapacity) {
        return reply
          .status(409)
          .send({ error: "No hay cupo de guardería para ese día" });
      }

      // Una guardería por mascota por día.
      const sameDay = await prisma.reservation.findFirst({
        where: {
          reservationType: "DAYCARE",
          status: { not: "CANCELLED" },
          petId: { in: uniquePetIds },
          appointmentAt: { gte: range.start, lt: range.end },
        },
        select: { pet: { select: { name: true } } },
      });
      if (sameDay) {
        return reply.status(409).send({
          error: `${sameDay.pet.name} ya tiene guardería ese día`,
        });
      }

      const hours = computeDaycareHours(checkInTime, checkOutTime);
      const hourPrice = pricing.daycareHourPrice;
      const subtotal = hours * hourPrice * pets.length;

      const discount = await resolveDiscount(prisma, {
        code: discountCode,
        subtotal,
      });
      if (discount.error) {
        return reply.status(400).send({ error: discount.error });
      }
      const discountTotal = discount.discountTotal;

      let deliveryFee = 0;
      let deliveryDistanceKm = 0;
      let deliveryActive = false;
      if (deliveryQuoteResult?.active) {
        deliveryActive = true;
        deliveryFee = deliveryQuoteResult.fee;
        deliveryDistanceKm = deliveryQuoteResult.distanceKm;
      }
      const total = subtotal - discountTotal + deliveryFee;

      const owner = await prisma.user.findUnique({
        where: { id: ownerId },
        select: { creditBalance: true },
      });
      const ownerCredit = Number(owner?.creditBalance ?? 0);
      const creditApplied = Math.min(ownerCredit, total);
      const chargeAmount = total - creditApplied;

      const quote = {
        hours,
        hourPrice,
        subtotal,
        discountTotal,
        discountCode: discount.dc?.code ?? null,
        deliveryFee,
        deliveryDistanceKm,
        deliveryActive,
        creditApplied,
        total,
      };

      if (chargeAmount === 0) {
        // Cubierto 100% con saldo a favor: el cliente llama /daycare/confirm
        // con paymentIntentId=null y el eco de los campos.
        return reply.send({
          clientSecret: null,
          paymentIntentId: null,
          coveredByCredit: true,
          ...quote,
        });
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(chargeAmount * 100),
        currency: "mxn",
        automatic_payment_methods: { enabled: true },
        metadata: {
          type: "daycare",
          ownerId,
          petIds: uniquePetIds.join(","),
          date,
          checkInTime,
          checkOutTime,
          hours: String(hours),
          creditApplied: String(creditApplied),
          discountCode: discount.dc?.code ?? "",
          discountCodeId: discount.discountCodeId ?? "",
          discountTotal: String(discountTotal),
          ...(notes ? { notes } : {}),
          ...(deliveryActive
            ? {
                deliveryFee: String(deliveryFee),
                deliveryDistanceKm: String(deliveryDistanceKm),
                deliveryAddress: homeDelivery!.address,
                deliveryLat: String(homeDelivery!.lat),
                deliveryLng: String(homeDelivery!.lng),
              }
            : {}),
        },
      });

      return reply.send({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        coveredByCredit: false,
        ...quote,
      });
    }
  );

  // ────────────────────────────────────────────────────────────
  //  POST /daycare/confirm — tras PI exitoso crea el grupo DAYCARE.
  //  Soporta también pago 100% con crédito (paymentIntentId null).
  // ────────────────────────────────────────────────────────────
  fastify.post(
    "/daycare/confirm",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = ConfirmDaycareSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const body = parsed.data;

      let ownerId: string;
      let petIds: string[];
      let date: string;
      let checkInTime: string;
      let checkOutTime: string;
      let notes: string | undefined;
      let creditApplied = 0;
      let discount = { discountCodeId: null as string | null, discountTotal: 0 };
      let deliveryOverride: { fee: number; distanceKm: number } | null = null;
      let homeDelivery:
        | { address: string; lat: number; lng: number }
        | undefined;
      let paymentIntentId: string | null = null;

      if (body.paymentIntentId) {
        // Idempotencia: si el PI ya creó reservas, devolverlas tal cual.
        const existingPayment = await prisma.payment.findFirst({
          where: { stripePaymentIntentId: body.paymentIntentId },
          include: { reservation: { include: { pet: true } } },
        });
        if (existingPayment?.reservation) {
          const group = existingPayment.reservation.groupId
            ? await prisma.reservation.findMany({
                where: { groupId: existingPayment.reservation.groupId },
                include: { pet: true },
              })
            : [existingPayment.reservation];
          return reply.send({
            success: true,
            reservations: group,
            groupId: existingPayment.reservation.groupId,
            idempotent: true,
          });
        }

        const pi = await stripe.paymentIntents.retrieve(body.paymentIntentId);
        if (pi.status !== "succeeded") {
          return reply.status(400).send({ error: "El pago no fue completado" });
        }
        if (pi.metadata?.type !== "daycare") {
          return reply
            .status(400)
            .send({ error: "PaymentIntent no es de guardería" });
        }
        ownerId = String(pi.metadata.ownerId);
        petIds = String(pi.metadata.petIds).split(",").filter(Boolean);
        date = String(pi.metadata.date);
        checkInTime = String(pi.metadata.checkInTime);
        checkOutTime = String(pi.metadata.checkOutTime);
        notes = typeof pi.metadata.notes === "string" ? pi.metadata.notes : undefined;
        creditApplied = Number(pi.metadata.creditApplied || 0);
        discount = {
          discountCodeId: pi.metadata.discountCodeId || null,
          discountTotal: Number(pi.metadata.discountTotal || 0),
        };
        paymentIntentId = pi.id;
        if (pi.metadata?.deliveryFee) {
          deliveryOverride = {
            fee: Number(pi.metadata.deliveryFee),
            distanceKm: Number(pi.metadata.deliveryDistanceKm || 0),
          };
          homeDelivery = {
            address: String(pi.metadata.deliveryAddress || ""),
            lat: Number(pi.metadata.deliveryLat || 0),
            lng: Number(pi.metadata.deliveryLng || 0),
          };
        }
      } else {
        // Flujo 100% crédito: eco de campos, todo se re-valida server-side.
        if (!body.petIds?.length || !body.date || !body.checkInTime || !body.checkOutTime) {
          return reply.status(400).send({
            error: "petIds, date, checkInTime y checkOutTime son requeridos sin paymentIntent",
          });
        }
        petIds = [...new Set(body.petIds)];
        date = body.date;
        checkInTime = body.checkInTime;
        checkOutTime = body.checkOutTime;
        notes = body.notes;
        homeDelivery = body.homeDelivery;

        const pets = await prisma.pet.findMany({ where: { id: { in: petIds } } });
        if (pets.length !== petIds.length) {
          return reply.status(404).send({ error: "Mascota no encontrada" });
        }
        ownerId = pets[0].ownerId;
        const isStaffOrAdmin =
          request.userRole === "ADMIN" || request.userRole === "STAFF";
        if (
          pets.some((p) => p.ownerId !== ownerId) ||
          (!isStaffOrAdmin && ownerId !== request.userId)
        ) {
          return reply.status(403).send({ error: "No autorizado" });
        }

        const windowError = validateDaycareWindow(date, checkInTime, checkOutTime);
        if (windowError) return reply.status(400).send({ error: windowError });

        const pricing = await getLodgingPricing(prisma);
        const hours = computeDaycareHours(checkInTime, checkOutTime);
        const subtotal = hours * pricing.daycareHourPrice * petIds.length;
        const d = await resolveDiscount(prisma, {
          code: body.discountCode,
          subtotal,
        });
        if (d.error) return reply.status(400).send({ error: d.error });
        discount = { discountCodeId: d.discountCodeId, discountTotal: d.discountTotal };
      }

      const [owner, pets] = await Promise.all([
        prisma.user.findUnique({ where: { id: ownerId } }),
        prisma.pet.findMany({ where: { id: { in: petIds } } }),
      ]);
      if (!owner) return reply.status(404).send({ error: "Usuario no encontrado" });
      if (pets.length !== petIds.length) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }

      const result = await createDaycareGroup(prisma, {
        owner,
        pets,
        date,
        checkInTime,
        checkOutTime,
        homeDelivery,
        stripePaymentIntentId: paymentIntentId,
        creditApplied,
        discount,
        deliveryOverride,
        notes,
        legalAccepted: true,
      });
      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error });
      }

      return reply.send({
        success: true,
        reservations: result.reservations,
        groupId: result.groupId,
        grandTotal: result.grandTotal,
        hours: result.hours,
      });
    }
  );

  // ────────────────────────────────────────────────────────────
  //  GET /staff/daycares?date=YYYY-MM-DD — guarderías del día
  //  Default: hoy + 30 días (misma convención que /staff/baths).
  // ────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { date?: string } }>(
    "/staff/daycares",
    { preHandler: staffAuth },
    async (request, reply) => {
      const dateQuery = request.query.date;
      if (dateQuery && !isValidDateYMD(dateQuery)) {
        return reply.status(400).send({ error: "date debe ser YYYY-MM-DD" });
      }
      const dateYMD = dateQuery ?? todayYMDLocal();
      const range = daycareDayRange(dateYMD)!;
      const RANGE_DAYS = dateQuery ? 1 : 31;
      const rangeEnd = new Date(
        range.start.getTime() + RANGE_DAYS * 24 * 3600 * 1000
      );

      const daycares = await prisma.reservation.findMany({
        where: {
          reservationType: "DAYCARE",
          status: { not: "CANCELLED" },
          appointmentAt: { gte: range.start, lt: rangeEnd },
        },
        include: {
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
            include: { variant: { include: { serviceType: true } } },
          },
          payments: {
            where: { status: "PAID" },
            select: { id: true, amount: true, method: true, paidAt: true },
          },
        },
        orderBy: [{ appointmentAt: "asc" }, { checkInTime: "asc" }],
      });

      return { date: dateYMD, daycares };
    }
  );

  // ────────────────────────────────────────────────────────────
  //  POST /staff/daycares/:id/check-in — el perro llegó.
  //  Aplica al grupo completo (multi-mascota entra junta).
  // ────────────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    "/staff/daycares/:id/check-in",
    { preHandler: staffAuth },
    async (request, reply) => {
      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: { pet: { select: { name: true } } },
      });
      if (!reservation || reservation.reservationType !== "DAYCARE") {
        return reply.status(404).send({ error: "Guardería no encontrada" });
      }
      if (reservation.status !== "CONFIRMED") {
        return reply
          .status(409)
          .send({ error: "La guardería no está pendiente de check-in" });
      }

      const where = reservation.groupId
        ? { groupId: reservation.groupId, reservationType: "DAYCARE" as const, status: "CONFIRMED" as const }
        : { id: reservation.id };
      await prisma.reservation.updateMany({
        where,
        data: { status: "CHECKED_IN", staffId: request.userId },
      });

      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "CHECK_IN",
        title: "¡Ya está con nosotros! 🐾",
        body: `${reservation.pet.name} entró a guardería. Te avisamos cualquier cosa.`,
        data: { reservationId: reservation.id, kind: "DAYCARE_CHECK_IN" },
      });

      return reply.send({ success: true });
    }
  );

  // ────────────────────────────────────────────────────────────
  //  POST /staff/daycares/:id/check-out — el perro se va.
  //  Calcula horas extra vs la salida estimada (tolerancia 15 min) y las
  //  agrega como add-on EXTRA_HOURS (unitPrice = monto total, quantity =
  //  horas — misma semántica que agregarHorasExtra del admin web). Concluye
  //  solo si el saldo queda en cero; si no, queda esperando pago manual.
  // ────────────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { pickupTime?: string } }>(
    "/staff/daycares/:id/check-out",
    { preHandler: staffAuth },
    async (request, reply) => {
      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: {
          pet: { select: { name: true } },
          payments: { where: { status: "PAID" } },
          addons: { include: { variant: { include: { serviceType: true } } } },
        },
      });
      if (!reservation || reservation.reservationType !== "DAYCARE") {
        return reply.status(404).send({ error: "Guardería no encontrada" });
      }
      if (reservation.status === "CANCELLED") {
        return reply.status(400).send({ error: "La guardería está cancelada" });
      }
      if (reservation.status === "CHECKED_OUT") {
        return reply.status(409).send({ error: "La guardería ya concluyó" });
      }

      // Hora real de recogida (min desde medianoche, hora local del hotel).
      let actualMinutes = nowMinutesLocal();
      if (request.body?.pickupTime) {
        const parsedMinutes = minutesFromHHmm(request.body.pickupTime);
        if (Number.isNaN(parsedMinutes)) {
          return reply.status(400).send({ error: "pickupTime inválido (HH:mm)" });
        }
        actualMinutes = parsedMinutes;
      }

      const pricing = await getLodgingPricing(prisma);
      const extraHours = reservation.checkOutTime
        ? computeDaycareExtraHours(reservation.checkOutTime, actualMinutes)
        : 0;
      const extraAmount = extraHours * pricing.daycareHourPrice;

      const existingExtra = reservation.addons.find(
        (a) => a.variant?.serviceType?.code === "EXTRA_HOURS"
      );

      let newTotal = Number(reservation.totalAmount);
      try {
        await prisma.$transaction(async (tx) => {
          if (extraHours === 0) return;
          if (existingExtra) {
            // Reintento de check-out: reemplaza el addon anterior y ajusta el
            // total por la diferencia.
            const prevAmount = Number(existingExtra.unitPrice);
            await tx.reservationAddon.update({
              where: { id: existingExtra.id },
              data: {
                unitPrice: new Prisma.Decimal(extraAmount),
                quantity: extraHours,
              },
            });
            newTotal += extraAmount - prevAmount;
          } else {
            const extraType = await tx.serviceType.findUnique({
              where: { code: "EXTRA_HOURS" },
              include: { variants: { take: 1 } },
            });
            const anchorVariant = extraType?.variants[0];
            if (!anchorVariant) {
              throw new Error("EXTRA_HOURS_NOT_SEEDED");
            }
            await tx.reservationAddon.create({
              data: {
                reservationId: reservation.id,
                variantId: anchorVariant.id,
                unitPrice: new Prisma.Decimal(extraAmount),
                quantity: extraHours,
                paidWith: "BOOKING",
                completedAt: new Date(),
              },
            });
            newTotal += extraAmount;
          }
          await tx.reservation.update({
            where: { id: reservation.id },
            data: { totalAmount: new Prisma.Decimal(newTotal) },
          });
        });
      } catch (err) {
        if (err instanceof Error && err.message === "EXTRA_HOURS_NOT_SEEDED") {
          return reply
            .status(500)
            .send({ error: "Servicio EXTRA_HOURS no configurado" });
        }
        throw err;
      }

      const totalPaid = reservation.payments.reduce(
        (sum, p) => sum + Number(p.amount),
        0
      );
      const balance = Math.max(0, newTotal - totalPaid);
      const concluded = balance <= 0.01;

      if (concluded) {
        await prisma.reservation.update({
          where: { id: reservation.id },
          data: { status: "CHECKED_OUT" },
        });
        await notifyUser(prisma, {
          userId: reservation.ownerId,
          type: "CHECK_OUT",
          title: "¡Hasta pronto! 🐾",
          body: `${reservation.pet.name} salió de guardería. ¡Gracias por visitarnos!`,
          data: { reservationId: reservation.id, kind: "DAYCARE_CHECK_OUT" },
        });
      }

      return reply.send({
        success: true,
        extraHours,
        extraAmount,
        newTotal,
        balance,
        concluded,
      });
    }
  );

  // ────────────────────────────────────────────────────────────
  //  POST /staff/daycares/:id/register-manual-payment
  //  Efectivo/transferencia al recoger (espejo del de baños). Si el
  //  acumulado cubre el total y ya está CHECKED_IN, concluye.
  // ────────────────────────────────────────────────────────────
  fastify.post<{
    Params: { id: string };
    Body: { amount?: number; method?: "CASH" | "TRANSFER"; notes?: string };
  }>(
    "/staff/daycares/:id/register-manual-payment",
    { preHandler: staffAuth },
    async (request, reply) => {
      const method = request.body?.method ?? "CASH";
      const amount = request.body?.amount;
      if (!["CASH", "TRANSFER"].includes(method)) {
        return reply.status(400).send({ error: "Método inválido" });
      }
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        return reply
          .status(400)
          .send({ error: "El monto debe ser un número mayor a 0" });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: {
          pet: { select: { name: true } },
          payments: { where: { status: "PAID" } },
        },
      });
      if (!reservation || reservation.reservationType !== "DAYCARE") {
        return reply.status(404).send({ error: "Guardería no encontrada" });
      }
      if (reservation.status === "CANCELLED") {
        return reply.status(400).send({ error: "La guardería está cancelada" });
      }
      if (reservation.status === "CHECKED_OUT") {
        return reply.status(409).send({ error: "La guardería ya concluyó" });
      }

      const totalPaidBefore = reservation.payments.reduce(
        (sum, p) => sum + Number(p.amount),
        0
      );
      const balance = Math.max(
        0,
        Number(reservation.totalAmount) - totalPaidBefore
      );
      if (balance <= 0.01) {
        return reply
          .status(400)
          .send({ error: "No hay saldo pendiente para registrar." });
      }
      if (amount - balance > 1) {
        return reply.status(400).send({
          error: `El monto excede el saldo pendiente ($${balance.toLocaleString("es-MX")}).`,
        });
      }

      await prisma.payment.create({
        data: {
          amount: new Prisma.Decimal(amount),
          method,
          status: "PAID",
          paidAt: new Date(),
          reservationId: reservation.id,
          userId: reservation.ownerId,
          notes:
            request.body?.notes?.trim() ||
            `Pago manual (${method}) registrado por staff`,
        },
      });

      // El pago manual ocurre al recoger: si cubre el saldo y el perro ya
      // estaba adentro (CHECKED_IN), la guardería concluye.
      let concluded = false;
      if (
        reservation.status === "CHECKED_IN" &&
        totalPaidBefore + amount + 0.01 >= Number(reservation.totalAmount)
      ) {
        await prisma.reservation.update({
          where: { id: reservation.id },
          data: { status: "CHECKED_OUT" },
        });
        concluded = true;
      }

      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "GENERAL",
        title: "Pago recibido",
        body: `Recibimos $${amount.toLocaleString("es-MX")} de la guardería de ${reservation.pet.name}. ¡Gracias!`,
        data: { reservationId: reservation.id, kind: "DAYCARE_PAID" },
      });

      return reply.send({ success: true, amount, concluded });
    }
  );
}
