ALTER TABLE business_customer_vehicle
  ADD COLUMN IF NOT EXISTS platform_master_id text REFERENCES catalog_vehicle_platform(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variant_master_id text REFERENCES catalog_vehicle_variant(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS business_customer_vehicle_platform_master_idx
  ON business_customer_vehicle(platform_master_id,updated_at DESC)
  WHERE platform_master_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS business_customer_vehicle_variant_master_idx
  ON business_customer_vehicle(variant_master_id,updated_at DESC)
  WHERE variant_master_id IS NOT NULL;

ALTER TABLE business_inquiry
  ADD COLUMN IF NOT EXISTS vehicle_platform_id text REFERENCES catalog_vehicle_platform(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_variant_id text REFERENCES catalog_vehicle_variant(id) ON DELETE SET NULL;

ALTER TABLE business_inquiry_item
  ADD COLUMN IF NOT EXISTS catalog_sku_version integer,
  ADD COLUMN IF NOT EXISTS sku_code_snapshot text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sku_name_snapshot text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS brand_snapshot text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS fitment_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE business_quote
  ADD COLUMN IF NOT EXISTS creation_mode text NOT NULL DEFAULT 'standard'
    CHECK (creation_mode IN ('standard','quick')),
  ADD COLUMN IF NOT EXISTS request_key text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS business_quote_request_key_unique_idx
  ON business_quote(request_key)
  WHERE request_key <> '';

ALTER TABLE business_quote_item
  ADD COLUMN IF NOT EXISTS catalog_sku_id text REFERENCES catalog_sku(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS catalog_sku_version integer,
  ADD COLUMN IF NOT EXISTS sku_code_snapshot text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sku_name_snapshot text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS brand_snapshot text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS fitment_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS business_quote_item_catalog_sku_idx
  ON business_quote_item(catalog_sku_id,quote_id)
  WHERE catalog_sku_id IS NOT NULL;
