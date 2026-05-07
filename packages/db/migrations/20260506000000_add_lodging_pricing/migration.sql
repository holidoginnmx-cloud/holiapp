-- LodgingPricing singleton table — tarifas de hospedaje editables por admin.
-- Reemplaza las constantes hardcoded en packages/api/src/lib/pricing.ts.
CREATE TABLE "lodging_pricing" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "pricePerDaySmall" DECIMAL(10,2) NOT NULL DEFAULT 350,
    "pricePerDayLarge" DECIMAL(10,2) NOT NULL DEFAULT 450,
    "largeWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "medicationSurchargePct" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lodging_pricing_pkey" PRIMARY KEY ("id")
);

-- Seed con los mismos valores que tenían las constantes previas.
INSERT INTO "lodging_pricing" ("id", "pricePerDaySmall", "pricePerDayLarge", "largeWeightKg", "medicationSurchargePct", "updatedAt")
VALUES ('singleton', 350, 450, 20, 0.10, NOW());
