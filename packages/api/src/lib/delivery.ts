import type { PrismaClient } from "@prisma/client";
import { distanceKmFromHdi } from "./maps";

export type DeliveryQuote = {
  active: boolean;
  distanceKm: number;
  fee: number;
};

/**
 * Viajes que cubre la tarifa. Espeja el enum `DeliveryTrip` de Prisma.
 *
 * PICKUP y DROPOFF cuestan lo MISMO: la tarifa de un traslado ya paga el
 * recorrido completo de la camioneta (hotel → casa → hotel). Se distinguen
 * porque al equipo le cambia a qué hora sale y en qué dirección, no el precio.
 */
export type DeliveryTripMode = "PICKUP" | "DROPOFF" | "ROUND_TRIP";

/**
 * Lee el viaje desde un valor externo (metadata de Stripe, body sin validar).
 * PICKUP si no viene o no es uno de los tres modos: es el default histórico y
 * el más barato, así que nunca cobra de más.
 */
export function parseDeliveryTrip(raw: unknown): DeliveryTripMode {
  return raw === "DROPOFF" || raw === "ROUND_TRIP" ? raw : "PICKUP";
}

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
 * Con `trip: "ROUND_TRIP"` (lo recogen Y se lo regresan) son DOS traslados en
 * días distintos, así que la tarifa se cobra dos veces —base incluida: cada
 * salida de la camioneta paga su costo fijo—. `distanceKm` sigue reportando
 * la distancia de una ida, que es lo que se imprime en el documento.
 *
 * Si el servicio está desactivado en `DeliveryConfig`, regresa
 * `{ active:false, distanceKm:0, fee:0 }` y el llamador debe ignorar el
 * domicilio (no cobrar ni persistir).
 */
export async function quoteDelivery(
  prisma: PrismaClient,
  lat: number,
  lng: number,
  trip: DeliveryTripMode = "PICKUP"
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
  const unaSalida = Number(config.baseFee) + roundTripKm * Number(config.pricePerKm);
  const fee = trip === "ROUND_TRIP" ? unaSalida * 2 : unaSalida;
  return {
    active: true,
    distanceKm: Math.round(oneWayKm * 10) / 10,
    fee: Math.round(fee * 100) / 100,
  };
}
