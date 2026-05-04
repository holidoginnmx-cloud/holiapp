export const PRICE_PER_DAY_SMALL = 350;
export const PRICE_PER_DAY_LARGE = 450;
export const LARGE_WEIGHT_KG = 20;
export const MEDICATION_SURCHARGE_PCT = 0.10;

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

export function pricePerDayForWeight(weightKg: number | null): number {
  return weightKg && weightKg >= LARGE_WEIGHT_KG
    ? PRICE_PER_DAY_LARGE
    : PRICE_PER_DAY_SMALL;
}

interface ChangeTotalInput {
  petWeightKg: number | null;
  newCheckIn: Date;
  newCheckOut: Date;
  hasMedication: boolean;
  existingBathTotal: number;
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
}: ChangeTotalInput): ChangeTotalResult {
  const newTotalDays = computeDays(newCheckIn, newCheckOut);
  const pricePerDay = pricePerDayForWeight(petWeightKg);
  const newLodging = pricePerDay * newTotalDays;
  const newMedicationSurcharge = hasMedication
    ? Math.ceil(newLodging * MEDICATION_SURCHARGE_PCT)
    : 0;
  const newTotal = newLodging + newMedicationSurcharge + existingBathTotal;
  return { newTotalDays, newLodging, newMedicationSurcharge, newTotal };
}
