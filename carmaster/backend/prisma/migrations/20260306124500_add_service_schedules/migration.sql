CREATE TYPE "ScheduleType" AS ENUM ('SERVICE', 'WOF', 'REGO');
CREATE TYPE "ReminderChannel" AS ENUM ('EMAIL', 'SMS');
CREATE TYPE "ReminderStatus" AS ENUM ('SENT', 'FAILED');

CREATE TABLE "ServiceSchedule" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "type" "ScheduleType" NOT NULL,
  "title" TEXT,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "sourceJobId" TEXT,
  "lastReminderAt" TIMESTAMP(3),
  "reminderCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReminderLog" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "channel" "ReminderChannel" NOT NULL DEFAULT 'EMAIL',
  "status" "ReminderStatus" NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceSchedule_customerId_type_key" ON "ServiceSchedule"("customerId", "type");
CREATE INDEX "ServiceSchedule_dueDate_idx" ON "ServiceSchedule"("dueDate");
CREATE INDEX "ServiceSchedule_type_idx" ON "ServiceSchedule"("type");
CREATE INDEX "ReminderLog_scheduleId_createdAt_idx" ON "ReminderLog"("scheduleId", "createdAt");

ALTER TABLE "ServiceSchedule"
  ADD CONSTRAINT "ServiceSchedule_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceSchedule"
  ADD CONSTRAINT "ServiceSchedule_sourceJobId_fkey"
  FOREIGN KEY ("sourceJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReminderLog"
  ADD CONSTRAINT "ReminderLog_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "ServiceSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
