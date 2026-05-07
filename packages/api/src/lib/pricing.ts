import type { PrismaClient } from "@prisma/client";

// Defaults — usados si la fila singleton aún no existe (DB recién creada,
// pruebas, etc.). Mantienen el comportamiento histórico.
export const DEFAULT_PRICE_PER_DAY_SMALL = 350;
export const DEFAULT_PRICE_PER_DAY_LARGE = 450;
export const DEFAULT_LARGE_WEIGHT_KG = 20;
export const DEFAULT_MEDICATION_SURCHARGE_PCT = 0.10;

export interface LodgingPricingConfig {
  pricePerDaySmall: number;
  pricePerDayLarge: number;
  largeWeightKg: number;
  medicationSurchargePct: number;
}

const DEFAULT_CONFIG: LodgingPricingConfig = {
  pricePerDaySmall: DEFAULT_PRICE_PER_DAY_SMALL,
  pricePerDayLarge: DEFAULT_PRICE_PER_DAY_LARGE,
  largeWeightKg: DEFAULT_LARGE_WEIGHT_KG,
  medicationSurchargePct: DEFAULT_MEDICATION_SURCHARGE_PCT,
};

/**
 * Lee la configuración de tarifas de hospedaje (singleton). Si la fila no
 * existe la crea con defaults — así el cálculo nunca falla por config faltante.
 */
export async function getLodgingPricing(
  prisma: PrismaClient
): Promise<LodgingPricingConfig> {
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
  };
}

/**
 * Number of nights between two dates, counted as calendar-day delta in UTC.
 *
 * Why: callers may pass dates with different times of day (e.g. when a client
 * sends `new Date()` rather than UTC midnight) and a raw ms diff with `Math.ceil`
 * over-counts when checkOut > checkIn by less than a full 24h. Anchoring both
 * to their UTC date components yields exact integer days regardless of TZ.
 */
export function computeDays(checkIn: Date, checkOut: Date): number {
  const ciUTC = Date.UTC(
    checkIn.getUTCFullYear(),
    checkIn.getUTCMonth(),
    checkIn.getUTCDate(),
  );
  const coUTC = Date.UTC(
    checkOut.getUTCFullYear(),
    checkOut.getUTCMonth(),
    checkOut.getUTCDate(),
  );
  return Math.round((coUTC - ciUTC) / 86_400_000);
}

export function pricePerDayForWeight(
  weightKg: number | null,
  config: LodgingPricingConfig = DEFAULT_CONFIG
): number {
  return weightKg && weightKg >= config.largeWeightKg
    ? config.pricePerDayLarge
    : config.pricePerDaySmall;
}

interface ChangeTotalInput {
  petWeightKg: number | null;
  newCheckIn: Date;
  newCheckOut: Date;
  hasMedication: boolean;
  existingBathTotal: number;
  config?: LodgingPricingConfig;
}

export interface ChangeTotalResult {
  newTotalDays: number;
  newLodging: number;
  newMedicationSurcharge: number;
  newTotal: number;
}

/**
 * Recompute the total for a single-pet reservation when dates change.
 * Bath addons are preserved (flat per-stay) and medication surcharge
 * is re-applied proportionally to new lodging. Same-day surcharge is
 * never re-applied on changes.
 */
export function computeChangeTotal({
  petWeightKg,
  newCheckIn,
  newCheckOut,
  hasMedication,
  existingBathTotal,
  config = DEFAULT_CONFIG,
}: ChangeTotalInput): ChangeTotalResult {
  const newTotalDays = computeDays(newCheckIn, newCheckOut);
  const pricePerDay = pricePerDayForWeight(petWeightKg, config);
  const newLodging = pricePerDay * newTotalDays;
  const newMedicationSurcharge = hasMedication
    ? Math.ceil(newLodging * config.medicationSurchargePct)
    : 0;
  const newTotal = newLodging + newMedicationSurcharge + existingBathTotal;
  return { newTotalDays, newLodging, newMedicationSurcharge, newTotal };
}

// Backwards-compatible exports for callers que aún no usan config dinámica.
// Marcadas como deprecated para fomentar la migración a getLodgingPricing.
/** @deprecated Use getLodgingPricing(prisma) for the editable value. */
export const PRICE_PER_DAY_SMALL = DEFAULT_PRICE_PER_DAY_SMALL;
/** @deprecated Use getLodgingPricing(prisma) for the editable value. */
export const PRICE_PER_DAY_LARGE = DEFAULT_PRICE_PER_DAY_LARGE;
/** @deprecated Use getLodgingPricing(prisma) for the editable value. */
export const LARGE_WEIGHT_KG = DEFAULT_LARGE_WEIGHT_KG;
/** @deprecated Use getLodgingPricing(prisma) for the editable value. */
export const MEDICATION_SURCHARGE_PCT = DEFAULT_MEDICATION_SURCHARGE_PCT;
