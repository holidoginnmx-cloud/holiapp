-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "cardBrand" TEXT,
ADD COLUMN     "cardFeeAmount" DECIMAL,
ADD COLUMN     "cardFeePct" DECIMAL;

-- AlterTable
ALTER TABLE "lodging_pricing" ADD COLUMN     "cardFeeAmexPct" DECIMAL NOT NULL DEFAULT 0.029,
ADD COLUMN     "cardFeeCreditPct" DECIMAL NOT NULL DEFAULT 0.0227,
ADD COLUMN     "cardFeeDebitPct" DECIMAL NOT NULL DEFAULT 0.0186,
ADD COLUMN     "cardFeeIvaIncluded" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "daycareExtraHourPrice" SET DEFAULT 0,
ALTER COLUMN "daycareExtraHourPrice" SET DATA TYPE DECIMAL;

-- AlterTable
ALTER TABLE "expense_categories" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "app_access" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "clerkUserId" TEXT,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(6),
    "decidedBy" TEXT,

    CONSTRAINT "app_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_charges" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "cardFeeAmount" DECIMAL NOT NULL DEFAULT 0,
    "cardFeePct" DECIMAL,
    "cardBrand" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'ABONO',
    "notes" TEXT,
    "trxAmount" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "trxAuth" TEXT,
    "trxCardBrand" TEXT,
    "trxCardInstrument" TEXT,
    "trxOriginalNumber" TEXT,
    "trxResultCode" TEXT,
    "trxDescription" TEXT,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(6),
    "reservationId" TEXT NOT NULL,
    "userId" TEXT,
    "paymentId" TEXT,

    CONSTRAINT "terminal_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_access_email_key" ON "app_access"("email");

-- CreateIndex
CREATE UNIQUE INDEX "terminal_charges_reference_key" ON "terminal_charges"("reference");

-- CreateIndex
CREATE INDEX "terminal_charges_reference_idx" ON "terminal_charges"("reference");

-- CreateIndex
CREATE INDEX "terminal_charges_reservation_idx" ON "terminal_charges"("reservationId");

-- AddForeignKey
ALTER TABLE "terminal_charges" ADD CONSTRAINT "terminal_charges_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "terminal_charges" ADD CONSTRAINT "terminal_charges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "terminal_charges" ADD CONSTRAINT "terminal_charges_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

