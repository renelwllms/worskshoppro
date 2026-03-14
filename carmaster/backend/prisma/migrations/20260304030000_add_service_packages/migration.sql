CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "VehicleType" AS ENUM ('JAPANESE', 'EUROPEAN');
CREATE TYPE "ServicePackageInclusionType" AS ENUM ('INCLUDED_SERVICE', 'INCLUDED_UPSELL', 'CHECK_ITEM', 'NOTE');
CREATE TYPE "InvoiceInclusionMode" AS ENUM ('NOTES', 'LINE_ITEMS');

CREATE TABLE "service_packages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_package_prices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "servicePackageId" UUID NOT NULL,
  "vehicleType" "VehicleType" NOT NULL,
  "basePrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "priceType" "PriceType" NOT NULL DEFAULT 'FIXED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_package_prices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_package_inclusions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "servicePackageId" UUID NOT NULL,
  "type" "ServicePackageInclusionType" NOT NULL,
  "title" TEXT NOT NULL,
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_package_inclusions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_packages_name_key" ON "service_packages"("name");
CREATE UNIQUE INDEX "service_package_prices_servicePackageId_vehicleType_key" ON "service_package_prices"("servicePackageId", "vehicleType");
CREATE INDEX "service_package_inclusions_servicePackageId_sortOrder_idx" ON "service_package_inclusions"("servicePackageId", "sortOrder");

ALTER TABLE "Job"
  ADD COLUMN "selectedServicePackageId" UUID,
  ADD COLUMN "vehicleType" "VehicleType",
  ADD COLUMN "packageBasePriceSnapshot" DECIMAL(65,30),
  ADD COLUMN "packageVehicleTypeSnapshot" "VehicleType",
  ADD COLUMN "packagePriceTypeSnapshot" "PriceType",
  ADD COLUMN "packagePricingNotesSnapshot" TEXT;

ALTER TABLE "Setting"
  ADD COLUMN "packageInclusionInvoiceMode" "InvoiceInclusionMode" NOT NULL DEFAULT 'NOTES';

ALTER TABLE "service_package_prices"
  ADD CONSTRAINT "service_package_prices_servicePackageId_fkey"
  FOREIGN KEY ("servicePackageId") REFERENCES "service_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_package_inclusions"
  ADD CONSTRAINT "service_package_inclusions_servicePackageId_fkey"
  FOREIGN KEY ("servicePackageId") REFERENCES "service_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_selectedServicePackageId_fkey"
  FOREIGN KEY ("selectedServicePackageId") REFERENCES "service_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_service_selection_check"
  CHECK (
    (CASE WHEN "selectedServiceId" IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN "selectedServicePackageId" IS NULL THEN 0 ELSE 1 END) <= 1
  );
