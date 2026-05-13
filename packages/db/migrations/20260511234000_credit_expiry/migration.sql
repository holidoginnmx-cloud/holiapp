-- Add CREDIT_EXPIRED to the CreditEntryType enum.
ALTER TYPE "CreditEntryType" ADD VALUE 'CREDIT_EXPIRED';

-- Track last credit activity per user so the cron can expire idle balances.
ALTER TABLE "users" ADD COLUMN "lastCreditEntryAt" TIMESTAMP(3);

-- Seed lastCreditEntryAt with the latest credit_ledger entry per user, so
-- users with balance are not expired before the first 90-day window.
UPDATE "users" u
SET "lastCreditEntryAt" = (
  SELECT MAX("createdAt")
  FROM "credit_ledger" l
  WHERE l."userId" = u.id
);
