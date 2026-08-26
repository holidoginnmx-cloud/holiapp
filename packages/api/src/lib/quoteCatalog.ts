/**
 * Lado con base de datos del cálculo de cotizaciones.
 *
 * La aritmética vive en `@holidoginn/shared` (computeQuote): pura, sin I/O y
 * compartida con el preview en vivo de la app móvil. Aquí solo se cargan los
 * datos que necesita — tarifas y matriz de variantes — y se arma la foto que se
 * guarda como evidencia del precio.
 */

import type { PrismaClient } from "@prisma/client";
import type { QuoteCatalog } from "@holidoginn/shared";

const LODGING_ID = "singleton";

// El catálogo cambia poco (tarifas y matriz de estética) y se consulta en CADA
// tecla del formulario de cotización por el preview en vivo. 60 s es el
// compromiso: si el admin edita una tarifa y cotiza en menos de un minuto,
// cotiza con la anterior — por eso `invalidateQuoteCatalog()` se llama desde el
// endpoint que edita LodgingPricing.
const CATALOG_TTL_MS = 60_000;

let cache: { catalog: QuoteCatalog; expiresAt: number } | null = null;

/** Tira la caché. Llamar tras editar tarifas o variantes de servicio. */
export function invalidateQuoteCatalog(): void {
  cache = null;
}

/**
 * Tarifas + variantes activas, listas para `computeQuote`. Una sola consulta a
 * `service_variants` para los tres servicios que cotizan (baño, desparasitante
 * y horas extra) en vez de tres round-trips.
 */
export async function loadQuoteCatalog(prisma: PrismaClient): Promise<QuoteCatalog> {
  if (cache && cache.expiresAt > Date.now()) return cache.catalog;

  const [pricing, variants] = await Promise.all([
    // Mismo upsert que getLodgingPricing: el cálculo nunca falla por config
    // faltante. Se lee la fila completa (y no getLodgingPricing) porque las
    // tarifas de ProBarf no forman parte de LodgingPricingConfig.
    prisma.lodgingPricing.upsert({
      where: { id: LODGING_ID },
      update: {},
      create: { id: LODGING_ID },
    }),
    prisma.serviceVariant.findMany({
      where: {
        isActive: true,
        serviceType: {
          code: { in: ["BATH", "DEWORMING", "EXTRA_HOURS"] },
          isActive: true,
        },
      },
      select: {
        id: true,
        petSize: true,
        deslanado: true,
        corte: true,
        price: true,
        serviceType: { select: { code: true } },
      },
    }),
  ]);

  const catalog: QuoteCatalog = {
    lodging: {
      pricePerDaySmall: Number(pricing.pricePerDaySmall),
      pricePerDayLarge: Number(pricing.pricePerDayLarge),
      priceProbarfSmall: Number(pricing.priceProbarfSmall),
      priceProbarfLarge: Number(pricing.priceProbarfLarge),
      largeWeightKg: Number(pricing.largeWeightKg),
      medicationSurchargePct: Number(pricing.medicationSurchargePct),
      // La columna conserva el nombre histórico `daycareExtraHourPrice`, pero es
      // la tarifa ÚNICA por hora (guardería y horas extra). Ver getLodgingPricing.
      daycareHourPrice: Number(pricing.daycareExtraHourPrice),
    },
    bathVariants: variants
      .filter((v) => v.serviceType.code === "BATH")
      .map((v) => ({
        id: v.id,
        petSize: v.petSize,
        deslanado: v.deslanado,
        corte: v.corte,
        price: Number(v.price),
      })),
    dewormVariants: variants
      .filter((v) => v.serviceType.code === "DEWORMING")
      .map((v) => ({ id: v.id, petSize: v.petSize, price: Number(v.price) })),
    // Ancla del catálogo: la variante vale $0 y solo satisface el FK del add-on;
    // el precio real es horas × daycareHourPrice (ver el alta manual de
    // EXTRA_HOURS en routes/admin.ts).
    extraHoursVariantId:
      variants.find((v) => v.serviceType.code === "EXTRA_HOURS")?.id ?? null,
  };

  cache = { catalog, expiresAt: Date.now() + CATALOG_TTL_MS };
  return catalog;
}

/**
 * Foto de las tarifas y los precios de catálogo que produjeron una cotización.
 * No se usa para calcular: es la evidencia que permite explicar, tres meses
 * después, por qué esa cotización decía $350 por noche.
 */
export function buildPricingSnapshot(catalog: QuoteCatalog) {
  return {
    takenAt: new Date().toISOString(),
    lodging: catalog.lodging,
    // Solo las variantes referenciadas caben en la foto útil, pero guardar la
    // matriz completa es barato y permite reconstruir cualquier línea.
    bathVariants: catalog.bathVariants,
    dewormVariants: catalog.dewormVariants,
    extraHoursVariantId: catalog.extraHoursVariantId,
  };
}
