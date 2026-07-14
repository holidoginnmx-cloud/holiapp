-- ============================================================================
-- Guardería (DAYCARE) como servicio reservable — sincronización con la web.
--
-- Las dos columnas ya existen en la DB compartida (las creó la migración
-- 0019_horas_extra.sql del admin web); este archivo las incorpora al historial
-- de Prisma de forma IDEMPOTENTE para entornos donde no existan.
--
-- Modelo de guardería: reservationType = DAYCARE, appointmentAt = día anclado a
-- mediodía UTC, checkInTime/checkOutTime = entrada/salida estimadas ("HH:mm").
-- Precio = horas × lodging_pricing."daycareExtraHourPrice" (tarifa ÚNICA por
-- hora, compartida con el add-on EXTRA_HOURS). daycarePricePerDay queda
-- deprecada.
-- ============================================================================

-- Tarifa única por hora de guardería / horas extra.
ALTER TABLE "lodging_pricing"
  ADD COLUMN IF NOT EXISTS "daycareExtraHourPrice" NUMERIC(10,2) NOT NULL DEFAULT 25;

-- Cantidad para addons cobrados por unidad (EXTRA_HOURS: nº de horas).
ALTER TABLE "reservation_addons"
  ADD COLUMN IF NOT EXISTS "quantity" INTEGER;

-- La web creó la columna con default 0; si nadie configuró la tarifa aún,
-- sembrar el precio del flyer ($25/h). No pisa valores ya configurados.
UPDATE "lodging_pricing"
  SET "daycareExtraHourPrice" = 25
  WHERE "daycareExtraHourPrice" = 0;

-- Listas diarias de staff (baños/guarderías del día).
CREATE INDEX IF NOT EXISTS "reservations_reservationType_status_appointmentAt_idx"
  ON "reservations" ("reservationType", "status", "appointmentAt");
