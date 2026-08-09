/**
 * Lado con base de datos del motor de agenda de estética.
 *
 * La aritmética (rejilla, traslapes, veredictos) vive en `bathAvailability`.
 * Aquí solo se cargan los datos que necesita: la configuración, las citas ya
 * agendadas del día y la duración que corresponde a un servicio.
 */

import { Prisma, PetSize } from "@holidoginn/db";
import type { PrismaClient } from "@prisma/client";
import { sizeFromWeight, bathSizeKey } from "./pricing";
import {
  BathScheduleCfg,
  BusyInterval,
  MAX_BATH_DURATION_MIN,
  SlotReason,
  buildStartCandidates,
  dayRangeUtc,
  endOf,
  evaluateStart,
  isValidDateYMD,
} from "./bathAvailability";

type Db = PrismaClient | Prisma.TransactionClient;

const BATH_CONFIG_ID = "singleton";

/** Fila cruda de `bath_config` (la que devuelven los endpoints de config). */
export type BathConfigRow = {
  id: string;
  openHour: number;
  closeHour: number;
  slotMinutes: number;
  maxConcurrentBaths: number;
  isActive: boolean;
  slotStepMinutes: number;
  defaultBathDurationMinutes: number;
  lastStartHour: number | null;
  bufferMinutes: number;
  updatedAt: Date;
};

export async function ensureConfig(prisma: Db): Promise<BathConfigRow> {
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
      slotStepMinutes: 30,
      defaultBathDurationMinutes: 60,
      bufferMinutes: 0,
    },
  });
}

/** Fila de configuración → la vista que consume el motor. */
export function toScheduleCfg(row: BathConfigRow): BathScheduleCfg {
  return {
    openHour: row.openHour,
    closeHour: row.closeHour,
    slotStepMinutes: row.slotStepMinutes || 30,
    // `slotMinutes` es la duración única que usaba la agenda vieja; sigue
    // sirviendo de respaldo si nadie ha configurado la nueva.
    defaultBathDurationMinutes: row.defaultBathDurationMinutes || row.slotMinutes || 60,
    lastStartHour: row.lastStartHour,
    bufferMinutes: row.bufferMinutes ?? 0,
    maxConcurrentBaths: row.maxConcurrentBaths || 1,
    isActive: row.isActive,
  };
}

export async function loadScheduleCfg(prisma: Db): Promise<BathScheduleCfg> {
  return toScheduleCfg(await ensureConfig(prisma));
}

// ────────────────────────────────────────────────────────────────────────────
//  Duración de un servicio
// ────────────────────────────────────────────────────────────────────────────

export type DurationQuery = {
  variantId?: string | null;
  petId?: string | null;
  petSize?: PetSize | null;
  deslanado?: boolean;
  corte?: boolean;
};

/** Los campos de la variante que necesita el cálculo de duración. */
const VARIANT_FOR_DURATION = {
  id: true,
  serviceTypeId: true,
  petSize: true,
  deslanado: true,
  corte: true,
  durationMinutes: true,
} as const;

type VariantForDuration = {
  id: string;
  serviceTypeId: string;
  petSize: PetSize;
  deslanado: boolean;
  corte: boolean;
  durationMinutes: number | null;
};

/**
 * Cuánto suma la tabla por los extras de esa variante, respecto al baño solo de
 * la misma talla. Es lo que se le añade a la duración propia de un perro: su
 * excepción dice cuánto tarda BAÑARSE, y el corte sigue costando lo que cuesta.
 */
async function extrasDelta(prisma: Db, variant: VariantForDuration): Promise<number> {
  if (!variant.corte && !variant.deslanado) return 0;
  if (variant.durationMinutes == null) return 0;
  const base = await prisma.serviceVariant.findUnique({
    where: {
      serviceTypeId_petSize_deslanado_corte: {
        serviceTypeId: variant.serviceTypeId,
        petSize: variant.petSize,
        deslanado: false,
        corte: false,
      },
    },
    select: { durationMinutes: true },
  });
  if (base?.durationMinutes == null) return 0;
  return Math.max(0, variant.durationMinutes - base.durationMinutes);
}

/**
 * Cuántos minutos toma un servicio. Precedencia: duración propia de la mascota
 * (+ los extras de la tabla) → variante explícita → talla derivada del peso →
 * talla recibida → respaldo de configuración.
 *
 * La excepción por perro (`pets.groomingMinutes`) existe porque la tabla es un
 * promedio por talla y hay perros que no se parecen a su talla: el que no se
 * deja, el de pelo enredado, el que ya se conoce y sale en la mitad. Cuando el
 * equipo la anota, manda.
 *
 * `resolved: false` avisa a quien llama que la duración es un respaldo y no un
 * dato real, para que el cliente pueda decirlo en pantalla en lugar de mostrar
 * un número inventado con aire de certeza.
 */
