-- Tarifa ProBarf por reservación: el equipo la marca en el detalle y el
-- hospedaje se recalcula con lodging_pricing.priceProbarfSmall/Large.
ALTER TABLE "reservations" ADD COLUMN "probarf" BOOLEAN NOT NULL DEFAULT false;
