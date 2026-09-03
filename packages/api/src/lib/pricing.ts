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
  ceilMoney,
} from "@holidoginn/shared";

// Re-exporta las funciones/constantes puras de pricing desde el paquete
// compartido (FUENTE ÚNICA). Las rutas siguen importándolas desde
// "../lib/pricing" sin cambios, pero la lógica vive una sola vez en shared.
export {
  sizeFromWeight,
  bathSizeKey,
  dewormSizeFromWeight,
  computeDays,
  pricePerDayForWeight,
  DEFAULT_PRICE_PER_DAY_SMALL,
  DEFAULT_PRICE_PER_DAY_LARGE,
  DEFAULT_LARGE_WEIGHT_KG,
  DEFAULT_MEDICATION_SURCHARGE_PCT,
  DEFAULT_DAYCARE_HOUR_PRICE,
  DAYCARE_OPEN_HOUR,
  DAYCARE_CLOSE_HOUR,
  DAYCARE_LATE_TOLERANCE_MIN,
  DAYCARE_MIN_HOURS,
  minutesFromHHmm,
  computeDaycareHours,
  computeDaycareExtraHours,
  isWithinDaycareHours,
  // Hospedaje: UNA fórmula por mascota (ver packages/shared/src/pricing.ts).
  SAME_DAY_SURCHARGE_PCT,
  SIZE_RANGES_KG,
  sizeRangeLabel,
  ceilMoney,
  roundMoney,
  computeStayPricing,
  allocateProportional,
} from "@holidoginn/shared";
export type {
  LodgingPricingConfig,
  StayPricing,
  StayPricingConfig,
  StayPricingInput,
} from "@holidoginn/shared";

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
    // Tarifa única por hora de guardería/horas extra. La columna conserva el
    // nombre histórico daycareExtraHourPrice (migración web 0019).
    daycareHourPrice: Number(row.daycareExtraHourPrice),
  };
}

interface ChangeTotalInput {
  petWeightKg: number | null;
  /** Fechas actuales de la reserva (para calcular el hospedaje que ya paga). */
  currentCheckIn: Date;
  currentCheckOut: Date;
  newCheckIn: Date;
  newCheckOut: Date;
  hasMedication: boolean;
  /** Total actual de la reserva (con domicilio, descuento, add-ons, recargos). */
  currentTotal: number;
  /**
   * Hospedaje y recargo de medicamento persistidos al crear (foto original).
   * Si vienen, se usan como "lo que ya paga" en vez de recalcular con la
   * tarifa de hoy, para que un cambio de tarifa no se cuele en el delta.
   */
  currentLodgingAmount?: number | null;
  currentMedicationFee?: number | null;
  config?: LodgingPricingConfig;
}

export interface ChangeTotalResult {
  newTotalDays: number;
  newLodging: number;
  newMedicationSurcharge: number;
  newTotal: number;
  delta: number;
}

/**
 * Nuevo total de un hospedaje cuando cambian las fechas: se calcula POR
 * DELTA sobre el total actual (igual que el flujo del admin en
 * `buildAdminDatesChange`). Solo cambian el hospedaje (tarifa × noches) y su
 * recargo por medicamento; el domicilio, el descuento, el recargo de mismo
 * día y los add-ons (incluidos los de cortesía, que nunca sumaron) se quedan
 * exactamente como están.
 *
 * Antes se recalculaba desde cero sumando TODOS los add-ons y omitiendo
 * domicilio/descuento: extender 2→3 noches con $260 de domicilio daba un
 * delta de +$90 en vez de +$350.
 */
export function computeChangeTotal({
  petWeightKg,
  currentCheckIn,
  currentCheckOut,
  newCheckIn,
  newCheckOut,
  hasMedication,
  currentTotal,
  currentLodgingAmount,
  currentMedicationFee,
  config = DEFAULT_LODGING_PRICING,
}: ChangeTotalInput): ChangeTotalResult {
  const pricePerDay = pricePerDayForWeight(petWeightKg, config);
  // Mismo redondeo que computeStayPricing: hacia arriba a peso entero.
  const medFor = (lodging: number) =>
    hasMedication ? ceilMoney(lodging * config.medicationSurchargePct) : 0;

  const currentDays = computeDays(currentCheckIn, currentCheckOut);
  const currentLodging =
    currentLodgingAmount != null && currentLodgingAmount > 0
      ? currentLodgingAmount
      : pricePerDay * currentDays;
  const currentMed =
    currentMedicationFee != null && currentMedicationFee > 0
      ? currentMedicationFee
      : medFor(currentLodging);

  const newTotalDays = computeDays(newCheckIn, newCheckOut);
  const newLodging = pricePerDay * newTotalDays;
  const newMedicationSurcharge = medFor(newLodging);

  const delta = Number(
    (newLodging - currentLodging + (newMedicationSurcharge - currentMed)).toFixed(2),
  );
  const newTotal = Math.max(0, Number((currentTotal + delta).toFixed(2)));
  return {
    newTotalDays,
    newLodging,
    newMedicationSurcharge,
    newTotal,
    delta: Number((newTotal - currentTotal).toFixed(2)),
  };
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
