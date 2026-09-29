-- ============================================================================
-- quote_revision — rastro de una cotización corregida en sitio
-- ============================================================================
-- Corregir una cotización ya enviada obligaba a cancelarla y capturar todo de
-- nuevo, lo que mataba el link que el cliente ya tenía en su chat (le quedaba
-- diciendo "esta cotización fue cancelada"). Con PUT /quotes/:id se recotiza
-- conservando folio y token, así que el cliente abre la liga de siempre y ve lo
-- corregido.
--
-- Eso deja un riesgo nuevo: el documento que el cliente ya leyó puede cambiar
-- sin que él ni el equipo se enteren. Estas columnas son ese rastro.
--   · revisedAt     — cuándo cambió. Comparado con "sentAt" es lo que permite
--                     avisar "la editaste después de mandarla, reenvíasela".
--                     No sirve "updatedAt": lo mueve cada visita del cliente
--                     (el contador de vistas escribe en la misma fila).
--   · revisionCount — cuántas veces. Auditoría de un documento que el cliente
--                     ya vio.
--   · revisedById   — quién. NULL ON DELETE, igual que "convertedById": perder
--                     al empleado no debe borrar la cotización.
--
-- Todas nullable/con default: las cotizaciones que ya existen quedan con
-- revisedAt NULL y revisionCount 0, que es justo "nunca se editó".
-- ============================================================================

ALTER TABLE "quotes"
  ADD COLUMN "revisedAt"     TIMESTAMPTZ(6),
  ADD COLUMN "revisionCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revisedById"   TEXT;

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_revisedById_fkey"
  FOREIGN KEY ("revisedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
