-- Eliminar columna pricePerDay de Room: el precio se calcula dinamicamente por peso de la mascota
ALTER TABLE "rooms" DROP COLUMN "pricePerDay";
