import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_LODGING_PRICING,
  DEFAULT_PRICE_PER_DAY_SMALL,
  DEFAULT_PRICE_PER_DAY_LARGE,
  DEFAULT_LARGE_WEIGHT_KG,
  DEFAULT_MEDICATION_SURCHARGE_PCT,
  type LodgingPricingConfig,
  computeDays,
  pricePerDayForWeight,
} from "@holidoginn/shared";

// Re-exporta las funciones/constantes puras de pricing desde el paquete
// compartido (FUENTE ÚNICA). Las rutas siguen importándolas desde
// "../lib/pricing" sin cambios, pero la lógica vive una sola vez en shared.
export {
  sizeFromWeight,
  bathSizeKey,
  computeDays,
  pricePerDayForWeight,
  DEFAULT_PRICE_PER_DAY_SMALL,
  DEFAULT_PRICE_PER_DAY_LARGE,
  DEFAULT_LARGE_WEIGHT_KG,
  DEFAULT_MEDICATION_SURCHARGE_PCT,
} from "@holidoginn/shared";
export type { LodgingPricingConfig } from "@holidoginn/shared";

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
  config = DEFAULT_LODGING_PRICING,
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
