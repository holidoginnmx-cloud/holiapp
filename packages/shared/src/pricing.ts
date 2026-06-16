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

export interface LodgingPricingConfig {
  pricePerDaySmall: number;
  pricePerDayLarge: number;
  largeWeightKg: number;
  medicationSurchargePct: number;
}

export const DEFAULT_LODGING_PRICING: LodgingPricingConfig = {
  pricePerDaySmall: DEFAULT_PRICE_PER_DAY_SMALL,
  pricePerDayLarge: DEFAULT_PRICE_PER_DAY_LARGE,
  largeWeightKg: DEFAULT_LARGE_WEIGHT_KG,
  medicationSurchargePct: DEFAULT_MEDICATION_SURCHARGE_PCT,
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
