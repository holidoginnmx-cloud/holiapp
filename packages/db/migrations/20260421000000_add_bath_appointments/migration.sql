-- Add ReservationType enum
CREATE TYPE "ReservationType" AS ENUM ('STAY', 'BATH');

-- Extend reservations table for bath appointments
ALTER TABLE "reservations"
  ADD COLUMN "reservationType" "ReservationType" NOT NULL DEFAULT 'STAY',
  ADD COLUMN "appointmentAt" TIMESTAMP(3);

-- Relax stay-only fields so bath appointments can coexist
ALTER TABLE "reservations"
  ALTER COLUMN "checkIn"   DROP NOT NULL,
  ALTER COLUMN "checkOut"  DROP NOT NULL,
  ALTER COLUMN "totalDays" DROP NOT NULL;

-- Helpful index for looking up bath appointments by day
CREATE INDEX "reservations_reservationType_appointmentAt_idx"
  ON "reservations" ("reservationType", "appointmentAt");

-- BathConfig singleton table
CREATE TABLE "bath_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "openHour" INTEGER NOT NULL DEFAULT 9,
    "closeHour" INTEGER NOT NULL DEFAULT 18,
    "slotMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxConcurrentBaths" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bath_config_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row with defaults
INSERT INTO "bath_config" ("id", "openHour", "closeHour", "slotMinutes", "maxConcurrentBaths", "isActive", "updatedAt")
VALUES ('singleton', 9, 18, 60, 1, true, NOW());
