-- Cuenta de la reserva: productos de la tienda cargados a una reserva y cobrados
-- junto con ella (Javier, 18-nov-2026). Ver packages/api/src/lib/reservationAccount.ts.
-- Aditiva: columna nullable + índice + FK; ningún dato existente cambia.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "reservationId" TEXT;

-- CreateIndex
CREATE INDEX "orders_reservationId_idx" ON "orders"("reservationId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

