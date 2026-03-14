/*
  Warnings:

  - You are about to drop the column `active` on the `UpsellOption` table. All the data in the column will be lost.
  - You are about to drop the column `defaultSelected` on the `UpsellOption` table. All the data in the column will be lost.
  - You are about to drop the column `group` on the `UpsellOption` table. All the data in the column will be lost.
  - You are about to drop the column `suggestLastService` on the `UpsellOption` table. All the data in the column will be lost.
  - You are about to drop the column `suggestMileage` on the `UpsellOption` table. All the data in the column will be lost.
  - You are about to drop the column `suggestSeason` on the `UpsellOption` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[jobNumber]` on the table `Job` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('FIXED', 'FROM', 'QUOTE_REQUIRED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('MAINTENANCE', 'REPAIR');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "jobNumber" TEXT,
ADD COLUMN     "jobType" "JobType",
ADD COLUMN     "odometerKm" INTEGER,
ADD COLUMN     "pricingSnapshot" JSONB,
ADD COLUMN     "regoExpiryDate" TIMESTAMP(3),
ADD COLUMN     "selectedServiceId" TEXT,
ADD COLUMN     "wofExpiryDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ServiceCategory" ADD COLUMN     "basePrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "durationMinutes" INTEGER,
ADD COLUMN     "priceType" "PriceType" NOT NULL DEFAULT 'FIXED';

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "invoiceEmailTemplate" TEXT,
ADD COLUMN     "pwaIconMaskableUrl" TEXT,
ADD COLUMN     "pwaIconUrl" TEXT,
ADD COLUMN     "quoteEmailTemplate" TEXT;

-- AlterTable
ALTER TABLE "UpsellOption" DROP COLUMN "active",
DROP COLUMN "defaultSelected",
DROP COLUMN "group",
DROP COLUMN "suggestLastService",
DROP COLUMN "suggestMileage",
DROP COLUMN "suggestSeason",
ADD COLUMN     "applicabilityRules" JSONB,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "price" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "priceType" "PriceType" NOT NULL DEFAULT 'FIXED';

-- DropEnum
DROP TYPE "UpsellGroup";

-- CreateTable
CREATE TABLE "JobUpsell" (
    "jobId" TEXT NOT NULL,
    "upsellId" TEXT NOT NULL,

    CONSTRAINT "JobUpsell_pkey" PRIMARY KEY ("jobId","upsellId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_jobNumber_key" ON "Job"("jobNumber");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_selectedServiceId_fkey" FOREIGN KEY ("selectedServiceId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobUpsell" ADD CONSTRAINT "JobUpsell_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobUpsell" ADD CONSTRAINT "JobUpsell_upsellId_fkey" FOREIGN KEY ("upsellId") REFERENCES "UpsellOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
