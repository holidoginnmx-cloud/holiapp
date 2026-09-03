import { Prisma } from "@holidoginn/db";
import type { PrismaClient, Pet, User } from "@prisma/client";
import { randomUUID } from "crypto";
import { notifyUser } from "./notify";
import {
  notifyNewReservation,
  type NewReservationSource,
} from "./notifyNewReservation";
import { getLodgingPricing, computeDaycareHours } from "./pricing";
import { quoteDelivery, type DeliveryTripMode } from "./delivery";
import { invalidateAuthCache } from "../middleware/auth";

// ---------------------------------------------------------------------------
// Guardería (DAYCARE) — servicio de día cobrado por hora (tarifa única).
//
// Modelo de datos (consistente con el admin web):
//   appointmentAt  = día de la guardería anclado a MEDIODÍA UTC (no codifica
//                    la hora real; ordena bien y las vistas bucketizan por día)
//   checkInTime    = hora estimada de entrada  ("HH:mm", hora local del hotel)
//   checkOutTime   = hora estimada de salida   ("HH:mm")
//   totalAmount    = horas × daycareHourPrice por perro (+ domicilio − descuento)
//   checkIn/checkOut/totalDays = null
//
// El excedente al recoger se cobra como add-on EXTRA_HOURS (ver routes/daycare).
// ---------------------------------------------------------------------------

type ReservationStatusType = import("@holidoginn/db").ReservationStatus;

/** Día "YYYY-MM-DD" → Date anclado a mediodía UTC (convención del admin web). */
export function daycareDayAnchor(dateYMD: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYMD);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  if (Number.isNaN(anchor.getTime())) return null;
  return anchor;
}

/** Rango UTC [00:00, 24:00) del día "YYYY-MM-DD" (contiene el anchor). */
export function daycareDayRange(
  dateYMD: string
): { start: Date; end: Date } | null {
  const anchor = daycareDayAnchor(dateYMD);
  if (!anchor) return null;
  const start = new Date(anchor.getTime() - 12 * 3600 * 1000);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { start, end };
}

/**
 * Ocupación del hotel para un día: estancias (STAY) que solapan el día +
 * guarderías (DAYCARE) de ese día, contra hotel_config.maxCapacity. Misma
 * regla que la vista de ocupación y que lib/ocupacion.ts del admin web:
 * "la guardería ocupa un lugar ese día; la estética no".
 */
export async function countDaycareOccupancy(
  prisma: PrismaClient | Prisma.TransactionClient,
  dateYMD: string
): Promise<{ occupied: number; maxCapacity: number }> {
  const range = daycareDayRange(dateYMD);
  if (!range) return { occupied: 0, maxCapacity: 0 };
  const anchor = new Date(range.start.getTime() + 12 * 3600 * 1000);

  const activeStatuses: ReservationStatusType[] = ["CONFIRMED", "CHECKED_IN"];
  const [stays, daycares, hotelConfig] = await Promise.all([
    // STAY ocupa la noche del día D si checkIn ≤ D < checkOut (el día del
    // check-out ya no ocupa). checkIn/checkOut se guardan a las 00:00 del día,
    // así que compararlos contra el anchor de mediodía es exacto.
    prisma.reservation.count({
      where: {
        reservationType: "STAY",
        status: { in: activeStatuses },
        checkIn: { lte: anchor },
        checkOut: { gt: anchor },
      },
    }),
    prisma.reservation.count({
      where: {
        reservationType: "DAYCARE",
        status: { in: activeStatuses },
        appointmentAt: { gte: range.start, lt: range.end },
      },
    }),
    prisma.hotelConfig.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    }),
  ]);

  return { occupied: stays + daycares, maxCapacity: hotelConfig.maxCapacity };
}

