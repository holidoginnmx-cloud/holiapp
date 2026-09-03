import { apiFetch } from "./client";
import type { LodgingPricingConfig } from "@holidoginn/shared/src/pricing";

/**
 * Tarifas vigentes de hospedaje/guardería, legibles por cualquier usuario
 * autenticado (GET /pricing/lodging). El wizard del CLIENTE estimaba con los
 * defaults de shared porque las tarifas solo se podían leer con rol de equipo:
 * si el admin las cambiaba en Config → Tarifas, el resumen mentía hasta llegar
 * al cobro. El servidor sigue siendo quien cobra; esto solo alinea el estimado.
 */
export const getPublicLodgingPricing = () =>
  apiFetch<LodgingPricingConfig & { daycareExtraHourPrice: number }>("/pricing/lodging");
