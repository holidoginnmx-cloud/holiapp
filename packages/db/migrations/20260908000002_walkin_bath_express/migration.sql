-- ============================================================================
-- Baño de invitado (walk-in de mostrador)
-- ============================================================================
-- Llega alguien sin avisar, toca el timbre y pide un baño. No hay expediente y
-- no hay tiempo de llenarlo con el perro en la correa, así que hoy la captura
-- se abandona y el ingreso NO se registra. La app del equipo va a poder crear
-- la reserva con cuatro datos: nombre del cliente, teléfono, nombre del perro y
-- talla. Las filas de `users` y `pets` son REALES —la agenda y el cobro las
-- necesitan—: lo que se omite es el EXPEDIENTE, no el registro.
--
-- ── expressIntakeAt (users, pets) ──
-- Marca de procedencia. NO se reusa `originLegacy`: aquél significa "migrado
-- del Excel/web" y lo llevan ~300 de ~360 fichas, así que filtrar por él no
-- distingue a los walk-ins de esta semana. Es TIMESTAMP y no boolean porque
-- contesta "cuándo" al mismo costo ("walk-ins de los últimos 30 días") y no hay
-- que mantenerlo. Es PROCEDENCIA, no estado: no se limpia al completar el
-- expediente. "Incompleto" se deriva de `weight IS NULL`.
--
-- ── sizeDeclared (pets) ──
-- La talla sólo cuenta si un humano la eligió viendo al perro.
-- Cuando falta el peso, `pets.size` NO es un dato observado: el API lo rellena
-- con 'M' por default (routes/pets.ts, lib/guestPet.ts). La auditoría del
-- 2026-09-08 encontró 204 fichas activas sin peso y TODAS dicen 'M', ni una
-- sola 'L' ni 'XL' — es el relleno, no una talla que alguien haya mirado.
-- Por eso el default es false y NO hay backfill: sin declaración,
-- `billableBathSize` sigue cayendo a 'S', que es exactamente lo que se cobra
-- hoy. Esta migración no mueve el precio de ningún perro existente.
--
-- Migración puramente ADITIVA: tres columnas y dos índices. Ninguna fila se
-- reescribe y ninguna vista del dashboard cambia de forma.

ALTER TABLE "users" ADD COLUMN "expressIntakeAt" TIMESTAMP(3);

ALTER TABLE "pets" ADD COLUMN "expressIntakeAt" TIMESTAMP(3);
ALTER TABLE "pets" ADD COLUMN "sizeDeclared" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "users_expressIntakeAt_idx" ON "users"("expressIntakeAt");
CREATE INDEX "pets_expressIntakeAt_idx" ON "pets"("expressIntakeAt");