export async function resolveBathDuration(
  prisma: Db,
  q: DurationQuery,
  cfg: BathScheduleCfg
): Promise<{ durationMinutes: number; variantId: string | null; resolved: boolean }> {
  const fallback = {
    durationMinutes: cfg.defaultBathDurationMinutes,
    variantId: null,
    resolved: false,
  };

  const pet = q.petId
    ? await prisma.pet.findUnique({
        where: { id: q.petId },
        select: { weight: true, groomingMinutes: true },
      })
    : null;
  const propia = pet?.groomingMinutes ?? null;

  let variant: VariantForDuration | null = null;

  if (q.variantId) {
    variant = await prisma.serviceVariant.findUnique({
      where: { id: q.variantId },
      select: VARIANT_FOR_DURATION,
    });
  } else {
    let petSize = q.petSize ?? null;
    // Sin peso registrado no hay talla que derivar: mejor el respaldo que una
    // talla inventada que produciría una duración equivocada.
    if (!petSize && pet?.weight != null) {
      petSize = bathSizeKey(sizeFromWeight(pet.weight));
    }
    if (petSize) {
      const bath = await prisma.serviceType.findUnique({
        where: { code: "BATH" },
        select: { id: true },
      });
      if (bath) {
        variant = await prisma.serviceVariant.findUnique({
          where: {
            serviceTypeId_petSize_deslanado_corte: {
              serviceTypeId: bath.id,
              petSize,
              deslanado: q.deslanado ?? false,
              corte: q.corte ?? false,
            },
          },
          select: VARIANT_FOR_DURATION,
        });
      }
    }
  }

  // Sin variante no hay tabla que aplicar, pero la excepción del perro sigue
  // siendo mejor dato que el respaldo genérico.
  if (!variant) {
    return propia != null
      ? { durationMinutes: propia, variantId: null, resolved: true }
      : fallback;
  }

  if (propia == null) {
    return {
      durationMinutes: variant.durationMinutes ?? cfg.defaultBathDurationMinutes,
      variantId: variant.id,
      resolved: variant.durationMinutes != null,
    };
  }

  return {
    durationMinutes: propia + (await extrasDelta(prisma, variant)),
    variantId: variant.id,
    resolved: true,
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  Ocupación del día
// ────────────────────────────────────────────────────────────────────────────

export type BusyQueryOpts = {
  /** Al editar una cita, para que no choque consigo misma. */
  excludeReservationIds?: string[];
  /** Al reagendar un grupo multi-mascota completo. */
  excludeGroupId?: string | null;
};

/**
 * Las citas de estética que ocupan la agenda de un día, como intervalos.
 *
 * Son DOS fuentes, porque el trabajo de la estilista llega por dos caminos:
 *   · citas sueltas  → `reservations` de tipo BATH, con su `appointmentAt`
 *   · perros hospedados que salen con baño → addon BATH con `scheduledAt`
 *
 * La ventana se ensancha hacia atrás por `MAX_BATH_DURATION_MIN`: una cita que
 * empezó antes de abrir el día siguiente no existe, pero una que arrancó a las
 * 8:30 con dos horas por delante sí pisa el primer hueco de la mañana.
 */
export async function loadBusyIntervals(
  prisma: Db,
  dateYMD: string,
  cfg: BathScheduleCfg,
  opts: BusyQueryOpts = {}
): Promise<BusyInterval[]> {
  if (!isValidDateYMD(dateYMD)) return [];
  const { start, end } = dayRangeUtc(dateYMD);
  const lookback = new Date(start.getTime() - MAX_BATH_DURATION_MIN * 60_000);

  const excludeIds = opts.excludeReservationIds?.filter(Boolean) ?? [];
  const notCancelled = { status: { not: "CANCELLED" as const } };
  const excludeReservation = {
    ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    ...(opts.excludeGroupId ? { NOT: { groupId: opts.excludeGroupId } } : {}),
  };

  const [citas, addons] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        reservationType: "BATH",
        ...notCancelled,
        appointmentAt: { gte: lookback, lt: end },
        ...excludeReservation,
      },
      select: {
        id: true,
        appointmentAt: true,
        durationMinutes: true,
        pet: { select: { name: true } },
        // Respaldo de duración para citas anteriores al snapshot: se toma de la
        // variante contratada en su momento.
        addons: {
          where: { variant: { serviceType: { code: "BATH" } } },
          select: { variant: { select: { durationMinutes: true } } },
          take: 1,
        },
      },
    }),
    prisma.reservationAddon.findMany({
      where: {
        scheduledAt: { gte: lookback, lt: end },
        variant: { serviceType: { code: "BATH" } },
        reservation: {
          ...notCancelled,
          ...excludeReservation,
        },
      },
      select: {
        id: true,
        scheduledAt: true,
        durationMinutes: true,
        variant: { select: { durationMinutes: true } },
        reservation: { select: { pet: { select: { name: true } } } },
      },
    }),
  ]);

  const busy: BusyInterval[] = [];

  for (const r of citas) {
    if (!r.appointmentAt) continue;
    const dur =
      r.durationMinutes ??
      r.addons[0]?.variant.durationMinutes ??
      cfg.defaultBathDurationMinutes;
    const startMs = r.appointmentAt.getTime();
    const endMs = startMs + dur * 60_000;
    // Descarta lo que terminó antes de que empiece el día (el lookback trae de
    // más a propósito).
    if (endMs <= start.getTime()) continue;
    busy.push({ startMs, endMs, id: r.id, label: r.pet?.name ?? "otra cita" });
  }

  for (const a of addons) {
    if (!a.scheduledAt) continue;
    const dur =
      a.durationMinutes ?? a.variant.durationMinutes ?? cfg.defaultBathDurationMinutes;
    const startMs = a.scheduledAt.getTime();
    const endMs = startMs + dur * 60_000;
    if (endMs <= start.getTime()) continue;
    busy.push({
      startMs,
      endMs,
      id: a.id,
      label: a.reservation?.pet?.name ?? "baño de hospedaje",
    });
  }

  return busy.sort((x, y) => x.startMs - y.startMs);
}

