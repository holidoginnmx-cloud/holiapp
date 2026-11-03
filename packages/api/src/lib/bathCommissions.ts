import type { PrismaClient, ReservationType } from "@holidoginn/db";
import { HOTEL_TZ_OFFSET_HOURS } from "@holidoginn/shared";

// ─────────────────────────────────────────────────────────────
//  Comisión semanal de la estilista por baño.
//
//  Regla del negocio (José, 2026-11-02): 15% de baño + corte + deslanado, sin
//  domicilio ni otros servicios. Semana lunes–domingo; se paga el domingo.
//
//  Un baño cuenta en la semana en que se HIZO (addon.completedAt, en hora del
//  hotel), no en la que se cobró.
//
//  Base del baño: el PRECIO NORMAL (precio de lista de la variante), NO lo
//  cobrado. Con descuento, precio especial o cortesía, a la estilista se le
//  paga igual: el descuento lo regala el negocio, no ella. Se usa el precio
//  de la variante y no addon.unitPrice porque éste lo edita el admin (precio
//  especial) y la web le suma el corte en los baños de estancia.
//
//  Extras: extraCortePrice + extraDeslanadoPrice, lo que captura la estilista
//  (no tienen precio de lista: varían por perro). Si en vez de capturarlos se
//  metieron en el precio del baño, lo cobrado por encima de la lista se toma
//  como corte/deslanado (`extrasIncluded`).
// ─────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface HotelWeek {
  /** Lunes de la semana, YYYY-MM-DD (día del hotel). */
  weekStart: string;
  /** Domingo de la semana, YYYY-MM-DD. */
  weekEnd: string;
  /** Instante en que empieza el lunes en el hotel. */
  from: Date;
  /** Instante en que empieza el lunes siguiente (exclusivo). */
  to: Date;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Semana lunes–domingo del hotel que contiene `dateYMD` (o el día de hoy en
 * el hotel si no se pasa). Un baño del domingo a las 23:00 en Hermosillo es
 * lunes 06:00 UTC: por eso los límites van corridos al offset del hotel.
 */
export function hotelWeek(dateYMD: string | undefined, now: Date = new Date()): HotelWeek {
  let day: Date;
  if (dateYMD) {
    day = new Date(`${dateYMD}T00:00:00.000Z`);
  } else {
    const hotelNow = new Date(now.getTime() - HOTEL_TZ_OFFSET_HOURS * HOUR_MS);
    day = new Date(Date.UTC(hotelNow.getUTCFullYear(), hotelNow.getUTCMonth(), hotelNow.getUTCDate()));
  }
  // getUTCDay: 0 = domingo. Lunes = 0 días atrás, domingo = 6.
  const back = (day.getUTCDay() + 6) % 7;
  const monday = new Date(day.getTime() - back * DAY_MS);
  const from = new Date(monday.getTime() + HOTEL_TZ_OFFSET_HOURS * HOUR_MS);
  return {
    weekStart: ymd(monday),
    weekEnd: ymd(new Date(monday.getTime() + 6 * DAY_MS)),
    from,
    to: new Date(from.getTime() + 7 * DAY_MS),
  };
}

/** Un add-on de la misma reserva, lo mínimo para repartir el total. */
export interface SiblingAddon {
  id: string;
  unitPrice: number;
  isCourtesy: boolean;
  isBath: boolean;
}

export interface CommissionBathInput {
  addonId: string;
  reservationId: string;
  reservationType: ReservationType;
  reservationStatus: string;
  completedAt: Date;
  petName: string;
  ownerName: string;
  unitPrice: number;
  isCourtesy: boolean;
  variantCorte: boolean;
  variantDeslanado: boolean;
  /** Precio de lista de la variante (hoy). */
  variantPrice: number;
  extraCortePrice: number | null;
  extraDeslanadoPrice: number | null;
  extraPaymentStatus: string | null;
  totalAmount: number;
  homeDeliveryFee: number;
  /** Todos los add-ons de la reserva, incluido éste. */
  siblings: SiblingAddon[];
}

export type CommissionFlag =
  /** La variante trae corte/deslanado y nadie capturó su precio. */
  | "EXTRAS_SIN_PRECIO"
  /**
   * El corte/deslanado se metió en el precio del baño (total manual de la
   * cita, o el «bano_precio» de la web en una estancia). Lo que pasa del
   * precio de lista se separa como `extrasIncluded` y lleva el % de extras.
   */
  | "EXTRAS_EN_TOTAL"
  /** Regalado: se paga igual, sobre el precio normal. */
  | "CORTESIA"
  /** Se cobró menos que la lista: se paga igual, sobre el precio normal. */
  | "DESCUENTO"
  /** Cita suelta hecha pero aún sin liquidar (cuenta igual en su semana). */
  | "POR_COBRAR";

