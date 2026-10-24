-- Medicamento: de 10 % del hospedaje a una tarifa fija por noche y por mascota.
-- `medicationSurchargePct` se queda (sin uso) para no romper binarios viejos.
ALTER TABLE "lodging_pricing" ADD COLUMN "medicationFeePerNight" DECIMAL(10,2) NOT NULL DEFAULT 50;
