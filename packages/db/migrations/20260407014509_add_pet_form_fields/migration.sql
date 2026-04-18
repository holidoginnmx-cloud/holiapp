-- AlterTable
ALTER TABLE "pets" ADD COLUMN     "behavior" TEXT,
ADD COLUMN     "emergencyContactRelation" TEXT,
ADD COLUMN     "feedingAmount" TEXT,
ADD COLUMN     "feedingInstructions" TEXT,
ADD COLUMN     "feedingSchedule" TEXT,
ADD COLUMN     "foodType" TEXT,
ADD COLUMN     "healthIssues" TEXT,
ADD COLUMN     "sex" TEXT,
ADD COLUMN     "vetEmergency24h" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "walkPreference" TEXT;
