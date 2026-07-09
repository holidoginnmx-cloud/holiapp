-- Hora estimada de llegada/recogida elegida por el cliente ("HH:mm", hora
-- local del hotel). Opcional al reservar; un recordatorio la pide un día antes.
ALTER TABLE "reservations" ADD COLUMN "checkInTime" TEXT;
ALTER TABLE "reservations" ADD COLUMN "checkOutTime" TEXT;
