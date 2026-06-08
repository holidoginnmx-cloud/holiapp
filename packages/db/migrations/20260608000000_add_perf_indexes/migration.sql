-- Índices de rendimiento para evitar full table scans en las consultas más
-- frecuentes de la app. Postgres NO indexa las llaves foráneas automáticamente,
-- así que filtros por ownerId/status/fechas hacían Seq Scan en producción.

-- Reservation
CREATE INDEX "reservations_ownerId_status_idx" ON "reservations"("ownerId", "status");
CREATE INDEX "reservations_status_checkOut_idx" ON "reservations"("status", "checkOut");
CREATE INDEX "reservations_status_checkIn_idx" ON "reservations"("status", "checkIn");
CREATE INDEX "reservations_paymentType_status_depositDeadline_idx" ON "reservations"("paymentType", "status", "depositDeadline");
CREATE INDEX "reservations_roomId_status_idx" ON "reservations"("roomId", "status");

-- Pet
CREATE INDEX "pets_ownerId_isActive_idx" ON "pets"("ownerId", "isActive");

-- Payment
CREATE INDEX "payments_reservationId_idx" ON "payments"("reservationId");
CREATE INDEX "payments_status_paidAt_idx" ON "payments"("status", "paidAt");

-- Vaccine
CREATE INDEX "vaccines_petId_idx" ON "vaccines"("petId");
CREATE INDEX "vaccines_expiresAt_idx" ON "vaccines"("expiresAt");

-- StayUpdate
CREATE INDEX "stay_updates_reservationId_createdAt_idx" ON "stay_updates"("reservationId", "createdAt");
