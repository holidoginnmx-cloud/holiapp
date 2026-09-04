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
 * Tramos de talla por peso: la ÚNICA tabla. `upToKg` es el tope INCLUSIVO del
 * tramo (null = sin tope); el piso es el tope del tramo anterior, exclusivo.
 *   S: ≤ 5 kg · M: 5–15 kg · L: 15–24 kg · XL: > 24 kg
 * Exportada para que las UIs (admin web incluido, que copiaba la regla con
 * otros cortes) pinten los rangos sin redefinirlos. `sizeFromWeight` itera esta
 * misma tabla, así que no pueden divergir.
 */
export const SIZE_RANGES_KG: ReadonlyArray<{ size: SizeKey; upToKg: number | null }> = [
  { size: "S", upToKg: 5 },
  { size: "M", upToKg: 15 },
  { size: "L", upToKg: 24 },
  { size: "XL", upToKg: null },
];

/** Etiqueta legible del tramo ("≤ 5 kg", "5–15 kg", "> 24 kg"). */
export function sizeRangeLabel(size: SizeKey): string {
  const idx = SIZE_RANGES_KG.findIndex((r) => r.size === size);
  const range = SIZE_RANGES_KG[idx];
  const floor = idx > 0 ? SIZE_RANGES_KG[idx - 1].upToKg : null;
  if (range.upToKg == null) return `> ${floor} kg`;
  if (floor == null) return `≤ ${range.upToKg} kg`;
  return `${floor}–${range.upToKg} kg`;
}

/**
 * Tamaño canónico a partir del peso (kg). El bucket más pequeño por peso es S
 * (XS no se infiere por peso). Misma tabla en toda la app (SIZE_RANGES_KG).
 * Es la regla que el API aplica SIEMPRE al escribir `pets.size`: el `size`
 * que mande un cliente se ignora (ver routes/pets.ts y lib/guestPet.ts).
 */
export function sizeFromWeight(kg: number | null | undefined): SizeKey {
  const w = kg ?? 0;
  for (const range of SIZE_RANGES_KG) {
    if (range.upToKg == null || w <= range.upToKg) return range.size;
  }
  return "XL";
}

/** Las variantes de baño se catalogan por S/M/L/XL — XS colapsa a S. */
export function bathSizeKey(size: "XS" | SizeKey): SizeKey {
  return size === "XS" ? "S" : size;
}

/**
 * Tramos de peso del DESPARASITANTE: escala PROPIA, sus cortes NO coinciden con
 * `SIZE_RANGES_KG` (baño/talla general) — no unificar. A diferencia de aquella,
 * ésta tiene piso y techo explícitos y deja huecos a propósito (< 3.6 kg,
 * > 60 kg y los decimales entre tramos no tienen tarifa). Mismos tramos que
 * `dewormSizeKey` del admin web (lib/desparasitante.ts, repo aparte).
 */
export const DEWORM_RANGES_KG: ReadonlyArray<{
  size: SizeKey;
  minKg: number;
  maxKg: number;
}> = [
  { size: "S", minKg: 3.6, maxKg: 7.5 },
  { size: "M", minKg: 7.6, maxKg: 15 },
  { size: "L", minKg: 15.1, maxKg: 30 },
  { size: "XL", minKg: 30.1, maxKg: 60 },
];

/** Etiqueta legible del tramo de desparasitante ("3.6–7.5 kg"). */
export function dewormSizeRangeLabel(size: SizeKey): string {
  const range = DEWORM_RANGES_KG.find((r) => r.size === size);
  if (!range) return "";
  return `${range.minKg}–${range.maxKg} kg`;
}

/**
 * Talla para cotizar el DESPARASITANTE a partir del peso (kg), según
 * `DEWORM_RANGES_KG`. Devuelve null si falta el peso o cae fuera de los tramos
 * cubiertos: en ese caso no hay tarifa y no se debe cotizar.
 */
