CREATE TABLE IF NOT EXISTS business_sales_order (
  id text PRIMARY KEY,
  order_no text NOT NULL UNIQUE,
  inquiry_id text NOT NULL UNIQUE REFERENCES business_inquiry(id) ON DELETE RESTRICT,
  quote_id text NOT NULL UNIQUE REFERENCES business_quote(id) ON DELETE RESTRICT,
  customer_partner_id text REFERENCES business_partner(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  contact_name text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  customer_vehicle_id text REFERENCES business_customer_vehicle(id) ON DELETE SET NULL,
  vehicle_label text NOT NULL DEFAULT '',
  vin text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','fulfilling','completed','cancelled')),
  currency text NOT NULL DEFAULT 'CNY',
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  freight_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (freight_amount >= 0),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  notes text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  updated_by_id text NOT NULL,
  updated_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_sales_order_item (
  id text PRIMARY KEY,
  sales_order_id text NOT NULL REFERENCES business_sales_order(id) ON DELETE CASCADE,
  quote_item_id text NOT NULL UNIQUE REFERENCES business_quote_item(id) ON DELETE RESTRICT,
  inquiry_item_id text NOT NULL REFERENCES business_inquiry_item(id) ON DELETE RESTRICT,
  catalog_sku_id text REFERENCES catalog_sku(id) ON DELETE SET NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  description text NOT NULL,
  oe_number text NOT NULL DEFAULT '',
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  sale_unit_price numeric(14,2) NOT NULL CHECK (sale_unit_price >= 0),
  line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
  UNIQUE (sales_order_id,line_no)
);

CREATE TABLE IF NOT EXISTS business_purchase_order (
  id text PRIMARY KEY,
  order_no text NOT NULL UNIQUE,
  inquiry_id text NOT NULL REFERENCES business_inquiry(id) ON DELETE RESTRICT,
  sales_order_id text NOT NULL REFERENCES business_sales_order(id) ON DELETE RESTRICT,
  supplier_partner_id text REFERENCES business_partner(id) ON DELETE SET NULL,
  supplier_name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','confirmed','partially_received','received','cancelled')),
  currency text NOT NULL DEFAULT 'CNY',
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  freight_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (freight_amount >= 0),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  expected_at date,
  notes text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  updated_by_id text NOT NULL,
  updated_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_purchase_order_item (
  id text PRIMARY KEY,
  purchase_order_id text NOT NULL REFERENCES business_purchase_order(id) ON DELETE CASCADE,
  inquiry_item_id text NOT NULL REFERENCES business_inquiry_item(id) ON DELETE RESTRICT,
  supplier_offer_id text NOT NULL UNIQUE REFERENCES business_supplier_offer(id) ON DELETE RESTRICT,
  catalog_sku_id text REFERENCES catalog_sku(id) ON DELETE SET NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  description text NOT NULL,
  oe_number text NOT NULL DEFAULT '',
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  cost_unit_price numeric(14,2) NOT NULL CHECK (cost_unit_price >= 0),
  line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
  received_quantity numeric(12,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0 AND received_quantity <= quantity),
  UNIQUE (purchase_order_id,line_no)
);

CREATE TABLE IF NOT EXISTS business_order_event (
  id text PRIMARY KEY,
  order_type text NOT NULL CHECK (order_type IN ('sales','purchase')),
  sales_order_id text REFERENCES business_sales_order(id) ON DELETE CASCADE,
  purchase_order_id text REFERENCES business_purchase_order(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text NOT NULL DEFAULT '',
  to_status text NOT NULL DEFAULT '',
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  note text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (order_type='sales' AND sales_order_id IS NOT NULL AND purchase_order_id IS NULL)
    OR (order_type='purchase' AND purchase_order_id IS NOT NULL AND sales_order_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS business_sales_order_status_updated_idx ON business_sales_order(status,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_sales_order_customer_idx ON business_sales_order(customer_partner_id,updated_at DESC) WHERE customer_partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_purchase_order_sales_idx ON business_purchase_order(sales_order_id,created_at);
CREATE INDEX IF NOT EXISTS business_purchase_order_status_updated_idx ON business_purchase_order(status,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_purchase_order_supplier_idx ON business_purchase_order(supplier_partner_id,updated_at DESC) WHERE supplier_partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_sales_order_event_idx ON business_order_event(sales_order_id,created_at DESC) WHERE sales_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_purchase_order_event_idx ON business_order_event(purchase_order_id,created_at DESC) WHERE purchase_order_id IS NOT NULL;
