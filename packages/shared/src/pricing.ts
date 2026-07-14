// ============================================================
// Pricing & sizing — FUENTE ÚNICA compartida por mobile y api.
//
// Este módulo NO importa zod a propósito: así la app móvil puede importar
// estas funciones puras sin arrastrar zod ni los esquemas al bundle.
// No redefinir estas funciones en rutas ni pantallas: importarlas de aquí.
// ============================================================

/** Tallas facturables (XS colapsa a S, por eso no aparece como salida). */
export type SizeKey = "S" | "M" | "L" | "XL";

/**
 * Tamaño canónico a partir del peso (kg). El bucket más pequeño por peso es S
 * (XS no se infiere por peso). Misma tabla en toda la app.
 */
export function sizeFromWeight(kg: number | null | undefined): SizeKey {
  const w = kg ?? 0;
  if (w <= 5) return "S";
  if (w <= 15) return "M";
  if (w <= 24) return "L";
  return "XL";
}

/** Las variantes de baño se catalogan por S/M/L/XL — XS colapsa a S. */
export function bathSizeKey(size: "XS" | SizeKey): SizeKey {
  return size === "XS" ? "S" : size;
}

/**
 * Número de noches entre dos fechas: delta de días-calendario en UTC.
 * Anclar a los componentes UTC evita el sobre-conteo de un `Math.ceil` sobre
 * milisegundos cuando las horas-del-día difieren. DEBE coincidir
 * cliente↔servidor para que el estimado y el cargo no diverjan.
 */
export function computeDays(checkIn: Date, checkOut: Date): number {
  const ci = Date.UTC(
    checkIn.getUTCFullYear(),
    checkIn.getUTCMonth(),
    checkIn.getUTCDate()
  );
  const co = Date.UTC(
    checkOut.getUTCFullYear(),
    checkOut.getUTCMonth(),
    checkOut.getUTCDate()
  );
  return Math.round((co - ci) / 86_400_000);
}

// Tarifas de hospedaje por defecto. La fila singleton editable por admin
// (LodgingPricing) toma precedencia en el backend; estas constantes son el
// fallback del servidor y la base del estimado del cliente.
export const DEFAULT_PRICE_PER_DAY_SMALL = 350;
export const DEFAULT_PRICE_PER_DAY_LARGE = 450;
export const DEFAULT_LARGE_WEIGHT_KG = 20;
export const DEFAULT_MEDICATION_SURCHARGE_PCT = 0.1;
export const DEFAULT_DAYCARE_HOUR_PRICE = 25;

export interface LodgingPricingConfig {
  pricePerDaySmall: number;
  pricePerDayLarge: number;
  largeWeightKg: number;
  medicationSurchargePct: number;
  // Tarifa ÚNICA por hora de guardería (y de horas extra al exceder check-out).
  daycareHourPrice: number;
}

export const DEFAULT_LODGING_PRICING: LodgingPricingConfig = {
  pricePerDaySmall: DEFAULT_PRICE_PER_DAY_SMALL,
  pricePerDayLarge: DEFAULT_PRICE_PER_DAY_LARGE,
  largeWeightKg: DEFAULT_LARGE_WEIGHT_KG,
  medicationSurchargePct: DEFAULT_MEDICATION_SURCHARGE_PCT,
  daycareHourPrice: DEFAULT_DAYCARE_HOUR_PRICE,
};

/** Precio por noche según peso (umbral de "grande" configurable). */
export function pricePerDayForWeight(
  weightKg: number | null | undefined,
  config: LodgingPricingConfig = DEFAULT_LODGING_PRICING
): number {
  return weightKg && weightKg >= config.largeWeightKg
    ? config.pricePerDayLarge
    : config.pricePerDaySmall;
}

// ============================================================
// Guardería (DAYCARE) — servicio de día cobrado por hora.
// Reserva de UN día con entrada/salida estimadas ("HH:mm"); el precio es
// horas × tarifa única (daycareHourPrice), por perro. Al check-out real, el
// excedente sobre la salida estimada se cobra como add-on EXTRA_HOURS.
// ============================================================

/** Ventana de operación de la guardería (hora local del hotel). */
export const DAYCARE_OPEN_HOUR = 8; // 8:00 am
export const DAYCARE_CLOSE_HOUR = 18; // 6:00 pm
/** Minutos de gracia al recoger antes de cobrar horas extra. */
export const DAYCARE_LATE_TOLERANCE_MIN = 15;
/** Toda guardería se cobra al menos esta cantidad de horas. */
export const DAYCARE_MIN_HOURS = 1;

/** "HH:mm" → minutos desde medianoche. NaN si el formato es inválido. */
export function minutesFromHHmm(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return NaN;
  return hours * 60 + minutes;
}

/**
 * Horas facturables de guardería entre entrada y salida estimadas del mismo
 * día: redondeo hacia ARRIBA a hora completa, mínimo DAYCARE_MIN_HOURS.
 * Devuelve 0 si el rango es inválido (salida ≤ entrada o formato malo) para
 * que el caller lo rechace. DEBE coincidir cliente↔servidor.
 */
export function computeDaycareHours(
  checkInTime: string,
  checkOutTime: string
): number {
  const start = minutesFromHHmm(checkInTime);
  const end = minutesFromHHmm(checkOutTime);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.max(DAYCARE_MIN_HOURS, Math.ceil((end - start) / 60));
}

/**
 * Horas extra al recoger DESPUÉS de la salida estimada: minutos de retraso
 * menos la tolerancia, redondeados hacia arriba a hora completa. 0 si el
 * retraso cae dentro de la tolerancia (o si recogió a tiempo).
 */
export function computeDaycareExtraHours(
  estimatedCheckOutTime: string,
  actualMinutesFromMidnight: number
): number {
  const estimated = minutesFromHHmm(estimatedCheckOutTime);
  if (Number.isNaN(estimated)) return 0;
  const lateMinutes = actualMinutesFromMidnight - estimated;
  if (lateMinutes <= DAYCARE_LATE_TOLERANCE_MIN) return 0;
  return Math.ceil(lateMinutes / 60);
}

/** true si la hora "HH:mm" cae dentro de la ventana de guardería. */
export function isWithinDaycareHours(time: string): boolean {
  const minutes = minutesFromHHmm(time);
  if (Number.isNaN(minutes)) return false;
  return (
    minutes >= DAYCARE_OPEN_HOUR * 60 && minutes <= DAYCARE_CLOSE_HOUR * 60
  );
}