export interface CreateDaycareGroupParams {
  owner: User;
  /** Mascotas YA verificadas: existen y pertenecen al owner. */
  pets: Pet[];
  /** Día de la guardería ("YYYY-MM-DD", fecha local del hotel). */
  date: string;
  checkInTime: string;
  checkOutTime: string;
  homeDelivery?: {
    address: string;
    lat: number;
    lng: number;
    placeId?: string;
    trip?: DeliveryTripMode;
  };
  /** PI de Stripe (null cuando el saldo a favor cubrió todo). */
  stripePaymentIntentId: string | null;
  /** Saldo a favor ya aplicado (viene del intent; 0 para invitados). */
  creditApplied?: number;
  /**
   * Lo que Stripe cobró en pesos (`pi.amount / 100`). Solo se usa si por
   * redondeo el crédito cubrió todas las filas y hay que colgar el PI de
   * un pago por la diferencia.
   */
  stripeChargedAmount?: number;
  /** Descuento YA resuelto por el caller (del metadata del PI o re-validado). */
  discount?: { discountCodeId: string | null; discountTotal: number };
  /** Fee de domicilio YA cotizada (del metadata del PI); si falta se recotiza. */
  deliveryOverride?: { fee: number; distanceKm: number } | null;
  notes?: string | null;
  legalAccepted: boolean;
  /** De dónde vino (app del cliente o sitio público). */
  source?: NewReservationSource;
  /** Si la creó alguien del equipo, se le excluye del aviso. */
  createdByUserId?: string | null;
}

export type CreateDaycareGroupResult =
  | {
      ok: true;
      reservations: Array<Prisma.ReservationGetPayload<{ include: { pet: true } }>>;
      grandTotal: number;
      groupId: string | null;
      hours: number;
      creditApplied: number;
    }
  | { ok: false; status: number; error: string };

/**
 * Crea el grupo de reservaciones DAYCARE (una por mascota, mismo día y mismas
 * horas), registra pagos, aplica crédito/descuento y notifica. Espejo
 * estructural de createReservationGroup (STAY) sin cuartos, sin cartilla y sin
 * recargos de medicamento/mismo-día.
 *
 * NOTA: el llamador valida ANTES pertenencia de mascotas, horario y formato;
 * aquí se re-verifica el CUPO dentro de la transacción (advisory lock por día,
 * namespace 43) para que confirmaciones concurrentes no sobrevendan.
 */
