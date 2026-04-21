-- CreateEnum
CREATE TYPE "AddonPaymentSource" AS ENUM ('BOOKING', 'STANDALONE');

-- CreateEnum
CREATE TYPE "CartillaStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'STRIPE';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "stripePaymentIntentId" TEXT;

-- AlterTable
ALTER TABLE "pets" ADD COLUMN     "cartillaRejectionReason" TEXT,
ADD COLUMN     "cartillaReviewedAt" TIMESTAMP(3),
ADD COLUMN     "cartillaReviewedById" TEXT,
ADD COLUMN     "cartillaStatus" "CartillaStatus",
ADD COLUMN     "cartillaUrl" TEXT;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "depositDeadline" TIMESTAMP(3),
ADD COLUMN     "medicationNotes" TEXT,
ADD COLUMN     "paymentType" TEXT;

-- CreateTable
CREATE TABLE "service_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_variants" (
    "id" TEXT NOT NULL,
    "petSize" "PetSize" NOT NULL,
    "deslanado" BOOLEAN NOT NULL,
    "corte" BOOLEAN NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "serviceTypeId" TEXT NOT NULL,

    CONSTRAINT "service_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_addons" (
    "id" TEXT NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "paidWith" "AddonPaymentSource" NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "paymentId" TEXT,

    CONSTRAINT "reservation_addons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_types_code_key" ON "service_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "service_variants_serviceTypeId_petSize_deslanado_corte_key" ON "service_variants"("serviceTypeId", "petSize", "deslanado", "corte");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripePaymentIntentId_key" ON "payments"("stripePaymentIntentId");

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_cartillaReviewedById_fkey" FOREIGN KEY ("cartillaReviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_variants" ADD CONSTRAINT "service_variants_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "service_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_addons" ADD CONSTRAINT "reservation_addons_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_addons" ADD CONSTRAINT "reservation_addons_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "service_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_addons" ADD CONSTRAINT "reservation_addons_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

