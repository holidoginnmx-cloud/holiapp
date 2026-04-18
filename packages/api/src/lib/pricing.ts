export const PRICE_PER_DAY_SMALL = 350;
export const PRICE_PER_DAY_LARGE = 450;
export const LARGE_WEIGHT_KG = 20;
export const MEDICATION_SURCHARGE_PCT = 0.10;

export function computeDays(checkIn: Date, checkOut: Date): number {
  return Math.ceil(
    (checkOut.getTime() - checkIn.getTime()) / 86_400_000
  );
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
