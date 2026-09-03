-- Índices en las FK calientes que seguían sin índice. Postgres NO indexa las
-- llaves foráneas automáticamente (y Prisma tampoco las cubre solo): cada
-- include anidado, cada bandeja de avisos y cada cascade hacían Seq Scan.
--
-- Los nombres son EXACTAMENTE los que Prisma genera para `@@index([col])`
-- (<tabla>_<col>_idx), así este archivo y schema.prisma cuadran y
-- `prisma migrate diff` queda en 0. IF NOT EXISTS por si alguno ya se creó a
-- mano en prod.
--
-- Fuera de aquí, a propósito, dos índices que Prisma no puede expresar y que
-- existen en prod por migraciones del admin web (ver comentarios en
-- schema.prisma junto a ExpenseCategory y TerminalCharge):
--   expense_categories_name_lower_idx  (expresión: lower(name))
--   terminal_charges_pending_idx       (parcial: where status = 'PENDING')

-- Reservation: hermanas de una multireserva (idempotencia del PI, reseñas por
-- visita, avisos al equipo).
CREATE INDEX IF NOT EXISTS "reservations_groupId_idx" ON "reservations"("groupId");

-- ReservationAddon: include de add-ons por reserva (y su ON DELETE CASCADE),
-- por variante (ingresos por servicio) y por pago.
CREATE INDEX IF NOT EXISTS "reservation_addons_reservationId_idx" ON "reservation_addons"("reservationId");
CREATE INDEX IF NOT EXISTS "reservation_addons_variantId_idx" ON "reservation_addons"("variantId");
CREATE INDEX IF NOT EXISTS "reservation_addons_paymentId_idx" ON "reservation_addons"("paymentId");

-- Notification: bandeja y conteo de no leídos por usuario.
CREATE INDEX IF NOT EXISTS "notifications_userId_idx" ON "notifications"("userId");

-- Payment: pagos de un cliente / merge de cuentas.
CREATE INDEX IF NOT EXISTS "payments_userId_idx" ON "payments"("userId");

-- PushToken: tokens de un usuario al mandar push.
CREATE INDEX IF NOT EXISTS "push_tokens_userId_idx" ON "push_tokens"("userId");

-- Deworming: include de desparasitaciones por mascota.
CREATE INDEX IF NOT EXISTS "dewormings_petId_idx" ON "dewormings"("petId");

-- StayUpdate: evidencias por mascota y por staff que las subió
-- (reservationId ya está cubierto por stay_updates_reservationId_createdAt_idx).
CREATE INDEX IF NOT EXISTS "stay_updates_petId_idx" ON "stay_updates"("petId");
CREATE INDEX IF NOT EXISTS "stay_updates_staffId_idx" ON "stay_updates"("staffId");

-- Review: reseñas de un cliente.
CREATE INDEX IF NOT EXISTS "reviews_ownerId_idx" ON "reviews"("ownerId");
