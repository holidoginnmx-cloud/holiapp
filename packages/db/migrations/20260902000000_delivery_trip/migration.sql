-- Ida, vuelta o redondo en el servicio a domicilio.
--
-- Hasta ahora el domicilio era una sola cosa y su tarifa (base + km×2×precio)
-- cubre UN traslado: la camioneta sale del hotel, va a la casa y regresa. Un
-- cliente que quiere que además se lo regresen al terminar la estancia está
-- pidiendo dos viajes, y se cobraba uno.
--
-- PICKUP es el default a propósito: todo lo que ya está en la tabla se cotizó
-- y se cobró como un traslado sencillo, así que marcarlo de otro modo
-- reescribiría la historia.
CREATE TYPE "DeliveryTrip" AS ENUM ('PICKUP', 'DROPOFF', 'ROUND_TRIP');

ALTER TABLE "reservations"
  ADD COLUMN "homeDeliveryTrip" "DeliveryTrip" NOT NULL DEFAULT 'PICKUP';

ALTER TABLE "quotes"
  ADD COLUMN "homeDeliveryTrip" "DeliveryTrip" NOT NULL DEFAULT 'PICKUP';

-- Cotizar SOLO el traslado. `quotes.reservationType` reusa el enum de
-- reservaciones para decir qué se cotizó, así que el valor nuevo vive ahí.
-- Una RESERVACIÓN nunca es DELIVERY: el domicilio de una estancia sigue
-- viviendo en sus columnas homeDelivery*.
ALTER TYPE "ReservationType" ADD VALUE IF NOT EXISTS 'DELIVERY';
