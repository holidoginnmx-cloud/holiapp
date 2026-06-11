-- Servicio a domicilio: config global editable, dirección guardada por cliente,
-- y datos de domicilio por reservación.

-- Config singleton de precios del servicio a domicilio.
CREATE TABLE "delivery_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "baseFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pricePerKm" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "delivery_config_pkey" PRIMARY KEY ("id")
);

-- Dirección guardada del cliente (reutilizable en futuras reservas).
ALTER TABLE "users" ADD COLUMN "address" TEXT;
ALTER TABLE "users" ADD COLUMN "addressLat" DOUBLE PRECISION;
ALTER TABLE "users" ADD COLUMN "addressLng" DOUBLE PRECISION;
ALTER TABLE "users" ADD COLUMN "addressPlaceId" TEXT;

-- Datos de servicio a domicilio por reservación.
ALTER TABLE "reservations" ADD COLUMN "homeDelivery" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "reservations" ADD COLUMN "homeDeliveryAddress" TEXT;
ALTER TABLE "reservations" ADD COLUMN "homeDeliveryDistanceKm" DOUBLE PRECISION;
ALTER TABLE "reservations" ADD COLUMN "homeDeliveryFee" DECIMAL(10,2);
