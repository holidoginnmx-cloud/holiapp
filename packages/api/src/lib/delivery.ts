import type { PrismaClient } from "@prisma/client";
import { distanceKmFromHdi } from "./maps";

export type DeliveryQuote = {
  active: boolean;
  distanceKm: number;
  fee: number;
};

/**
 * Cotiza el servicio a domicilio para un destino dado.
 *
 * Fuente única de verdad del cálculo de tarifa (la usan el endpoint
 * `/delivery/quote` y los endpoints de creación/pago para RE-CALCULAR la fee
 * server-side; nunca se confía en el monto que mande el cliente).
 *
 * Regla acordada con el cliente:
 *   fee = baseFee + (distanciaKm redonda ida+vuelta × pricePerKm)
 * donde la distancia redonda = distancia de una sola ida × 2.
 *
 * Si el servicio está desactivado en `DeliveryConfig`, regresa
 * `{ active:false, distanceKm:0, fee:0 }` y el llamador debe ignorar el
 * domicilio (no cobrar ni persistir).
 */
export async function quoteDelivery(
  prisma: PrismaClient,
  lat: number,
  lng: number
): Promise<DeliveryQuote> {
  const config = await prisma.deliveryConfig.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  if (!config.isActive) {
    return { active: false, distanceKm: 0, fee: 0 };
  }

  const oneWayKm = await distanceKmFromHdi(lat, lng);
  const roundTripKm = oneWayKm * 2;
  const fee = Number(config.baseFee) + roundTripKm * Number(config.pricePerKm);
  return {
    active: true,
    distanceKm: Math.round(oneWayKm * 10) / 10,
    fee: Math.round(fee * 100) / 100,
  };
}
