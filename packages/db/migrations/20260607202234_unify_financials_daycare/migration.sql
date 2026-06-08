-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('ANTICIPO', 'ABONO', 'RESTANTE', 'FULL');

-- CreateEnum
CREATE TYPE "CostType" AS ENUM ('FIJO', 'VARIABLE', 'SUELDO', 'MARKETING', 'REINVERSION');

-- AlterEnum
ALTER TYPE "ReservationType" ADD VALUE 'DAYCARE';

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_userId_fkey";

-- AlterTable
ALTER TABLE "lodging_pricing" ADD COLUMN     "daycarePricePerDay" DECIMAL(10,2) NOT NULL DEFAULT 250,
ADD COLUMN     "priceProbarfLarge" DECIMAL(10,2) NOT NULL DEFAULT 400,
ADD COLUMN     "priceProbarfSmall" DECIMAL(10,2) NOT NULL DEFAULT 300;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "kind" "PaymentKind" NOT NULL DEFAULT 'FULL',
ADD COLUMN     "originLegacy" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "depositAgreed" DECIMAL(10,2),
ADD COLUMN     "originLegacy" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "originLegacy" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "hotel_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "hotelName" TEXT NOT NULL DEFAULT 'Holidog Inn',
    "maxCapacity" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "category" TEXT NOT NULL,
    "costType" "CostType" NOT NULL,
    "notes" TEXT,
    "originLegacy" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sponsorsBath" BOOLEAN NOT NULL DEFAULT false,
    "sponsorsKennel" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_date_idx" ON "expenses"("date");

-- CreateIndex
CREATE INDEX "expenses_category_idx" ON "expenses"("category");

-- CreateIndex
CREATE INDEX "expenses_costType_idx" ON "expenses"("costType");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
