import { FastifyInstance } from "fastify";
import {
  CreateDaycareIntentSchema,
  ConfirmDaycareSchema,
  UpdateDaycareScheduleSchema,
} from "@holidoginn/shared";
import { Prisma, ReservationStatus } from "@holidoginn/db";
import Stripe from "stripe";
import {
  createAuthMiddleware,
  createStaffMiddleware,
} from "../middleware/auth";
import { notifyPetAudience, notifyTeamReservationUpdated } from "../lib/notify";
import { sharedPetIds } from "../lib/petAccess";
import { requestReview } from "../lib/reviewRequest";
import { notifyBalanceDue } from "../lib/balanceReminder";
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
  daycareDayAnchor,
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

/**
 * "YYYY-MM-DD" del día de una guardería. El `appointmentAt` se ancla a MEDIODÍA
 * UTC (convención de daycareDayAnchor), así que el día se lee en UTC — leerlo
 * en local correría la fecha un día.
 */
export function ymdFromDayAnchor(anchor: Date): string {
  return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}-${String(anchor.getUTCDate()).padStart(2, "0")}`;
}

/** Minutos desde medianoche AHORA en hora local del hotel. */
function nowMinutesLocal(): number {
  const local = new Date(Date.now() - TZ_OFFSET_HOURS * 3600 * 1000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/**
 * Valida día + horas de una guardería. Devuelve mensaje de error o null.
 * Reglas: día no pasado, horas dentro de la ventana 9:00–18:00, salida
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
          ? quoteDelivery(
              prisma,
              homeDelivery!.lat,
              homeDelivery!.lng,
              homeDelivery!.trip ?? "PICKUP"
            )
          : null,
      ]);

      if (pets.length !== uniquePetIds.length) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      // Regla del pagador: la guardería queda a nombre de quien la reserva y la
      // paga, no del dueño de la ficha. Sin esto, un co-dueño pagaría con su
      // tarjeta una reserva atribuida al otro, se le ofrecería el saldo a favor
      // ajeno y un reembolso caería en la cuenta equivocada.
      const ownerId = isStaffOrAdmin ? pets[0].ownerId : request.userId!;
      const sharedForBooker = isStaffOrAdmin
        ? []
        : await sharedPetIds(prisma, ownerId);
      const allAccessible = pets.every(
        (p) => p.ownerId === ownerId || sharedForBooker.includes(p.id)
      );
      if (!allAccessible) {
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
        const isStaffOrAdmin =
          request.userRole === "ADMIN" || request.userRole === "STAFF";
        // Misma regla del pagador que en create-intent: el crédito que se
        // aplica es el de quien confirma, así que la reserva es suya.
        ownerId = isStaffOrAdmin ? pets[0].ownerId : request.userId!;
        const sharedForBooker = isStaffOrAdmin
          ? []
          : await sharedPetIds(prisma, ownerId);
        const allAccessible = pets.every(
          (p) => p.ownerId === ownerId || sharedForBooker.includes(p.id)
        );
        if (!allAccessible) {
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
        source: request.userRole === "OWNER" ? "APP_CLIENTE" : "APP_ADMIN",
        createdByUserId: request.userId ?? null,
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

      await notifyPetAudience(prisma, { petId: reservation.petId, ownerId: reservation.ownerId }, {
        
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
        await notifyPetAudience(prisma, { petId: reservation.petId, ownerId: reservation.ownerId }, {
          
          type: "CHECK_OUT",
          title: "¡Hasta pronto! 🐾",
          body: `${reservation.pet.name} salió de guardería. ¡Gracias por visitarnos!`,
          data: { reservationId: reservation.id, kind: "DAYCARE_CHECK_OUT" },
        });
        await requestReview(prisma, reservation.id);
        // Si la guardería se cierra con saldo, el dueño se entera y lo paga
        // desde la app.
        await notifyBalanceDue(prisma, reservation.id);
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
        await requestReview(prisma, reservation.id);
        await notifyBalanceDue(prisma, reservation.id);
      }

      await notifyPetAudience(prisma, { petId: reservation.petId, ownerId: reservation.ownerId }, {
        
        type: "GENERAL",
        title: "Pago recibido",
        body: `Recibimos $${amount.toLocaleString("es-MX")} de la guardería de ${reservation.pet.name}. ¡Gracias!`,
        data: { reservationId: reservation.id, kind: "DAYCARE_PAID" },
      });

      return reply.send({ success: true, amount, concluded });
    }
  );

  // ────────────────────────────────────────────────────────────
  //  PATCH /staff/daycares/:id/schedule — mover el día y/o el horario
  //  de una guardería ya creada (STAFF/ADMIN).
  //
  //  En guardería las horas SON el precio (horas × tarifa), así que
  //  esto no es el `/reservations/:id/times` del dueño: ajusta el
  //  total por la DIFERENCIA de horas (como el cambio de fechas de
  //  una estancia), revalida el cupo si cambia de día y avisa.
  //
  //  A propósito NO usa `validateDaycareWindow`: esa es la ventana
  //  del flujo del cliente. El equipo captura lo que pasa en la vida
  //  real ("me lo recogen hasta las 7"), igual que al crear desde la
  //  app; el horario fuera de 9-18 sale como aviso, no como error.
  // ────────────────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>(
    "/staff/daycares/:id/schedule",
    { preHandler: staffAuth },
    async (request, reply) => {
      const parsed = UpdateDaycareScheduleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { date, checkInTime, checkOutTime, updateTotal, force } = parsed.data;

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: {
          pet: { select: { name: true } },
          payments: {
            where: { status: { in: ["PAID", "PARTIAL"] } },
            select: { amount: true },
          },
        },
      });
      if (!reservation || reservation.reservationType !== "DAYCARE") {
        return reply.status(404).send({ error: "Guardería no encontrada" });
      }
      // Una guardería concluida ya cobró sus horas extra al recoger: moverle
      // el horario después descuadraría ese cobro.
      if (reservation.status !== "CONFIRMED" && reservation.status !== "CHECKED_IN") {
        return reply.status(400).send({
          error:
            reservation.status === "CANCELLED"
              ? "La guardería está cancelada"
              : "La guardería ya concluyó",
        });
      }

      const newHours = computeDaycareHours(checkInTime, checkOutTime);
      if (newHours <= 0) {
        return reply
          .status(400)
          .send({ error: "La hora de salida debe ser posterior a la de entrada" });
      }

      const oldYMD = reservation.appointmentAt
        ? ymdFromDayAnchor(reservation.appointmentAt)
        : null;
      const newYMD = date ?? oldYMD;
      if (!newYMD) {
        return reply.status(400).send({ error: "La guardería no tiene día" });
      }
      const newAnchor = daycareDayAnchor(newYMD);
      if (!newAnchor) {
        return reply.status(400).send({ error: "Fecha inválida (YYYY-MM-DD)" });
      }
      const dayChanged = newYMD !== oldYMD;

      // Mover a un día que ya pasó solo con "Registrar de todos modos" (mismo
      // gate que al crear). Si el día NO cambia no aplica: una guardería
      // retroactiva se sigue pudiendo corregir de horas.
      if (dayChanged && newYMD < todayYMDLocal() && !force) {
        return reply.status(400).send({
          error: "Ese día ya pasó",
          code: "DATE_IN_PAST",
        });
      }

      // Todas las mascotas del grupo se mueven juntas (entran y salen juntas).
      const groupWhere = reservation.groupId
        ? {
            groupId: reservation.groupId,
            reservationType: "DAYCARE" as const,
            status: { in: ["CONFIRMED", "CHECKED_IN"] as ReservationStatus[] },
          }
        : { id: reservation.id };

      const pricing = await getLodgingPricing(prisma);
      // Sin horas previas (guardería vieja o capturada a medias) no hay
      // diferencia que cobrar: se corrige el horario sin tocar el dinero.
      const previousHours =
        reservation.checkInTime && reservation.checkOutTime
          ? computeDaycareHours(reservation.checkInTime, reservation.checkOutTime)
          : null;
      const delta =
        updateTotal && previousHours != null && previousHours > 0
          ? (newHours - previousHours) * pricing.daycareHourPrice
          : 0;

      const previousTotal = Number(reservation.totalAmount);
      const outcome = await prisma.$transaction(async (tx) => {
        const rows = await tx.reservation.findMany({
          where: groupWhere,
          select: { id: true, totalAmount: true },
        });

        if (dayChanged) {
          // Mismo lock por día del cupo (namespace 43) que la creación. Se
          // toman el día viejo y el nuevo en orden fijo para que dos cambios
          // cruzados no se deadlockeen.
          const days = [...new Set([oldYMD, newYMD].filter(Boolean))].sort();
          for (const ymd of days) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(43, hashtext(${ymd}))`;
          }
          // El grupo entero sale del día viejo, así que ninguna de sus filas
          // está contada en el día nuevo: no hace falta excluirlas.
          const { occupied, maxCapacity } = await countDaycareOccupancy(tx, newYMD);
          if (occupied + rows.length > maxCapacity && !force) {
            return { ok: false as const, occupied, maxCapacity };
          }
        }

        for (const row of rows) {
          await tx.reservation.update({
            where: { id: row.id },
            data: {
              appointmentAt: newAnchor,
              checkInTime,
              checkOutTime,
              ...(delta !== 0
                ? {
                    totalAmount: new Prisma.Decimal(
                      Math.max(0, Number(row.totalAmount) + delta)
                    ),
                  }
                : {}),
            },
          });

          // El recordatorio de 24 h deduplica por la existencia de una
          // Notification previa de esta reserva: sin borrarla, una guardería
          // movida después del recordatorio nunca anunciaría el día u hora
          // nuevos (ver /internal/bath-reminders).
          if (dayChanged || checkInTime !== reservation.checkInTime) {
            await tx.notification.deleteMany({
              where: {
                userId: reservation.ownerId,
                type: "RESERVATION_REMINDER",
                data: { path: ["reservationId"], equals: row.id },
              },
            });
          }
        }

        return { ok: true as const };
      });

      if (!outcome.ok) {
        return reply.status(409).send({
          error: `No hay cupo de guardería ese día (${outcome.occupied}/${outcome.maxCapacity} ocupado).`,
          code: "DAYCARE_FULL",
        });
      }

      const newTotal = delta !== 0 ? Math.max(0, previousTotal + delta) : previousTotal;
      const totalPaid = reservation.payments.reduce(
        (sum, p) => sum + Number(p.amount),
        0
      );
      const balance = Math.max(0, Number((newTotal - totalPaid).toFixed(2)));
      const overpaid = Math.max(0, Number((totalPaid - newTotal).toFixed(2)));

      const dayLabel = newAnchor.toLocaleDateString("es-MX", {
        weekday: "long",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      });
      const horario = `${checkInTime} a ${checkOutTime}`;

      // Avisos best-effort: nunca tumban el cambio ya escrito.
      await notifyPetAudience(
        prisma,
        { petId: reservation.petId, ownerId: reservation.ownerId },
        {
          type: "GENERAL",
          title: "Horario de guardería actualizado 🕘",
          body:
            `${reservation.pet.name}: ${dayLabel}, de ${horario}.` +
            (delta !== 0
              ? ` Nuevo total: $${newTotal.toLocaleString("es-MX")}.`
              : ""),
          data: { reservationId: reservation.id, kind: "DAYCARE_RESCHEDULED" },
        }
      );
      await notifyTeamReservationUpdated(prisma, {
        reservationId: reservation.id,
        petName: reservation.pet.name,
        body:
          `Guardería del ${dayLabel}, de ${horario}.` +
          (delta !== 0 ? ` Total: $${newTotal.toLocaleString("es-MX")}.` : ""),
        actorUserId: request.userId,
        assignedStaffId: reservation.staffId,
      });

      const outOfWindow =
        !isWithinDaycareHours(checkInTime) || !isWithinDaycareHours(checkOutTime);

      return reply.send({
        success: true,
        hours: newHours,
        previousHours,
        newTotal,
        previousTotal,
        delta: Number(delta.toFixed(2)),
        balance,
        overpaid,
        warning: outOfWindow
          ? `El horario queda fuera de ${DAYCARE_OPEN_HOUR}:00 a ${DAYCARE_CLOSE_HOUR}:00.`
          : null,
      });
    }
  );
}
