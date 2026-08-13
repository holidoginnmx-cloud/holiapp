-- Reseñas por VISITA (no por reservación) + control del pop-up de calificación.
--
-- `reviews.groupKey` = reservations.groupId ?? reservations.id. Cuando el
-- cliente trae varios perros califica una sola vez y se escribe una fila por
-- hermana con el mismo groupKey: las métricas por servicio siguen cuadrando y
-- la UI agrupa por groupKey para no mostrar la misma reseña N veces.
--
-- `reservations.reviewRequestedAt/SnoozedUntil/PromptCount` controlan a quién y
-- cuántas veces se le pide reseña. Van en `reservations` (no en `notifications`)
-- porque el barrido de mantenimiento los consulta cada 10 minutos.

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN "groupKey" TEXT;
ALTER TABLE "reviews" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "reviews_groupKey_idx" ON "reviews"("groupKey");
CREATE INDEX "reviews_createdAt_idx" ON "reviews"("createdAt");

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN "reviewRequestedAt" TIMESTAMP(3);
ALTER TABLE "reservations" ADD COLUMN "reviewSnoozedUntil" TIMESTAMP(3);
ALTER TABLE "reservations" ADD COLUMN "reviewPromptCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "reservations_ownerId_status_reviewRequestedAt_idx" ON "reservations"("ownerId", "status", "reviewRequestedAt");

-- Backfill: las reseñas que ya existen se atan a su visita.
UPDATE "reviews" r
   SET "groupKey" = COALESCE(res."groupId", res."id")
  FROM "reservations" res
 WHERE res."id" = r."reservationId";

-- ANTI-AVALANCHA. El barrido `requestPendingReviews` busca reservaciones
-- CHECKED_OUT sin `reviewRequestedAt`. Sin esta línea, la primera corrida tras
-- el deploy mandaría un push por CADA visita histórica del hotel. Marcarlas
-- como "ya solicitadas" las deja fuera para siempre; sólo se pedirá reseña de
-- los check-outs posteriores a este deploy.
UPDATE "reservations" SET "reviewRequestedAt" = NOW() WHERE "status" = 'CHECKED_OUT';
