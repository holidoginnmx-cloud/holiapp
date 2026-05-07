-- DropIndex
DROP INDEX "reservations_reservationType_appointmentAt_idx";

-- AlterTable
ALTER TABLE "vaccines" ADD COLUMN     "catalogId" TEXT;

-- CreateTable
CREATE TABLE "vaccine_catalog" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "defaultDurationDays" INTEGER NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vaccine_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vaccine_catalog_code_key" ON "vaccine_catalog"("code");

-- AddForeignKey
ALTER TABLE "vaccines" ADD CONSTRAINT "vaccines_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "vaccine_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