// ────────────────────────────────────────────────────────────────────────────
//  Payload de horarios para los clientes
// ────────────────────────────────────────────────────────────────────────────

export type SlotDto = {
  startUtc: string;
  /** Nuevo: a qué hora terminaría, para poder decirlo en pantalla. */
  endUtc: string;
  available: boolean;
  remaining: number;
  inPast: boolean;
  /** Nuevo: por qué no está disponible, para dar un motivo en vez de un hueco. */
  reason?: SlotReason;
};

export type SlotsPayload = {
  config: BathConfigRow;
  /** Duración con la que se calcularon estos horarios. */
  durationMinutes: number;
  /**
   * `false` = no se pudo resolver la variante y se usó el respaldo. Los
   * clientes que no mandan el servicio (builds anteriores a esta agenda)
   * reciben siempre `false` y la misma rejilla de antes.
   */
  durationResolved: boolean;
  slots: SlotDto[];
};

/**
 * Los horarios de un día para un servicio concreto.
 *
 * Compartido por `/baths/slots` (autenticado) y `/guest/baths/slots` (público)
 * para que el cliente y el invitado nunca vean disponibilidades distintas.
 */
export async function buildSlotsPayload(
  prisma: Db,
  dateYMD: string,
  q: DurationQuery & BusyQueryOpts = {},
  now: Date = new Date()
): Promise<SlotsPayload> {
  const config = await ensureConfig(prisma);
  const cfg = toScheduleCfg(config);

  const { durationMinutes, resolved } = await resolveBathDuration(prisma, q, cfg);
  if (!cfg.isActive) {
    return { config, durationMinutes, durationResolved: resolved, slots: [] };
  }

  const [candidates, busy] = await Promise.all([
    Promise.resolve(buildStartCandidates(dateYMD, cfg, durationMinutes)),
    loadBusyIntervals(prisma, dateYMD, cfg, q),
  ]);

  const slots: SlotDto[] = candidates.map((start) => {
    const verdict = evaluateStart(start, durationMinutes, cfg, busy, now);
    const taken = verdict.ok ? 0 : verdict.conflicts.length;
    return {
      startUtc: start.toISOString(),
      endUtc: endOf(start, durationMinutes).toISOString(),
      available: verdict.ok,
      remaining: Math.max(0, cfg.maxConcurrentBaths - taken),
      inPast: start.getTime() <= now.getTime(),
      ...(verdict.ok ? {} : { reason: verdict.reason }),
    };
  });

  return { config, durationMinutes, durationResolved: resolved, slots };
}
