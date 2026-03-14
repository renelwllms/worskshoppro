ALTER TABLE "Setting"
ADD COLUMN "invoiceNumberStart" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Invoice"
ADD COLUMN "invoiceNumber" INTEGER;

WITH base AS (
  SELECT COALESCE((SELECT "invoiceNumberStart" FROM "Setting" WHERE id = 1), 1) AS start
),
ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "Invoice"
  WHERE "invoiceNumber" IS NULL
)
UPDATE "Invoice" i
SET "invoiceNumber" = base.start + ranked.rn - 1
FROM ranked, base
WHERE i.id = ranked.id;

CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
