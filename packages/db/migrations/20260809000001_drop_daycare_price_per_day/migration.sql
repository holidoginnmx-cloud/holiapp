-- La guardería se cobra por hora (daycareExtraHourPrice) desde julio 2026;
-- esta columna llevaba semanas deprecada y el admin web ya no la proyecta.
-- ORDEN DE DEPLOY: publicar primero el admin web (Vercel) sin las referencias
-- a la columna, y después este monorepo (Railway ejecuta esta migración).
ALTER TABLE "lodging_pricing" DROP COLUMN "daycarePricePerDay";
