-- Observación opcional del equipo al aprobar la cartilla (se envía al cliente
-- por notificación y se muestra en el perfil de la mascota).
ALTER TABLE "pets" ADD COLUMN "cartillaApprovalNote" TEXT;
