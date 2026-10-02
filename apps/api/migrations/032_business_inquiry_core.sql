CREATE TABLE IF NOT EXISTS business_inquiry (
  id text PRIMARY KEY,
  inquiry_no text NOT NULL UNIQUE,
  customer_name text NOT NULL,
  contact_name text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  channel text NOT NULL DEFAULT 'manual',
  vehicle_label text NOT NULL DEFAULT '',
  vin text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','sourcing','quoting','quoted','follow_up','won','lost','cancelled')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
  assigned_to text NOT NULL DEFAULT '',
  next_action text NOT NULL DEFAULT '',
  next_action_at timestamptz,
  notes text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'CNY',
  quote_amount numeric(14,2),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  updated_by_id text NOT NULL,
  updated_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_inquiry_item (
  id text PRIMARY KEY,
  inquiry_id text NOT NULL REFERENCES business_inquiry(id) ON DELETE CASCADE,
  line_no integer NOT NULL CHECK (line_no > 0),
  requirement_text text NOT NULL,
  oe_number text NOT NULL DEFAULT '',
  requested_quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (requested_quantity > 0),
  unit text NOT NULL DEFAULT '件',
  target_brand text NOT NULL DEFAULT '',
  catalog_sku_id text REFERENCES catalog_sku(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inquiry_id,line_no)
);

CREATE TABLE IF NOT EXISTS business_supplier_offer (
  id text PRIMARY KEY,
  inquiry_id text NOT NULL REFERENCES business_inquiry(id) ON DELETE CASCADE,
  inquiry_item_id text NOT NULL REFERENCES business_inquiry_item(id) ON DELETE CASCADE,
  supplier_name text NOT NULL,
  brand_label text NOT NULL DEFAULT '',
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  freight_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (freight_amount >= 0),
  availability text NOT NULL DEFAULT 'unknown' CHECK (availability IN ('in_stock','ordered','backorder','unknown')),
  lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  valid_until date,
  source_note text NOT NULL DEFAULT '',
  selected boolean NOT NULL DEFAULT false,
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_quote (
  id text PRIMARY KEY,
  inquiry_id text NOT NULL REFERENCES business_inquiry(id) ON DELETE RESTRICT,
  quote_no text NOT NULL UNIQUE,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','sent','accepted','rejected','expired')),
  currency text NOT NULL DEFAULT 'CNY',
  valid_until date,
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  freight_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (freight_amount >= 0),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  margin_amount numeric(14,2) NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',
  sent_at timestamptz,
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_quote_item (
  id text PRIMARY KEY,
  quote_id text NOT NULL REFERENCES business_quote(id) ON DELETE CASCADE,
  inquiry_item_id text NOT NULL REFERENCES business_inquiry_item(id) ON DELETE RESTRICT,
  supplier_offer_id text REFERENCES business_supplier_offer(id) ON DELETE SET NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  description text NOT NULL,
  oe_number text NOT NULL DEFAULT '',
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  cost_unit_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost_unit_price >= 0),
  sale_unit_price numeric(14,2) NOT NULL CHECK (sale_unit_price >= 0),
  line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
  UNIQUE (quote_id,line_no)
);

CREATE TABLE IF NOT EXISTS business_inquiry_event (
  id text PRIMARY KEY,
  inquiry_id text NOT NULL REFERENCES business_inquiry(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text NOT NULL DEFAULT '',
  to_status text NOT NULL DEFAULT '',
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  note text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_inquiry_status_updated_idx ON business_inquiry(status,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_inquiry_customer_idx ON business_inquiry(customer_name,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_inquiry_next_action_idx ON business_inquiry(next_action_at) WHERE next_action_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_supplier_offer_inquiry_idx ON business_supplier_offer(inquiry_id,inquiry_item_id,created_at DESC);
CREATE INDEX IF NOT EXISTS business_quote_inquiry_idx ON business_quote(inquiry_id,created_at DESC);
CREATE INDEX IF NOT EXISTS business_inquiry_event_idx ON business_inquiry_event(inquiry_id,created_at DESC);
