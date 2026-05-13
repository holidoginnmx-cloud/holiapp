-- Track owner's payment choice after approval of extension change requests.
ALTER TABLE "reservation_change_requests"
  ADD COLUMN "payOnPickup" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "paidAt" TIMESTAMP(3);
