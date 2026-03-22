CREATE TABLE "InvoiceJob" (
    "invoiceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceJob_pkey" PRIMARY KEY ("invoiceId","jobId")
);

CREATE INDEX "InvoiceJob_jobId_idx" ON "InvoiceJob"("jobId");

ALTER TABLE "InvoiceJob"
ADD CONSTRAINT "InvoiceJob_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceJob"
ADD CONSTRAINT "InvoiceJob_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "InvoiceJob" ("invoiceId", "jobId")
SELECT "id", "jobId"
FROM "Invoice"
WHERE "jobId" IS NOT NULL
ON CONFLICT ("invoiceId", "jobId") DO NOTHING;
