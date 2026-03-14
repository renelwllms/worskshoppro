-- Add optional vehicle details to customers
ALTER TABLE "Customer" ADD COLUMN "vehicleBrand" TEXT;
ALTER TABLE "Customer" ADD COLUMN "vehicleModel" TEXT;
