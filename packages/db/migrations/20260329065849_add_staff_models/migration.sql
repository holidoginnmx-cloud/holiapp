-- CreateEnum
CREATE TYPE "EnergyLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SocializationLevel" AS ENUM ('ISOLATED', 'SELECTIVE', 'SOCIAL');

-- CreateEnum
CREATE TYPE "RestQuality" AS ENUM ('POOR', 'FAIR', 'GOOD');

-- CreateEnum
CREATE TYPE "MoodLevel" AS ENUM ('SAD', 'NEUTRAL', 'HAPPY', 'EXCITED');

-- CreateEnum
CREATE TYPE "BehaviorTagValue" AS ENUM ('CALM', 'ANXIOUS', 'DOMINANT', 'SOCIABLE', 'SHY', 'AGGRESSIVE');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('NOT_EATING', 'LETHARGIC', 'BEHAVIOR_ISSUE', 'HEALTH_CONCERN', 'INCIDENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'DAILY_REPORT';
ALTER TYPE "NotificationType" ADD VALUE 'STAFF_ALERT';

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "staffId" TEXT;

-- CreateTable
CREATE TABLE "daily_checklists" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "energy" "EnergyLevel" NOT NULL,
    "socialization" "SocializationLevel" NOT NULL,
    "rest" "RestQuality" NOT NULL,
    "mealsCompleted" BOOLEAN NOT NULL DEFAULT false,
    "mealsNotes" TEXT,
    "walksCompleted" BOOLEAN NOT NULL DEFAULT false,
    "bathroomBreaks" BOOLEAN NOT NULL DEFAULT false,
    "playtime" BOOLEAN NOT NULL DEFAULT false,
    "socializationDone" BOOLEAN NOT NULL DEFAULT false,
    "mood" "MoodLevel" NOT NULL,
    "feedingNotes" TEXT,
    "behaviorNotes" TEXT,
    "additionalNotes" TEXT,
    "photosCount" INTEGER NOT NULL DEFAULT 0,
    "videosCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reservationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,

    CONSTRAINT "daily_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behavior_tags" (
    "id" TEXT NOT NULL,
    "tag" "BehaviorTagValue" NOT NULL,
    "notes" TEXT,
    "stayId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "petId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,

    CONSTRAINT "behavior_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_alerts" (
    "id" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "description" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservationId" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,

    CONSTRAINT "staff_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_checklists_reservationId_date_key" ON "daily_checklists"("reservationId", "date");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_updates" ADD CONSTRAINT "stay_updates_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_checklists" ADD CONSTRAINT "daily_checklists_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_checklists" ADD CONSTRAINT "daily_checklists_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavior_tags" ADD CONSTRAINT "behavior_tags_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavior_tags" ADD CONSTRAINT "behavior_tags_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_alerts" ADD CONSTRAINT "staff_alerts_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_alerts" ADD CONSTRAINT "staff_alerts_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_alerts" ADD CONSTRAINT "staff_alerts_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
