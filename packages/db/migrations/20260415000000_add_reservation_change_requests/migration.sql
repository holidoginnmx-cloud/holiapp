-- AlterEnum: PaymentMethod
ALTER TYPE "PaymentMethod" ADD VALUE 'CREDIT';

-- AlterEnum: NotificationType
ALTER TYPE "NotificationType" ADD VALUE 'RESERVATION_CHANGE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'RESERVATION_CHANGE_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'RESERVATION_CHANGE_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'REFUND_ISSUED';
ALTER TYPE "NotificationType" ADD VALUE 'CREDIT_ADDED';
ALTER TYPE "NotificationType" ADD VALUE 'CREDIT_APPLIED';

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundChoice" AS ENUM ('STRIPE_REFUND', 'CREDIT');

-- CreateEnum
CREATE TYPE "CreditEntryType" AS ENUM ('CREDIT_ADDED', 'CREDIT_APPLIED', 'CREDIT_ADJUSTED');

-- AlterTable: User
ALTER TABLE "users" ADD COLUMN "creditBalance" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable: reservation_change_requests
CREATE TABLE "reservation_change_requests" (
    "id" TEXT NOT NULL,
    "newCheckIn" TIMESTAMP(3) NOT NULL,
    "newCheckOut" TIMESTAMP(3) NOT NULL,
    "newTotalDays" INTEGER NOT NULL,
    "newTotalAmount" DECIMAL(10,2) NOT NULL,
    "deltaAmount" DECIMAL(10,2) NOT NULL,
    "refundChoice" "RefundChoice",
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reservationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,

    CONSTRAINT "reservation_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reservation_change_requests_reservationId_status_idx" ON "reservation_change_requests"("reservationId", "status");

-- AddForeignKey
ALTER TABLE "reservation_change_requests" ADD CONSTRAINT "reservation_change_requests_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reservation_change_requests" ADD CONSTRAINT "reservation_change_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reservation_change_requests" ADD CONSTRAINT "reservation_change_requests_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: credit_ledger
CREATE TABLE "credit_ledger" (
    "id" TEXT NOT NULL,
    "type" "CreditEntryType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "reservationId" TEXT,
    "changeRequestId" TEXT,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_ledger_userId_createdAt_idx" ON "credit_ledger"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "reservation_change_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