export interface CommissionBathRow {
  addonId: string;
  reservationId: string;
  reservationType: ReservationType;
  completedAt: string;
  petName: string;
  ownerName: string;
  base: number;
  corte: number;
  deslanado: number;
  /** Corte/deslanado que venía dentro del precio del baño (ver EXTRAS_EN_TOTAL). */
  extrasIncluded: number;
  commission: number;
  flags: CommissionFlag[];
}

export interface CommissionRates {
  basePct: number;
  extrasPct: number;
}

/**
 * Lo que se le cobró al cliente por este baño, sin extras capturados aparte
 * ni domicilio. Solo sirve para detectar descuento o corte metido en el
 * precio: la comisión va sobre la lista (ver el encabezado).
 */
export function bathCharged(b: CommissionBathInput): number {
  if (b.isCourtesy) return 0;
  if (b.reservationType !== "BATH") return b.unitPrice;
  // En una cita suelta, el total pactado es de UN baño. Si la reserva trae
  // otro baño cobrable (raro) o algún otro add-on, ésos se quedan con su
  // unitPrice y el primer baño cobrable se lleva el resto.
  const chargeable = b.siblings.filter((s) => !s.isCourtesy);
  const primary = chargeable.find((s) => s.isBath);
  if (primary && primary.id !== b.addonId) return b.unitPrice;
  const others = chargeable
    .filter((s) => s.id !== b.addonId)
    .reduce((sum, s) => sum + s.unitPrice, 0);
  return Math.max(0, b.totalAmount - b.homeDeliveryFee - others);
}

export function commissionRow(b: CommissionBathInput, rates: CommissionRates): CommissionBathRow {
  const base = b.variantPrice;
  const charged = bathCharged(b);
  const corte = b.extraCortePrice ?? 0;
  const deslanado = b.extraDeslanadoPrice ?? 0;
  const flags: CommissionFlag[] = [];
  if (b.isCourtesy) flags.push("CORTESIA");
  const sinPrecio =
    (b.variantCorte && b.extraCortePrice == null) ||
    (b.variantDeslanado && b.extraDeslanadoPrice == null);
  // Lo cobrado por encima de la lista es corte/deslanado metido en el precio
  // SOLO si la variante los lleva y nadie los capturó: sin eso es un ajuste
  // de precio, y la comisión se queda en la lista.
  const inTotal = sinPrecio && !b.isCourtesy && charged > base + 0.01;
  const extrasIncluded = inTotal ? charged - base : 0;
  if (sinPrecio) flags.push(inTotal ? "EXTRAS_EN_TOTAL" : "EXTRAS_SIN_PRECIO");
  // Con corte metido y además descuento, no se puede separar uno del otro:
  // basta con el aviso del corte.
  if (!b.isCourtesy && !inTotal && charged < base - 0.01) flags.push("DESCUENTO");
  if (b.reservationType === "BATH" && b.reservationStatus !== "CHECKED_OUT") {
    flags.push("POR_COBRAR");
  }
  return {
    addonId: b.addonId,
    reservationId: b.reservationId,
    reservationType: b.reservationType,
    completedAt: b.completedAt.toISOString(),
    petName: b.petName,
    ownerName: b.ownerName,
    base: round2(base),
    corte: round2(corte),
    deslanado: round2(deslanado),
    extrasIncluded: round2(extrasIncluded),
    commission: round2(base * rates.basePct + (corte + deslanado + extrasIncluded) * rates.extrasPct),
    flags,
  };
}

export interface CommissionTotals {
  baths: CommissionBathRow[];
  count: number;
  baseTotal: number;
  extrasTotal: number;
  commission: number;
}

/**
 * Todos los baños de la semana, en orden. Hoy baña solo Nancy (confirmado por
 * José), así que no se separa por persona: el equipo marca los baños desde
 * varias cuentas (la tablet compartida, Jessica, José) y quién apretó el botón
 * no dice quién bañó.
 */
export function weekTotals(baths: CommissionBathInput[], rates: CommissionRates): CommissionTotals {
  const rows = [...baths]
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime())
    .map((b) => commissionRow(b, rates));
  return {
    baths: rows,
    count: rows.length,
    baseTotal: round2(rows.reduce((n, r) => n + r.base, 0)),
    extrasTotal: round2(rows.reduce((n, r) => n + r.corte + r.deslanado + r.extrasIncluded, 0)),
    commission: round2(rows.reduce((n, r) => n + r.commission, 0)),
  };
}

