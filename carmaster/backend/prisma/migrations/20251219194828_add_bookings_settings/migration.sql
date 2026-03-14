-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "bookingsBusinessId" TEXT,
ADD COLUMN     "bookingsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bookingsPageUrl" TEXT;
