CREATE TABLE "ActivityLog" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUCCESS',
  "entity" TEXT NOT NULL,
  "entityId" TEXT,
  "actorId" TEXT,
  "actorEmail" TEXT,
  "actorName" TEXT,
  "actorRole" TEXT,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
CREATE INDEX "ActivityLog_action_createdAt_idx" ON "ActivityLog"("action", "createdAt");
CREATE INDEX "ActivityLog_entity_createdAt_idx" ON "ActivityLog"("entity", "createdAt");
CREATE INDEX "ActivityLog_actorEmail_createdAt_idx" ON "ActivityLog"("actorEmail", "createdAt");
