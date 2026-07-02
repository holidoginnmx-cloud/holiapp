-- AlterTable: reservations — código de descuento aplicado + monto descontado
-- atribuido a esta reserva (proporcional en grupos multi-mascota). totalAmount neto.
ALTER TABLE "reservations" ADD COLUMN     "discountCodeId" TEXT,
ADD COLUMN     "discountTotal" DECIMAL(10,2);

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
