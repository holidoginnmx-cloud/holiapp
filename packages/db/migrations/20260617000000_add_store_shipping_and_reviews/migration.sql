-- AlterTable: orders — dirección de envío (LOCAL_DELIVERY / NATIONAL_SHIPPING) + rastreo
ALTER TABLE "orders" ADD COLUMN     "shippingAddress" TEXT,
ADD COLUMN     "shippingLat" DOUBLE PRECISION,
ADD COLUMN     "shippingLng" DOUBLE PRECISION,
ADD COLUMN     "shippingPlaceId" TEXT,
ADD COLUMN     "trackingCarrier" TEXT,
ADD COLUMN     "trackingNumber" TEXT;

-- AlterTable: delivery_config — tarifa plana de envío nacional
ALTER TABLE "delivery_config" ADD COLUMN     "nationalShippingFee" DECIMAL(10,2);

-- CreateTable: product_reviews
CREATE TABLE "product_reviews" (
    "id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "orderId" TEXT,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_reviews_productId_isApproved_idx" ON "product_reviews"("productId", "isApproved");

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
