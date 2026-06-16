-- CreateTable
CREATE TABLE "PendingDeliveryAddress" (
    "paymentIntentId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingDeliveryAddress_pkey" PRIMARY KEY ("paymentIntentId")
);
