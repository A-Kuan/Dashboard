CREATE TABLE IF NOT EXISTS business_partner (
  id text PRIMARY KEY,
  partner_no text NOT NULL UNIQUE,
  partner_type text NOT NULL CHECK (partner_type IN ('customer','supplier','both')),
  name text NOT NULL,
  short_name text NOT NULL DEFAULT '',
  tax_id text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','blocked')),
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  credit_limit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  notes text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  updated_by_id text NOT NULL,
  updated_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_partner_contact (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES business_partner(id) ON DELETE CASCADE,
  name text NOT NULL,
  role_title text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  wechat text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  is_primary boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_customer_vehicle (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES business_partner(id) ON DELETE CASCADE,
  vehicle_label text NOT NULL,
  vin text NOT NULL DEFAULT '',
  license_plate text NOT NULL DEFAULT '',
  platform_code text NOT NULL DEFAULT '',
  engine_code text NOT NULL DEFAULT '',
  model_year integer CHECK (model_year IS NULL OR model_year BETWEEN 1950 AND 2200),
  notes text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_partner_event (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES business_partner(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  note text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE business_inquiry ADD COLUMN IF NOT EXISTS customer_partner_id text REFERENCES business_partner(id) ON DELETE SET NULL;
ALTER TABLE business_inquiry ADD COLUMN IF NOT EXISTS customer_vehicle_id text REFERENCES business_customer_vehicle(id) ON DELETE SET NULL;
ALTER TABLE business_supplier_offer ADD COLUMN IF NOT EXISTS supplier_partner_id text REFERENCES business_partner(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS business_partner_type_status_idx ON business_partner(partner_type,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_partner_name_idx ON business_partner(lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS business_partner_tax_id_unique_idx ON business_partner(tax_id) WHERE tax_id <> '';
CREATE INDEX IF NOT EXISTS business_partner_contact_partner_idx ON business_partner_contact(partner_id,is_primary DESC,created_at);
CREATE INDEX IF NOT EXISTS business_customer_vehicle_partner_idx ON business_customer_vehicle(partner_id,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS business_customer_vehicle_vin_unique_idx ON business_customer_vehicle(vin) WHERE vin <> '';
CREATE INDEX IF NOT EXISTS business_partner_event_idx ON business_partner_event(partner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS business_inquiry_customer_partner_idx ON business_inquiry(customer_partner_id,updated_at DESC) WHERE customer_partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_supplier_offer_partner_idx ON business_supplier_offer(supplier_partner_id,created_at DESC) WHERE supplier_partner_id IS NOT NULL;
