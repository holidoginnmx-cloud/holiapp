-- Comisión semanal de la estilista por baño.
-- Porcentajes en bath_config (fracción; 0 = sin definir) e índice para el
-- reporte semanal, que filtra add-ons por completedAt.
-- Aditiva: la API y la app viejas ignoran las columnas nuevas.

CREATE INDEX "reservation_addons_completedAt_idx" ON "reservation_addons"("completedAt");

ALTER TABLE "bath_config" ADD COLUMN "groomerCommissionPct" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "bath_config" ADD COLUMN "groomerExtrasCommissionPct" DECIMAL NOT NULL DEFAULT 0;

-- Regla confirmada por José (2026-11-02): 15% sobre baño + corte + deslanado
-- (precio normal, sin domicilio). El default de la columna se queda en 0 para
-- que una instalación nueva no pague comisión sin que nadie lo decida.
UPDATE "bath_config"
SET "groomerCommissionPct" = 0.15, "groomerExtrasCommissionPct" = 0.15;
