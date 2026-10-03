CREATE TABLE IF NOT EXISTS business_warehouse (
  id text PRIMARY KEY,
  warehouse_code text NOT NULL UNIQUE,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  is_default boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  updated_by_id text NOT NULL,
  updated_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_warehouse_default_unique_idx ON business_warehouse(is_default) WHERE is_default=true;
CREATE INDEX IF NOT EXISTS business_warehouse_status_idx ON business_warehouse(status,updated_at DESC);

CREATE TABLE IF NOT EXISTS business_goods_receipt (
  id text PRIMARY KEY,
  receipt_no text NOT NULL UNIQUE,
  source_request_id text NOT NULL UNIQUE,
  purchase_order_id text NOT NULL REFERENCES business_purchase_order(id) ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES business_warehouse(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'posted' CHECK (status='posted'),
  note text NOT NULL DEFAULT '',
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_inventory_lot (
  id text PRIMARY KEY,
  lot_no text NOT NULL UNIQUE,
  warehouse_id text NOT NULL REFERENCES business_warehouse(id) ON DELETE RESTRICT,
  goods_receipt_id text NOT NULL REFERENCES business_goods_receipt(id) ON DELETE RESTRICT,
  purchase_order_item_id text NOT NULL REFERENCES business_purchase_order_item(id) ON DELETE RESTRICT,
  stock_key text NOT NULL,
  catalog_sku_id text REFERENCES catalog_sku(id) ON DELETE SET NULL,
  description text NOT NULL,
  oe_number text NOT NULL DEFAULT '',
  unit text NOT NULL,
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  received_quantity numeric(12,3) NOT NULL CHECK (received_quantity > 0),
  on_hand_quantity numeric(12,3) NOT NULL CHECK (on_hand_quantity >= 0),
  reserved_quantity numeric(12,3) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reserved_quantity <= on_hand_quantity)
);

CREATE TABLE IF NOT EXISTS business_goods_receipt_item (
  id text PRIMARY KEY,
  goods_receipt_id text NOT NULL REFERENCES business_goods_receipt(id) ON DELETE RESTRICT,
  purchase_order_item_id text NOT NULL REFERENCES business_purchase_order_item(id) ON DELETE RESTRICT,
  inventory_lot_id text NOT NULL UNIQUE REFERENCES business_inventory_lot(id) ON DELETE RESTRICT,
  received_quantity numeric(12,3) NOT NULL CHECK (received_quantity > 0),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
  UNIQUE (goods_receipt_id,purchase_order_item_id)
);

CREATE TABLE IF NOT EXISTS business_inventory_balance (
  id text PRIMARY KEY,
  warehouse_id text NOT NULL REFERENCES business_warehouse(id) ON DELETE RESTRICT,
  stock_key text NOT NULL,
  catalog_sku_id text REFERENCES catalog_sku(id) ON DELETE SET NULL,
  description text NOT NULL,
  oe_number text NOT NULL DEFAULT '',
  unit text NOT NULL,
  on_hand_quantity numeric(12,3) NOT NULL DEFAULT 0 CHECK (on_hand_quantity >= 0),
  reserved_quantity numeric(12,3) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reserved_quantity <= on_hand_quantity),
  UNIQUE (warehouse_id,stock_key)
);

CREATE TABLE IF NOT EXISTS business_stock_reservation (
  id text PRIMARY KEY,
  reservation_no text NOT NULL UNIQUE,
  sales_order_id text NOT NULL REFERENCES business_sales_order(id) ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES business_warehouse(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','fulfilled')),
  note text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  updated_by_id text NOT NULL,
  updated_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_stock_reservation_active_unique_idx ON business_stock_reservation(sales_order_id) WHERE status='active';

CREATE TABLE IF NOT EXISTS business_stock_reservation_item (
  id text PRIMARY KEY,
  reservation_id text NOT NULL REFERENCES business_stock_reservation(id) ON DELETE RESTRICT,
  sales_order_item_id text NOT NULL REFERENCES business_sales_order_item(id) ON DELETE RESTRICT,
  stock_key text NOT NULL,
  requested_quantity numeric(12,3) NOT NULL CHECK (requested_quantity > 0),
  reserved_quantity numeric(12,3) NOT NULL CHECK (reserved_quantity >= 0 AND reserved_quantity <= requested_quantity),
  shortage_quantity numeric(12,3) NOT NULL CHECK (shortage_quantity >= 0),
  fulfilled_quantity numeric(12,3) NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0),
  CHECK (reserved_quantity + shortage_quantity = requested_quantity),
  CHECK (fulfilled_quantity <= reserved_quantity),
  UNIQUE (reservation_id,sales_order_item_id)
);

CREATE TABLE IF NOT EXISTS business_stock_reservation_allocation (
  id text PRIMARY KEY,
  reservation_item_id text NOT NULL REFERENCES business_stock_reservation_item(id) ON DELETE RESTRICT,
  inventory_lot_id text NOT NULL REFERENCES business_inventory_lot(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  fulfilled_quantity numeric(12,3) NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0 AND fulfilled_quantity <= quantity),
  UNIQUE (reservation_item_id,inventory_lot_id)
);

CREATE TABLE IF NOT EXISTS business_shipment (
  id text PRIMARY KEY,
  shipment_no text NOT NULL UNIQUE,
  source_request_id text NOT NULL UNIQUE,
  sales_order_id text NOT NULL REFERENCES business_sales_order(id) ON DELETE RESTRICT,
  reservation_id text NOT NULL REFERENCES business_stock_reservation(id) ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES business_warehouse(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'posted' CHECK (status='posted'),
  note text NOT NULL DEFAULT '',
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_shipment_item (
  id text PRIMARY KEY,
  shipment_id text NOT NULL REFERENCES business_shipment(id) ON DELETE RESTRICT,
  sales_order_item_id text NOT NULL REFERENCES business_sales_order_item(id) ON DELETE RESTRICT,
  inventory_lot_id text NOT NULL REFERENCES business_inventory_lot(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  UNIQUE (shipment_id,sales_order_item_id,inventory_lot_id)
);

CREATE TABLE IF NOT EXISTS business_inventory_movement (
  id text PRIMARY KEY,
  warehouse_id text NOT NULL REFERENCES business_warehouse(id) ON DELETE RESTRICT,
  stock_key text NOT NULL,
  inventory_lot_id text REFERENCES business_inventory_lot(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('receipt','reserve','release','ship','adjustment')),
  on_hand_delta numeric(12,3) NOT NULL DEFAULT 0,
  reserved_delta numeric(12,3) NOT NULL DEFAULT 0,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  note text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (on_hand_delta <> 0 OR reserved_delta <> 0)
);

CREATE INDEX IF NOT EXISTS business_goods_receipt_purchase_idx ON business_goods_receipt(purchase_order_id,created_at DESC);
CREATE INDEX IF NOT EXISTS business_inventory_lot_stock_idx ON business_inventory_lot(warehouse_id,stock_key,received_at,id);
CREATE INDEX IF NOT EXISTS business_inventory_balance_lookup_idx ON business_inventory_balance(warehouse_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_stock_reservation_sales_idx ON business_stock_reservation(sales_order_id,created_at DESC);
CREATE INDEX IF NOT EXISTS business_shipment_sales_idx ON business_shipment(sales_order_id,created_at DESC);
CREATE INDEX IF NOT EXISTS business_inventory_movement_lookup_idx ON business_inventory_movement(warehouse_id,stock_key,created_at DESC,id DESC);
