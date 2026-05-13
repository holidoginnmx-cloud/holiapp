-- Split bath extras into per-extra prices.
-- `extraPrice` se mantiene como total (suma) para no romper el flujo de pago.
-- Se agregan columnas opcionales por extra para que el owner vea el desglose.
ALTER TABLE "reservation_addons"
  ADD COLUMN "extraDeslanadoPrice" DECIMAL(10,2),
  ADD COLUMN "extraCortePrice"     DECIMAL(10,2);
