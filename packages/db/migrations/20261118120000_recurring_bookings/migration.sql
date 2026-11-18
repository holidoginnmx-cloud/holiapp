-- Citas recurrentes (baño / guardería). Pedido de Jessica, 2026-11-14:
-- clientes fijos con cita pactada ("un viernes sí y uno no") que hoy se
-- capturaban a mano cada vez. Ver packages/api/src/lib/recurringBookings.ts.
-- Aditiva: la API y la app viejas ignoran la tabla y las columnas nuevas.

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "recurrenceDate" TEXT,
ADD COLUMN     "recurringBookingId" TEXT;

-- CreateTable
CREATE TABLE "recurring_bookings" (
    "id" TEXT NOT NULL,
    "reservationType" "ReservationType" NOT NULL,
    "petIds" TEXT[],
    "intervalWeeks" INTEGER NOT NULL DEFAULT 1,
    "weekdays" INTEGER[],
    "anchorDate" TEXT NOT NULL,
    "endDate" TEXT,
    "startTime" TEXT,
    "deslanado" BOOLEAN NOT NULL DEFAULT false,
    "corte" BOOLEAN NOT NULL DEFAULT false,
    "checkInTime" TEXT,
    "checkOutTime" TEXT,
    "homeDelivery" BOOLEAN NOT NULL DEFAULT false,
    "homeDeliveryAddress" TEXT,
    "homeDeliveryLat" DOUBLE PRECISION,
    "homeDeliveryLng" DOUBLE PRECISION,
    "homeDeliveryPlaceId" TEXT,
    "homeDeliveryTrip" "DeliveryTrip" NOT NULL DEFAULT 'PICKUP',
    "chargeDelivery" BOOLEAN NOT NULL DEFAULT false,
    "totalAmountOverride" DECIMAL(10,2),
    "internalNotes" TEXT,
    "staffId" TEXT,
    "leadDays" INTEGER NOT NULL DEFAULT 7,
    "skipDates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "generatedThrough" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pausedReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_bookings_active_deletedAt_idx" ON "recurring_bookings"("active", "deletedAt");

-- CreateIndex
CREATE INDEX "recurring_bookings_ownerId_idx" ON "recurring_bookings"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_recurringBookingId_recurrenceDate_petId_key" ON "reservations"("recurringBookingId", "recurrenceDate", "petId");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_recurringBookingId_fkey" FOREIGN KEY ("recurringBookingId") REFERENCES "recurring_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_bookings" ADD CONSTRAINT "recurring_bookings_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_bookings" ADD CONSTRAINT "recurring_bookings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Igual que pet_invites: sin RLS, PostgREST expondría la tabla a la llave
-- pública `anon` (trae direcciones de clientes). El API y el panel se la
-- saltan, así que activarla sin políticas no les quita nada.
ALTER TABLE "recurring_bookings" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "recurring_bookings" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "recurring_bookings" FROM authenticated;
  END IF;
END $$;
