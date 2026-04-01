ALTER TABLE "ServiceSchedule" ADD COLUMN "vehicleId" TEXT;

UPDATE "ServiceSchedule" s
SET "vehicleId" = j."vehicleId"
FROM "Job" j
WHERE j."id" = s."sourceJobId"
  AND s."vehicleId" IS NULL;

DELETE FROM "ReminderLog"
WHERE "scheduleId" IN (
  SELECT "id"
  FROM "ServiceSchedule"
  WHERE "vehicleId" IS NULL
);

DELETE FROM "ServiceSchedule"
WHERE "vehicleId" IS NULL;

ALTER TABLE "ServiceSchedule"
  ALTER COLUMN "vehicleId" SET NOT NULL;

ALTER TABLE "ServiceSchedule" DROP CONSTRAINT IF EXISTS "ServiceSchedule_customerId_type_key";

CREATE INDEX "ServiceSchedule_customerId_idx" ON "ServiceSchedule"("customerId");
CREATE INDEX "ServiceSchedule_vehicleId_idx" ON "ServiceSchedule"("vehicleId");
CREATE UNIQUE INDEX "ServiceSchedule_vehicleId_type_key" ON "ServiceSchedule"("vehicleId", "type");

ALTER TABLE "ServiceSchedule"
  ADD CONSTRAINT "ServiceSchedule_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
