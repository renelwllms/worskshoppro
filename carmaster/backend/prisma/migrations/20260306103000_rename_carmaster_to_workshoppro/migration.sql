ALTER TABLE "Setting"
  ALTER COLUMN "pwaName" SET DEFAULT 'WorkshopPro Portal',
  ALTER COLUMN "pwaShortName" SET DEFAULT 'WorkshopPro';

UPDATE "Setting"
SET
  "businessName" = 'WorkshopPro',
  "pwaName" = 'WorkshopPro Portal',
  "pwaShortName" = 'WorkshopPro'
WHERE
  COALESCE("businessName", '') IN ('', 'Carmaster Automotive')
  OR COALESCE("pwaName", '') IN ('', 'Carmaster Portal')
  OR COALESCE("pwaShortName", '') IN ('', 'Carmaster');
