import { FastifyInstance } from "fastify";
import { createAuthMiddleware } from "../middleware/auth";
import { getLodgingPricing } from "../lib/pricing";

/**
 * Tarifas vigentes, legibles por CUALQUIER usuario autenticado (OWNER
 * incluido). La app del cliente estimaba el hospedaje con los defaults de
 * `DEFAULT_LODGING_PRICING` porque `/admin/lodging-pricing` es solo del
 * equipo: si el admin cambiaba la tarifa, el resumen del wizard mentía hasta
 * llegar a `create-intent`. Editar sigue siendo de admin (PATCH en admin.ts).
 */
export default async function pricingRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  // GET /pricing/lodging — singleton de tarifas de hospedaje/guardería.
  fastify.get("/pricing/lodging", { preHandler: [authMiddleware] }, async () => {
    const cfg = await getLodgingPricing(prisma);
    return {
      pricePerDaySmall: cfg.pricePerDaySmall,
      pricePerDayLarge: cfg.pricePerDayLarge,
      largeWeightKg: cfg.largeWeightKg,
      medicationSurchargePct: cfg.medicationSurchargePct,
      // Tarifa única por hora de guardería / horas extra. Va con el nombre de
      // la columna (histórico) y con el alias que usa /admin/lodging-pricing.
      daycareExtraHourPrice: cfg.daycareHourPrice,
      daycareHourPrice: cfg.daycareHourPrice,
    };
  });
}
