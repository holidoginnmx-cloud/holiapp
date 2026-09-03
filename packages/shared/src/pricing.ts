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
 * Talla para cotizar el DESPARASITANTE a partir del peso (kg). Escala PROPIA
 * del desparasitante: sus tramos NO coinciden con `sizeFromWeight` (baño) ni
 * con la talla general del perro — no unificar. Mismos tramos que
 * `dewormSizeKey` del admin web (lib/desparasitante.ts, repo aparte).
 * Devuelve null si falta el peso o cae fuera del rango cubierto (3.6–60 kg):
 * en ese caso no hay tarifa y no se debe cotizar.
 */
export function dewormSizeFromWeight(
  kg: number | null | undefined
): SizeKey | null {
  if (kg == null || Number.isNaN(kg)) return null;
  if (kg >= 3.6 && kg <= 7.5) return "S";
  if (kg >= 7.6 && kg <= 15) return "M";
  if (kg >= 15.1 && kg <= 30) return "L";
  if (kg >= 30.1 && kg <= 60) return "XL";
  return null;
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

/**
 * Noches entre dos fechas "YYYY-MM-DD". No construye Date: opera sobre los
 * componentes de la cadena, así que no hay zona horaria que la pueda correr un
 * día. Es la forma que usan las cotizaciones, donde el usuario elige DÍAS y no
 * instantes.
 *
 * Da el mismo número que `computeDays` y que el `Math.ceil(diffMs/86_400_000)`
 * de POST /reservations SIEMPRE QUE ambas fechas vayan ancladas a medianoche
 * UTC. Con horas del día distintas, el `ceil` de la ruta cuenta una noche de
 * más (check-in 09:00 → check-out 18:00 son 6 y no 5) — por eso una cotización
 * convertida en reserva DEBE mandar las fechas a las 00:00 UTC.
 *
 * Devuelve NaN si alguna cadena no es una fecha válida.
 */
export function nightsBetweenYMD(checkIn: string, checkOut: string): number {
  const ci = parseYMD(checkIn);
  const co = parseYMD(checkOut);
  if (ci == null || co == null) return NaN;
  return Math.round((co - ci) / 86_400_000);
}

/** "YYYY-MM-DD" → epoch ms a medianoche UTC. null si el formato es inválido. */
function parseYMD(ymd: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  // Rebota fechas que Postgres aceptaría pero no existen (31 de febrero).
  const back = new Date(ms);
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return ms;
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
export const DAYCARE_OPEN_HOUR = 9; // 9:00 am
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

// ============================================================
// Reloj del hotel — America/Hermosillo (UTC-7 FIJO, sin horario de verano).
// ============================================================

/** Desfase del hotel respecto a UTC, en horas. Constante: Sonora no cambia. */
export const HOTEL_TZ_OFFSET_HOURS = 7;

/**
 * Horas que faltan para las 00:00 HORA LOCAL del hotel del día calendario
 * `day`. Puede ser negativo si ese momento ya pasó.
 *
 * Las fechas de estadía (`checkIn`/`checkOut`) se guardan a las 00:00 UTC y
 * representan el DÍA calendario, no un instante: las 00:00 UTC del 10 son las
 * 17:00 del 9 en Hermosillo. Si se resta `checkIn − now` a secas, la ventana de
 * "mismo día" (< 24 h) arranca a las 17:00 de DOS días antes y la de anticipo
 * (≥ 3 días) se cierra un día antes de lo debido. La medianoche local del día
 * es `day + tzOffset`, y contra eso se mide.
 */
export function hoursUntilHotelDay(
  day: Date,
  now: number = Date.now(),
  tzOffsetHours: number = HOTEL_TZ_OFFSET_HOURS
): number {
  const localMidnight = day.getTime() + tzOffsetHours * 3_600_000;
  return (localMidnight - now) / 3_600_000;
}
