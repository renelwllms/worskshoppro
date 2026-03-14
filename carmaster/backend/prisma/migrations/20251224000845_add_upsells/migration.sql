-- CreateEnum
CREATE TYPE "UpsellGroup" AS ENUM ('RECOMMENDED', 'OPTIONAL');

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "upsellLastServiceMonths" INTEGER DEFAULT 12,
ADD COLUMN     "upsellMileageThreshold" INTEGER DEFAULT 60000;

-- CreateTable
CREATE TABLE "UpsellOption" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "group" "UpsellGroup" NOT NULL DEFAULT 'OPTIONAL',
    "defaultSelected" BOOLEAN NOT NULL DEFAULT false,
    "suggestMileage" BOOLEAN NOT NULL DEFAULT false,
    "suggestLastService" BOOLEAN NOT NULL DEFAULT false,
    "suggestSeason" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpsellOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UpsellOption_name_key" ON "UpsellOption"("name");
