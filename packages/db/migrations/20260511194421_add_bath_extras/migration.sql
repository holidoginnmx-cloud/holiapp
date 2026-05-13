-- CreateEnum
CREATE TYPE "AddonExtraPaymentStatus" AS ENUM ('PENDING_PAYMENT', 'PAY_ON_PICKUP', 'PAID');

-- AlterTable
ALTER TABLE "reservation_addons" ADD COLUMN     "extraDescription" TEXT,
ADD COLUMN     "extraPaidAt" TIMESTAMP(3),
ADD COLUMN     "extraPaymentStatus" "AddonExtraPaymentStatus",
ADD COLUMN     "extraPrice" DECIMAL(10,2),
ADD COLUMN     "extraSetAt" TIMESTAMP(3),
ADD COLUMN     "extraSetById" TEXT,
ADD COLUMN     "extraStripePaymentIntentId" TEXT;

-- AddForeignKey
ALTER TABLE "reservation_addons" ADD CONSTRAINT "reservation_addons_extraSetById_fkey" FOREIGN KEY ("extraSetById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
