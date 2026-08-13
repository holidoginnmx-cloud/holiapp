-- Nota interna de la reserva + nota y cortesía por add-on.
--
-- `reservations.internalNotes`: hasta ahora `notes` servía para DOS cosas —
-- lo que el cliente escribe al reservar y lo que el equipo anota internamente
-- (el wizard del admin decía "Notas internas..." y escribía ahí) — y el detalle
-- del cliente la pintaba, así que lo interno era visible para el dueño. Se
-- separa en una columna propia que la API borra de la respuesta cuando el
-- solicitante no es staff/admin.
--
-- `reservation_addons.internalNote`: instrucción para quien ejecuta el servicio
-- ("usar shampoo hipoalergénico"). NO se reusa `extraDescription` porque la
-- sobreescribe POST /staff/addons/:id/set-extras.
--
-- `reservation_addons.isCourtesy`: servicio REGALADO. Se agenda y se ejecuta
-- igual, pero no entra al total. `unitPrice` conserva el precio de catálogo
-- para saber cuánto se regaló; un unitPrice de 0 suelto no distinguiría
-- "regalado" de "error de captura". Es un booleano y no un valor más de
-- AddonPaymentSource porque son ejes distintos: ese enum dice CÓMO se pagó, y
-- un baño de cortesía sigue siendo un BOOKING que se agenda.
--
-- SIN BACKFILL a propósito: cualquier heurística para adivinar qué `notes`
-- histórica era interna y cuál del cliente o le quita al dueño su nota
-- legítima o deja texto interno visible. Se corrige de aquí en adelante.
--
-- Todas las columnas son nullable o tienen default, así que esta migración es
-- segura de correr con la API y el admin web viejos todavía en producción.

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN "internalNotes" TEXT;

-- AlterTable
ALTER TABLE "reservation_addons" ADD COLUMN "internalNote" TEXT;
ALTER TABLE "reservation_addons" ADD COLUMN "isCourtesy" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "reservation_addons" ADD COLUMN "courtesyReason" TEXT;
ALTER TABLE "reservation_addons" ADD COLUMN "courtesySetById" TEXT;
ALTER TABLE "reservation_addons" ADD COLUMN "courtesySetAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "reservation_addons" ADD CONSTRAINT "reservation_addons_courtesySetById_fkey" FOREIGN KEY ("courtesySetById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
