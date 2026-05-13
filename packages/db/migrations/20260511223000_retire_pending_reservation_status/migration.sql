-- Retire PENDING ReservationStatus. Deposit reservations now live in CONFIRMED
-- with a "saldo pendiente" badge surfaced from paymentType=DEPOSIT + hasBalance.

-- 1) Migrate any existing PENDING reservations to CONFIRMED.
UPDATE "reservations" SET "status" = 'CONFIRMED' WHERE "status" = 'PENDING';

-- 2) Replace the enum: Postgres no soporta DROP VALUE en un enum, así que
--    creamos un enum nuevo, swap, drop del viejo.
BEGIN;
CREATE TYPE "ReservationStatus_new" AS ENUM ('CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED');
ALTER TABLE "reservations" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "reservations" ALTER COLUMN "status" TYPE "ReservationStatus_new" USING ("status"::text::"ReservationStatus_new");
ALTER TYPE "ReservationStatus" RENAME TO "ReservationStatus_old";
ALTER TYPE "ReservationStatus_new" RENAME TO "ReservationStatus";
DROP TYPE "ReservationStatus_old";
ALTER TABLE "reservations" ALTER COLUMN "status" SET DEFAULT 'CONFIRMED';
COMMIT;