export async function createDaycareGroup(
  prisma: PrismaClient,
  params: CreateDaycareGroupParams
): Promise<CreateDaycareGroupResult> {
  const {
    owner,
    pets,
    date,
    checkInTime,
    checkOutTime,
    homeDelivery,
    stripePaymentIntentId,
    discount,
    deliveryOverride,
    notes = null,
    legalAccepted,
  } = params;
  const ownerId = owner.id;

  const appointmentAt = daycareDayAnchor(date);
  if (!appointmentAt) {
    return { ok: false, status: 400, error: "Fecha inválida (YYYY-MM-DD)" };
  }
  const hours = computeDaycareHours(checkInTime, checkOutTime);
  if (hours <= 0) {
    return {
      ok: false,
      status: 400,
      error: "La hora de salida debe ser posterior a la de entrada",
    };
  }

  const pricingConfig = await getLodgingPricing(prisma);
  const hourPrice = pricingConfig.daycareHourPrice;
  const perPetSubtotal = hours * hourPrice;
  const subtotal = perPetSubtotal * pets.length;

  // Descuento (acotado defensivamente al subtotal).
  const discountCodeId = discount?.discountCodeId ?? null;
  const discountTotal = Math.min(
    Math.max(0, discount?.discountTotal ?? 0),
    subtotal
  );

  // Domicilio: usar la cotización del intent si viene (flujo Stripe); si no,
  // recotizar server-side (flujo credit-only).
  let deliveryFee = 0;
  let deliveryDistanceKm = 0;
  let deliveryActive = false;
  if (homeDelivery && Number.isFinite(homeDelivery.lat) && Number.isFinite(homeDelivery.lng)) {
    if (deliveryOverride) {
      deliveryActive = true;
      deliveryFee = deliveryOverride.fee;
      deliveryDistanceKm = deliveryOverride.distanceKm;
    } else {
      const quote = await quoteDelivery(
        prisma,
        homeDelivery.lat,
        homeDelivery.lng,
        homeDelivery.trip ?? "PICKUP"
      );
      if (quote.active) {
        deliveryActive = true;
        deliveryFee = quote.fee;
        deliveryDistanceKm = quote.distanceKm;
      }
    }
  }

  const grandTotal = subtotal - discountTotal + deliveryFee;
  const groupId = pets.length > 1 ? randomUUID() : null;

  const creditOnly = !stripePaymentIntentId;
  let creditApplied = params.creditApplied ?? 0;
  if (creditOnly) {
    // Sin PaymentIntent, el saldo a favor TIENE que cubrir el total: si no,
    // el cliente debe pagar con tarjeta (create-intent lo manda a Stripe).
    // Antes bastaba con no mandar PI para dejar la guardería "pagada" con
    // saldo $0.
    const ownerCredit = Number(owner.creditBalance || 0);
    if (ownerCredit + 0.005 < grandTotal) {
      return {
        ok: false,
        status: 402,
        error:
          "Tu saldo a favor no cubre el total de la guardería. Paga con tarjeta para confirmar.",
      };
    }
    creditApplied = grandTotal;
  }

  let reservations: Array<
    Prisma.ReservationGetPayload<{ include: { pet: true } }>
  >;
  let ownerClerkIdToInvalidate: string | null = null;
  try {
    reservations = await prisma.$transaction(async (tx) => {
      // Lock por día (namespace 43 = cupo de guardería): serializa
      // confirmaciones concurrentes del mismo día para que el
      // count-then-create del cupo sea atómico.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(43, hashtext(${date}))`;
      const { occupied, maxCapacity } = await countDaycareOccupancy(tx, date);
      if (occupied + pets.length > maxCapacity) {
        throw new Error("DAYCARE_FULL");
      }

      const created: Array<
        Prisma.ReservationGetPayload<{ include: { pet: true } }>
      > = [];
      // Descuento proporcional por mascota (a centavos); el residuo va a la
      // primera para que la suma cuadre exacto con grandTotal.
      const discountShare =
        Math.floor((discountTotal / pets.length) * 100) / 100;
      for (let i = 0; i < pets.length; i++) {
        const pet = pets[i];
        const isFirst = i === 0;
        const discountForThis = isFirst
          ? discountTotal - discountShare * (pets.length - 1)
          : discountShare;
        const deliveryForThis = isFirst && deliveryActive ? deliveryFee : 0;
        const reservationAmount = perPetSubtotal - discountForThis + deliveryForThis;
        created.push(
          await tx.reservation.create({
            data: {
              reservationType: "DAYCARE",
              appointmentAt,
              checkInTime,
              checkOutTime,
              status: "CONFIRMED",
              totalAmount: new Prisma.Decimal(reservationAmount),
              ...(discountCodeId
                ? {
                    discountCodeId,
                    discountTotal: new Prisma.Decimal(discountForThis),
                  }
                : {}),
              notes,
              legalAccepted,
              groupId,
              paymentType: "FULL",
              ownerId,
              petId: pet.id,
              ...(isFirst && deliveryActive
                ? {
                    homeDelivery: true,
                    homeDeliveryAddress: homeDelivery!.address,
                    homeDeliveryDistanceKm: deliveryDistanceKm,
                    homeDeliveryFee: new Prisma.Decimal(deliveryFee),
                    homeDeliveryTrip: homeDelivery!.trip ?? "PICKUP",
                  }
                : {}),
            },
            include: { pet: true },
          })
        );
      }

      // Contar el uso del código UNA vez por grupo. En Stripe, el @unique de
      // Payment.stripePaymentIntentId evita doble conteo ante reintento.
      if (discountCodeId) {
        await tx.discountCode.update({
          where: { id: discountCodeId },
          data: { usesCount: { increment: 1 } },
        });
      }

      // Pagos DENTRO de la misma transacción que las reservas: si dos confirms
      // con el mismo PI entran a la vez (reintento en pantalla + recuperación
      // al arrancar), el segundo revienta en el @unique del PI y el rollback
      // se lleva también sus reservas; antes quedaban reservas duplicadas sin
      // pago. El estimado se cobra completo al reservar; el saldo a favor
      // aplicado se registra APARTE como pago CREDIT (se agota fila por fila)
      // para que el pago STRIPE valga exactamente lo que Stripe cobró.
      let remainingCredit = Number(creditApplied.toFixed(2));
      let piAttached = false;
      for (let i = 0; i < created.length; i++) {
        const res = created[i];
        const rowTotal = Number(res.totalAmount);
        const creditPart = creditOnly
          ? rowTotal
          : Number(Math.min(remainingCredit, rowTotal).toFixed(2));
        remainingCredit = Number((remainingCredit - creditPart).toFixed(2));
        const stripePart = Number((rowTotal - creditPart).toFixed(2));
        if (creditPart > 0) {
          await tx.payment.create({
            data: {
              amount: new Prisma.Decimal(creditPart),
              method: "CREDIT",
              status: "PAID",
              paidAt: new Date(),
              notes: "Guardería — pago con saldo a favor",
              reservationId: res.id,
              userId: ownerId,
            },
          });
        }
        if (stripePart > 0) {
          await tx.payment.create({
            data: {
              amount: new Prisma.Decimal(stripePart),
              method: "STRIPE",
              status: "PAID",
              stripePaymentIntentId: piAttached ? null : stripePaymentIntentId,
              paidAt: new Date(),
              notes: `Guardería — ${hours} h estimadas`,
              reservationId: res.id,
              userId: ownerId,
            },
          });
          piAttached = true;
        }
      }
      // Stripe cobró (aunque sean centavos de redondeo) y ninguna fila se
      // llevó el PI: no puede quedar huérfano (idempotencia y reembolsos).
      if (stripePaymentIntentId && !piAttached && created[0]) {
        await tx.payment.create({
          data: {
            amount: new Prisma.Decimal(
              params.stripeChargedAmount != null && params.stripeChargedAmount > 0
                ? params.stripeChargedAmount
                : 0.01,
            ),
            method: "STRIPE",
            status: "PAID",
            stripePaymentIntentId,
            paidAt: new Date(),
            notes: "Diferencia de redondeo cobrada con tarjeta",
            reservationId: created[0].id,
            userId: ownerId,
          },
        });
      }

      if (creditApplied > 0) {
        const updatedOwner = await tx.user.update({
          where: { id: ownerId },
          data: { creditBalance: { decrement: creditApplied }, lastCreditEntryAt: new Date() },
        });
        ownerClerkIdToInvalidate = updatedOwner.clerkId;
        await tx.creditLedger.create({
          data: {
            userId: ownerId,
            type: "CREDIT_APPLIED",
            amount: -creditApplied,
            balanceAfter: Number(updatedOwner.creditBalance),
            description: "Saldo aplicado en guardería",
            reservationId: created[0]?.id ?? null,
          },
        });
      }

      return created;
    });
  } catch (err) {
    if (err instanceof Error && err.message === "DAYCARE_FULL") {
      return {
        ok: false,
        status: 409,
        error: "No hay cupo de guardería para ese día",
      };
    }
    throw err;
  }

  if (creditApplied > 0) {
    if (ownerClerkIdToInvalidate) invalidateAuthCache(ownerClerkIdToInvalidate);
    await notifyUser(prisma, {
      userId: ownerId,
      type: "CREDIT_APPLIED",
      title: "Saldo a favor aplicado 💰",
      body: `Se aplicaron $${creditApplied.toLocaleString("es-MX")} de tu saldo a la guardería.`,
      data: { reservationId: reservations[0]?.id, amount: creditApplied },
    });
  }

  await notifyNewReservation(prisma, {
    reservations,
    owner,
    source: params.source ?? "SITIO_WEB",
    createdByUserId: params.createdByUserId ?? null,
  });

  return { ok: true, reservations, grandTotal, groupId, hours, creditApplied };
}
