-- CreateEnum
CREATE TYPE "DewormingType" AS ENUM ('INTERNAL', 'EXTERNAL', 'BOTH');

-- AlterTable
ALTER TABLE "pets" ADD COLUMN     "cartillaPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Migrar datos: copiar cartilla_url existente al primer slot de cartilla_photos.
-- Las cartillas nuevas usarán cartillaPhotos directamente; cartillaUrl queda
-- como legacy hasta poder dropearlo en una migration futura.
UPDATE "pets"
SET "cartillaPhotos" = ARRAY["cartillaUrl"]
WHERE "cartillaUrl" IS NOT NULL AND "cartillaUrl" <> '';

-- CreateTable
CREATE TABLE "dewormings" (
    "id" TEXT NOT NULL,
    "type" "DewormingType" NOT NULL,
    "productName" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "vetName" TEXT,
    "fileUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "petId" TEXT NOT NULL,

    CONSTRAINT "dewormings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "dewormings" ADD CONSTRAINT "dewormings_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
