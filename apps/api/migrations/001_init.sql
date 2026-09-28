CREATE TABLE IF NOT EXISTS sku (
  id text PRIMARY KEY,
  sku_code text NOT NULL UNIQUE,
  chinese_name text NOT NULL,
  brand text NOT NULL,
  category text NOT NULL,
  subcategory text NOT NULL,
  manufacturer_part_number text NOT NULL,
  primary_oe text NOT NULL,
  unit text NOT NULL DEFAULT '件',
  lifecycle_status text NOT NULL DEFAULT '草稿',
  barcode text,
  image_url text,
  data_source text,
  source_evidence jsonb,
  conflict_resolution jsonb,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS sku_updated_at_idx ON sku (updated_at DESC);
CREATE INDEX IF NOT EXISTS sku_primary_oe_idx ON sku (primary_oe);

CREATE TABLE IF NOT EXISTS sku_oe_relation (
  id text PRIMARY KEY,
  sku_id text NOT NULL REFERENCES sku(id) ON DELETE CASCADE,
  relation_type text NOT NULL,
  oe_number text NOT NULL,
  brand text NOT NULL DEFAULT '',
  relation text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  confidence text NOT NULL DEFAULT '待核验',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sku_oe_relation_sku_idx ON sku_oe_relation (sku_id, sort_order);
CREATE INDEX IF NOT EXISTS sku_oe_relation_number_idx ON sku_oe_relation (oe_number);

CREATE TABLE IF NOT EXISTS sku_fitment (
  id text PRIMARY KEY,
  sku_id text NOT NULL REFERENCES sku(id) ON DELETE CASCADE,
  vehicle text NOT NULL,
  years text NOT NULL DEFAULT '',
  engine text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  fitment_condition text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  verification_status text NOT NULL DEFAULT '待验证',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sku_fitment_sku_idx ON sku_fitment (sku_id, sort_order);
