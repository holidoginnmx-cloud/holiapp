-- AlterTable
ALTER TABLE "vaccines" ADD COLUMN     "reminded0dAt" TIMESTAMP(3),
ADD COLUMN     "reminded30dAt" TIMESTAMP(3),
ADD COLUMN     "reminded7dAt" TIMESTAMP(3);