export interface PendingBath {
  reservationId: string;
  petName: string;
  /** Hora de la cita (ISO). */
  scheduledAt: string;
}

export interface BathCommissionReport extends HotelWeek, CommissionTotals {
  rates: CommissionRates;
  /** Citas de la semana cuya hora ya pasó y nadie marcó como listas. */
  pending: PendingBath[];
}

const fullName = (u: { firstName: string; lastName: string }) =>
  `${u.firstName} ${u.lastName}`.trim();

export async function loadBathCommissionReport(
  prisma: PrismaClient,
  weekStart: string | undefined,
  now: Date = new Date(),
): Promise<BathCommissionReport> {
  const week = hotelWeek(weekStart, now);
  const config = await prisma.bathConfig.findUnique({ where: { id: "singleton" } });
  const rates: CommissionRates = {
    basePct: Number(config?.groomerCommissionPct ?? 0),
    extrasPct: Number(config?.groomerExtrasCommissionPct ?? 0),
  };

  const bathOnly = { variant: { serviceType: { code: "BATH" } } } as const;

  const done = await prisma.reservationAddon.findMany({
    where: {
      ...bathOnly,
      completedAt: { gte: week.from, lt: week.to },
      reservation: { status: { not: "CANCELLED" } },
    },
    include: {
      variant: { select: { corte: true, deslanado: true, price: true } },
      reservation: {
        select: {
          id: true,
          reservationType: true,
          status: true,
          totalAmount: true,
          homeDeliveryFee: true,
          pet: { select: { name: true } },
          owner: { select: { firstName: true, lastName: true } },
          addons: {
            select: {
              id: true,
              unitPrice: true,
              isCourtesy: true,
              variant: { select: { serviceType: { select: { code: true } } } },
            },
          },
        },
      },
    },
  });

  const inputs: CommissionBathInput[] = done.map((a) => ({
    addonId: a.id,
    reservationId: a.reservation.id,
    reservationType: a.reservation.reservationType,
    reservationStatus: a.reservation.status,
    completedAt: a.completedAt!,
    petName: a.reservation.pet.name,
    ownerName: fullName(a.reservation.owner),
    unitPrice: Number(a.unitPrice),
    isCourtesy: a.isCourtesy,
    variantCorte: a.variant.corte,
    variantDeslanado: a.variant.deslanado,
    variantPrice: Number(a.variant.price),
    extraCortePrice: a.extraCortePrice == null ? null : Number(a.extraCortePrice),
    extraDeslanadoPrice: a.extraDeslanadoPrice == null ? null : Number(a.extraDeslanadoPrice),
    extraPaymentStatus: a.extraPaymentStatus,
    totalAmount: Number(a.reservation.totalAmount),
    homeDeliveryFee: Number(a.reservation.homeDeliveryFee ?? 0),
    siblings: a.reservation.addons.map((s) => ({
      id: s.id,
      unitPrice: Number(s.unitPrice),
      isCourtesy: s.isCourtesy,
      isBath: s.variant.serviceType.code === "BATH",
    })),
  }));

  // Pendientes: solo lo que YA debió hacerse. Una cita del jueves vista el
  // martes no es un olvido.
  const pendingTo = now < week.to ? now : week.to;
  const pending: PendingBath[] = [];
  if (pendingTo > week.from) {
    const [sueltas, hospedados] = await Promise.all([
      prisma.reservation.findMany({
        where: {
          reservationType: "BATH",
          status: { not: "CANCELLED" },
          appointmentAt: { gte: week.from, lt: pendingTo },
          addons: { none: { completedAt: { not: null } } },
        },
        select: { id: true, appointmentAt: true, pet: { select: { name: true } } },
      }),
      prisma.reservationAddon.findMany({
        where: {
          ...bathOnly,
          completedAt: null,
          scheduledAt: { gte: week.from, lt: pendingTo },
          reservation: { status: { not: "CANCELLED" } },
        },
        select: {
          scheduledAt: true,
          reservation: { select: { id: true, pet: { select: { name: true } } } },
        },
      }),
    ]);
    for (const r of sueltas) {
      pending.push({ reservationId: r.id, petName: r.pet.name, scheduledAt: r.appointmentAt!.toISOString() });
    }
    for (const a of hospedados) {
      pending.push({
        reservationId: a.reservation.id,
        petName: a.reservation.pet.name,
        scheduledAt: a.scheduledAt!.toISOString(),
      });
    }
    pending.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }

  return { ...week, rates, ...weekTotals(inputs, rates), pending };
}
