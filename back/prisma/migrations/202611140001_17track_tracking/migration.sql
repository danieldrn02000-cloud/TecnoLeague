ALTER TABLE "pedidos"
  ADD COLUMN "tracking_number" TEXT,
  ADD COLUMN "tracking_carrier_name" TEXT,
  ADD COLUMN "tracking_carrier_id" INTEGER,
  ADD COLUMN "tracking_status" TEXT,
  ADD COLUMN "tracking_description" TEXT,
  ADD COLUMN "tracking_updated_at" TIMESTAMP(3);
