ALTER TABLE "Customer" ALTER COLUMN "rego" DROP NOT NULL;

ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS "Customer_rego_key";

CREATE TABLE "Vehicle" (
  "id" TEXT NOT NULL,
  "rego" TEXT NOT NULL,
  "vehicleBrand" TEXT,
  "vehicleModel" TEXT,
  "customerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Vehicle_rego_key" ON "Vehicle"("rego");
CREATE INDEX "Vehicle_customerId_idx" ON "Vehicle"("customerId");

ALTER TABLE "Vehicle"
  ADD CONSTRAINT "Vehicle_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Job" ADD COLUMN "vehicleId" TEXT;

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Vehicle" ("id", "rego", "vehicleBrand", "vehicleModel", "customerId", "createdAt", "updatedAt")
SELECT
  'veh_' || md5("id" || COALESCE("rego", '')),
  "rego",
  "vehicleBrand",
  "vehicleModel",
  "id",
  "createdAt",
  "updatedAt"
FROM "Customer"
WHERE "rego" IS NOT NULL;

UPDATE "Job" j
SET "vehicleId" = v."id"
FROM "Vehicle" v
WHERE v."customerId" = j."customerId"
  AND j."vehicleId" IS NULL;
