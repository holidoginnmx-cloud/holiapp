import type { DeliveryTrip } from "@/lib/api";

/**
 * Viajes que puede contratar el cliente en el servicio a domicilio.
 *
 * La tarifa de UN traslado ya paga el recorrido completo de la camioneta
 * (hotel → casa → hotel), así que recoger y entregar cuestan lo MISMO: se
 * distinguen porque al equipo le cambia a qué hora sale y en qué dirección.
 * El redondo son DOS salidas, en días distintos, y por eso vale el doble.
 */
export const VIAJES_DOMICILIO: { key: DeliveryTrip; label: string }[] = [
  { key: "PICKUP", label: "Solo ida" },
  { key: "DROPOFF", label: "Solo vuelta" },
  { key: "ROUND_TRIP", label: "Redondo" },
];

/** Cómo se le explica cada viaje al CLIENTE (app del dueño y sitio). */
export const VIAJE_SUB_CLIENTE: Record<DeliveryTrip, string> = {
  PICKUP: "Vamos por tu mascota a tu casa",
  DROPOFF: "La llevamos de regreso a tu casa",
  ROUND_TRIP: "Vamos por ella y la regresamos",
};

/** Cómo se le explica cada viaje al EQUIPO (admin y cotizaciones). */
export const VIAJE_HINT_EQUIPO: Record<DeliveryTrip, string> = {
  PICKUP: "Vamos por el perro a su casa.",
  DROPOFF: "Lo llevamos de regreso a su casa.",
  ROUND_TRIP: "Lo recogemos y lo regresamos: son dos viajes, cuesta el doble.",
};

/** Sufijo del precio: deja ver por qué el redondo cuesta el doble. */
export const viajeSufijo = (trip: DeliveryTrip): string =>
  trip === "ROUND_TRIP" ? "(dos viajes)" : "(un viaje)";

/** Etiqueta corta para los detalles de reserva ("Solo ida", "Redondo"). */
export const VIAJE_ETIQUETA: Record<DeliveryTrip, string> = {
  PICKUP: "solo ida",
  DROPOFF: "solo vuelta",
  ROUND_TRIP: "redondo",
};
