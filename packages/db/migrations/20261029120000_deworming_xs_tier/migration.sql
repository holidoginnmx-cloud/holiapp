-- Desparasitante: tramo nuevo de 2–3.5 kg (NexGard Spectra chico) a $310.
-- Se guarda con petSize = XS (la escala del desparasitante es propia, ver
-- DEWORM_RANGES_KG en packages/shared/src/pricing.ts). Idempotente: si ya
-- existe la variante (p. ej. por seed-services), no se toca su precio.
INSERT INTO "service_variants" ("id", "petSize", "deslanado", "corte", "price", "isActive", "updatedAt", "serviceTypeId")
SELECT 'deworm_xs_' || substr(md5(random()::text), 1, 16), 'XS'::"PetSize", false, false, 310, true, CURRENT_TIMESTAMP, st."id"
FROM "service_types" st
WHERE st."code" = 'DEWORMING'
ON CONFLICT ("serviceTypeId", "petSize", "deslanado", "corte") DO NOTHING;
