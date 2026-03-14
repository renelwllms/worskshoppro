ALTER TABLE "Setting"
  ALTER COLUMN "pwaName" SET DEFAULT 'workshopPro Portal',
  ALTER COLUMN "pwaShortName" SET DEFAULT 'workshopPro';

UPDATE "Setting"
SET "businessName" = 'Carmaster'
WHERE COALESCE("businessName", '') IN ('', 'WorkshopPro', 'workshopPro', 'Carmaster Automotive');

UPDATE "Setting"
SET "pwaName" = 'workshopPro Portal'
WHERE COALESCE("pwaName", '') IN ('', 'Carmaster Portal', 'WorkshopPro Portal');

UPDATE "Setting"
SET "pwaShortName" = 'workshopPro'
WHERE COALESCE("pwaShortName", '') IN ('', 'Carmaster', 'WorkshopPro');
