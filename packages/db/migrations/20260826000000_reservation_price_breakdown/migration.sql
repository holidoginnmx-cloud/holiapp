-- Desglose del precio de una estancia al momento de crearla.
--
-- El cliente ve el desglose al reservar (hospedaje × noches, +10% por
-- medicamento, +20% por reservar el mismo día), pero nada de eso se
-- persistía: al equipo solo le llegaba el total y no había forma de saber de
-- dónde salió el dinero extra. Reconstruirlo después no es confiable (las
-- tarifas cambian y el total se edita), así que se guarda la foto al crear.
--
-- NULL = reserva vieja, de otro tipo (baño/guardería) o capturada con total
-- manual: en esos casos el desglose simplemente no se muestra.
ALTER TABLE "reservations" ADD COLUMN "lodgingAmount" DECIMAL(10,2);
ALTER TABLE "reservations" ADD COLUMN "medicationFee" DECIMAL(10,2);
ALTER TABLE "reservations" ADD COLUMN "sameDayFee" DECIMAL(10,2);
