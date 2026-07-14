import { Prisma } from "@holidoginn/db";
import type { PrismaClient, Pet, User } from "@prisma/client";
import { randomUUID } from "crypto";
import { notifyUser, notifyUsers } from "./notify";
import { getLodgingPricing, computeDaycareHours } from "./pricing";
import { quoteDelivery } from "./delivery";
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
  homeDelivery?: { address: string; lat: number; lng: number; placeId?: string };
  /** PI de Stripe (null cuando el saldo a favor cubrió todo). */
  stripePaymentIntentId: string | null;
  /** Saldo a favor ya aplicado (viene del intent; 0 para invitados). */
  creditApplied?: number;
  /** Descuento YA resuelto por el caller (del metadata del PI o re-validado). */
  discount?: { discountCodeId: string | null; discountTotal: number };
  /** Fee de domicilio YA cotizada (del metadata del PI); si falta se recotiza. */
  deliveryOverride?: { fee: number; distanceKm: number } | null;
  notes?: string | null;
  legalAccepted: boolean;
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
      const quote = await quoteDelivery(prisma, homeDelivery.lat, homeDelivery.lng);
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
  if (creditOnly && creditApplied === 0) {
    const ownerCredit = Number(owner.creditBalance || 0);
    creditApplied = Math.min(ownerCredit, grandTotal);
  }

  let reservations: Array<
    Prisma.ReservationGetPayload<{ include: { pet: true } }>
  >;
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

  // Pagos: el estimado se cobra completo al reservar (misma convención que
  // createReservationGroup: un Payment por reserva; el PI queda en la primera).
  for (let i = 0; i < reservations.length; i++) {
    const res = reservations[i];
    await prisma.payment.create({
      data: {
        amount: res.totalAmount,
        method: creditOnly ? "CREDIT" : "STRIPE",
        status: "PAID",
        stripePaymentIntentId: i === 0 && !creditOnly ? stripePaymentIntentId : null,
        paidAt: new Date(),
        notes: creditOnly
          ? "Guardería — pago con saldo a favor"
          : `Guardería — ${hours} h estimadas`,
        reservationId: res.id,
        userId: ownerId,
      },
    });
  }

  if (creditApplied > 0) {
    const updatedOwner = await prisma.user.update({
      where: { id: ownerId },
      data: { creditBalance: { decrement: creditApplied }, lastCreditEntryAt: new Date() },
    });
    invalidateAuthCache(updatedOwner.clerkId);
    await prisma.creditLedger.create({
      data: {
        userId: ownerId,
        type: "CREDIT_APPLIED",
        amount: -creditApplied,
        balanceAfter: Number(updatedOwner.creditBalance),
        description: "Saldo aplicado en guardería",
        reservationId: reservations[0]?.id ?? null,
      },
    });
    await notifyUser(prisma, {
      userId: ownerId,
      type: "CREDIT_APPLIED",
      title: "Saldo a favor aplicado 💰",
      body: `Se aplicaron $${creditApplied.toLocaleString("es-MX")} de tu saldo a la guardería.`,
      data: { reservationId: reservations[0]?.id, amount: creditApplied },
    });
  }

  // Notificar a staff/admins (mismo canal que las reservas nuevas).
  const petNames = reservations
    .map((r) => r.pet?.name)
    .filter(Boolean)
    .join(", ");
  const staffUsers = await prisma.user.findMany({
    where: { role: { in: ["STAFF", "ADMIN"] }, isActive: true },
    select: { id: true },
  });
  if (staffUsers.length > 0) {
    const when = `${date} · ${checkInTime}–${checkOutTime}`;
    await notifyUsers(
      prisma,
      staffUsers.map((s) => s.id),
      {
        type: "NEW_RESERVATION" as never,
        title: "Nueva guardería 🐾",
        body: `${petNames || "Una mascota"} — ${when} (${hours} h).`,
        data: { reservationId: reservations[0]?.id, kind: "DAYCARE_BOOKED" },
      }
    );
  }

  return { ok: true, reservations, grandTotal, groupId, hours, creditApplied };
}
