-- ============================================================================
-- Solicitudes de vinculación de ficha ("vincúlenme mi cuenta").
--
-- Un cliente de toda la vida instala la app, busca su ficha y resulta que no
-- tiene ningún contacto al que mandarle un código de verificación: ni correo
-- real (los walk-in llevan un @holidoginn.local que genera el sistema) ni un
-- teléfono del que se pueda deducir el país. Hasta ahora eso era un callejón
-- —"escríbenos por WhatsApp"— y alguien del equipo tenía que resolverlo a mano,
-- sin ninguna herramienta para hacerlo.
--
-- Con esta tabla la solicitud queda registrada, le llega al equipo a su bandeja
-- de avisos y se aprueba desde la app, dejando rastro de quién vinculó a quién.
--
-- Deliberadamente NO se guardan las fichas que coincidieron: se recalculan al
-- abrir la solicitud, para que el equipo decida sobre lo que es verdad hoy.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE "ClaimRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "claim_requests" (
  "id"           TEXT NOT NULL,
  "requesterId"  TEXT,
  "requesterName"  TEXT,
  "requesterEmail" TEXT,
  "mergedIntoId"   TEXT,
  "typedPhone"   TEXT,
  "typedEmail"   TEXT,
  "note"         TEXT,
  "status"       "ClaimRequestStatus" NOT NULL DEFAULT 'PENDING',
  "resolvedById" TEXT,
  "resolvedAt"   TIMESTAMP(3),
  "resolution"   TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "claim_requests_pkey" PRIMARY KEY ("id")
);

-- La bandeja pide siempre las pendientes, más recientes primero.
CREATE INDEX IF NOT EXISTS "claim_requests_status_createdAt_idx"
  ON "claim_requests"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "claim_requests_requesterId_idx"
  ON "claim_requests"("requesterId");

-- SetNull y no Cascade, deliberadamente: al vincular, la cuenta nueva se BORRA
-- (la ficha vieja hereda su clerkId y su correo). Con Cascade, la solicitud se
-- habría borrado en la misma transacción, justo al aprobarla, y habríamos
-- perdido el rastro de quién vinculó a quién. Por eso además se guarda una
-- copia del nombre y el correo del solicitante.
ALTER TABLE "claim_requests"
  DROP CONSTRAINT IF EXISTS "claim_requests_requesterId_fkey";
ALTER TABLE "claim_requests"
  ADD CONSTRAINT "claim_requests_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "claim_requests"
  DROP CONSTRAINT IF EXISTS "claim_requests_resolvedById_fkey";
ALTER TABLE "claim_requests"
  ADD CONSTRAINT "claim_requests_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
