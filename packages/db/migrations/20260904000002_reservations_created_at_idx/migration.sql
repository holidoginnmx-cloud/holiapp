-- Índice para el orden por defecto de GET /reservations (createdAt desc, id
-- desc como desempate del cursor de paginación). Sin él, la consulta del admin
-- sin filtros ordena con top-N heapsort sobre toda la tabla.
CREATE INDEX IF NOT EXISTS "reservations_createdAt_id_idx"
  ON "reservations" ("createdAt" DESC, "id" DESC);