export function dewormSizeFromWeight(
  kg: number | null | undefined
): SizeKey | null {
  if (kg == null || Number.isNaN(kg)) return null;
  for (const range of DEWORM_RANGES_KG) {
    if (kg >= range.minKg && kg <= range.maxKg) return range.size;
  }
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
 * Da el mismo número que `computeDays`, que es lo que usan TODAS las rutas de
 * hospedaje (vía computeStayPricing). Las fechas de estancia van ancladas a
 * medianoche UTC; con horas del día distintas, `computeDays` sigue contando
 * días-calendario (check-in 09:00 → check-out 18:00 cinco días después son 5
 * noches), a diferencia del viejo `Math.ceil(diffMs/86_400_000)` que contaba
 * una de más. Una cotización convertida en reserva manda las fechas a las
 * 00:00 UTC de todos modos.
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

/** Lo que necesita el cálculo de hospedaje (subconjunto de LodgingPricingConfig). */
export type StayPricingConfig = Pick<
  LodgingPricingConfig,
  "pricePerDaySmall" | "pricePerDayLarge" | "largeWeightKg" | "medicationSurchargePct"
>;

/** Precio por noche según peso (umbral de "grande" configurable). */
export function pricePerDayForWeight(
  weightKg: number | null | undefined,
  config: Pick<
    LodgingPricingConfig,
    "pricePerDaySmall" | "pricePerDayLarge" | "largeWeightKg"
  > = DEFAULT_LODGING_PRICING
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

// ============================================================
// Hospedaje (STAY) — UNA sola fórmula de precio por mascota.
//
// Antes el recargo por medicamento estaba quemado como 0.1 en cinco rutas
// (aunque LodgingPricing.medicationSurchargePct es editable en Config →
// Tarifas), cada una redondeaba distinto (Math.ceil / toFixed(2) / nada) y las
// noches se contaban con Math.ceil(ms/86_400_000) en unas y computeDays en
// otras. Todo lo que cobra o persiste un hospedaje pasa por aquí:
// /payments/create-intent (lo que Stripe cobra), /reservations/multi (lo que
// se persiste y se compara contra el PI), POST /reservations (equipo),
// /guest/reservations/* (sitio público) y lib/reservationCreate.
// ============================================================

/** Recargo por reservar con menos de 24 h para el check-in (solo clientes). */
export const SAME_DAY_SURCHARGE_PCT = 0.2;

/**
 * Quita el ruido de coma flotante ANTES de redondear: 385 × 0.2 puede dar
 * 77.00000000000001 y un Math.ceil ingenuo lo sube a 78. Seis decimales
 * bastan (los precios tienen dos) y no alteran ningún monto real.
 */
function cleanFloat(x: number): number {
  return Math.round(x * 1_000_000) / 1_000_000;
}

/**
 * REGLA DE REDONDEO de los recargos: hacia ARRIBA a peso entero, por concepto.
 * Es lo que /payments/create-intent hizo siempre (lo que el cliente ve y lo
 * que Stripe cobra); las rutas que persistían sin redondear guardaban
 * centavos que nadie cobraba.
 */
export function ceilMoney(x: number): number {
  return Math.ceil(cleanFloat(x));
}

/** Normaliza a centavos (2 decimales). No es un redondeo de negocio: solo limpia ruido. */
export function roundMoney(x: number): number {
  return Math.round(cleanFloat(x) * 100) / 100;
}

export interface StayPricingInput {
  petWeightKg: number | null | undefined;
  /** Noches. Si no viene, se calculan con `computeDays(checkIn, checkOut)`. */
  totalDays?: number;
  checkIn?: Date;
  checkOut?: Date;
  hasMedication: boolean;
  /** Reserva a menos de 24 h del check-in (el caller decide: rol + reloj o metadata del PI). */
  sameDay: boolean;
  /**
   * Servicios contratados CON la estancia para esta mascota (baño incluido en
   * la reserva). Entran a la base del recargo de mismo día, como siempre.
   */
  addonsAmount?: number;
  /** Descuento ya repartido a ESTA mascota (ver allocateProportional). Se resta antes del mismo día. */
  discount?: number;
  config: StayPricingConfig;
}

export interface StayPricing {
  totalDays: number;
  pricePerDay: number;
  /** pricePerDay × totalDays. */
  lodging: number;
  /** ceil(lodging × medicationSurchargePct), 0 sin medicamento. */
  medicationFee: number;
  addonsAmount: number;
  discount: number;
  /** lodging + medicationFee + addonsAmount − discount (base del mismo día y del descuento). */
  subtotal: number;
  /** ceil(subtotal × SAME_DAY_SURCHARGE_PCT), 0 si no es mismo día. */
  sameDayFee: number;
  /** subtotal + sameDayFee. SIN domicilio: ese es un costo fijo por grupo que suma el caller. */
  total: number;
}

/**
 * Precio de la estancia de UNA mascota. Pura y determinista: misma entrada,
 * mismo número, en el cliente, en create-intent y al confirmar — así el monto
 * cobrado por Stripe y el persistido en `reservations` salen de la misma
 * función y la comparación de PAYMENT_MISMATCH no depende de redondeos.
 *
 * Redondeo (ver ceilMoney): medicationFee y sameDayFee suben a peso entero,
 * cada uno por su lado; lodging/subtotal/total solo se normalizan a centavos.
 * Con la config por defecto (350/450 por noche, 10 %) todos los montos son
 * enteros y el ceil no cambia nada; con tarifas con centavos o descuentos
 * raros, la diferencia contra el cálculo viejo es de a lo más un peso por
 * concepto y por mascota.
 *
 * `totalDays` nunca es negativo; el caller debe rechazar 0 (una estancia es
 * de al menos una noche).
 */
export function computeStayPricing(input: StayPricingInput): StayPricing {
  const { config } = input;
  const days =
    input.totalDays ??
    (input.checkIn && input.checkOut ? computeDays(input.checkIn, input.checkOut) : 0);
  const totalDays = Math.max(0, days);
  const pricePerDay = pricePerDayForWeight(input.petWeightKg, config);
  const lodging = roundMoney(pricePerDay * totalDays);
  const medicationFee =
    input.hasMedication && config.medicationSurchargePct > 0
      ? ceilMoney(lodging * config.medicationSurchargePct)
      : 0;
  const addonsAmount = roundMoney(input.addonsAmount ?? 0);
  const discount = roundMoney(input.discount ?? 0);
  const subtotal = roundMoney(
    Math.max(0, lodging + medicationFee + addonsAmount - discount)
  );
  const sameDayFee = input.sameDay ? ceilMoney(subtotal * SAME_DAY_SURCHARGE_PCT) : 0;
  const total = roundMoney(subtotal + sameDayFee);
  return {
    totalDays,
    pricePerDay,
    lodging,
    medicationFee,
    addonsAmount,
    discount,
    subtotal,
    sameDayFee,
    total,
  };
}

/**
 * Reparte `amount` entre varias filas en proporción a `weights`, a centavos;
 * la ÚLTIMA fila absorbe el redondeo para que la suma sea exactamente
 * `amount`. Con pesos en cero se reparte en partes iguales. Es el reparto del
 * descuento de un booking entre las mascotas del grupo (create-intent y /multi
 * DEBEN repartir igual para que las filas cuadren con el PI) y del anticipo
 * acordado en las reservas del equipo.
 */
export function allocateProportional(amount: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (n === 1) return [roundMoney(amount)];
  const sum = weights.reduce((a, w) => a + w, 0);
  const parts: number[] = [];
  let allocated = 0;
  for (let i = 0; i < n - 1; i++) {
    const part =
      sum > 0
        ? roundMoney((amount * (weights[i] ?? 0)) / sum)
        : Math.floor((amount / n) * 100) / 100;
    parts.push(part);
    allocated += part;
  }
  parts.push(roundMoney(amount - allocated));
  return parts;
}
