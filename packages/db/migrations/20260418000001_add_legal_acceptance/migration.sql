-- CreateEnum
CREATE TYPE "LegalDocumentType" AS ENUM ('TOS', 'PRIVACY', 'IMAGE_USE', 'VET_AUTH');

-- CreateTable
CREATE TABLE "legal_acceptances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentType" "LegalDocumentType" NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_acceptances_userId_documentType_idx" ON "legal_acceptances"("userId", "documentType");

-- CreateIndex
CREATE UNIQUE INDEX "legal_acceptances_userId_documentType_version_key" ON "legal_acceptances"("userId", "documentType", "version");

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
