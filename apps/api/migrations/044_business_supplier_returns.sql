ALTER TABLE business_payable
  ADD COLUMN IF NOT EXISTS credited_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE business_payable DROP CONSTRAINT IF EXISTS business_payable_status_check;
ALTER TABLE business_payable DROP CONSTRAINT IF EXISTS business_payable_check;
ALTER TABLE business_payable DROP CONSTRAINT IF EXISTS business_payable_check1;
ALTER TABLE business_payable DROP CONSTRAINT IF EXISTS business_payable_paid_amount_check;
ALTER TABLE business_payable
  ADD CONSTRAINT business_payable_status_check CHECK (status IN ('open','partial','paid','refund_pending','void')),
  ADD CONSTRAINT business_payable_adjustment_check CHECK (
    credited_amount >= 0 AND credited_amount <= original_amount AND
    refunded_amount >= 0 AND refunded_amount <= paid_amount
  ),
  ADD CONSTRAINT business_payable_settlement_check CHECK (
    status='void' OR
    (status='open' AND paid_amount-refunded_amount=0 AND original_amount-credited_amount>0) OR
    (status='partial' AND paid_amount-refunded_amount>0 AND paid_amount-refunded_amount<original_amount-credited_amount) OR
    (status='paid' AND paid_amount-refunded_amount=original_amount-credited_amount) OR
    (status='refund_pending' AND paid_amount-refunded_amount>original_amount-credited_amount)
  );

ALTER TABLE business_inventory_movement DROP CONSTRAINT IF EXISTS business_inventory_movement_movement_type_check;
ALTER TABLE business_inventory_movement
  ADD CONSTRAINT business_inventory_movement_movement_type_check
  CHECK (movement_type IN ('receipt','reserve','release','ship','return_in','supplier_return_out','adjustment'));

CREATE TABLE IF NOT EXISTS business_supplier_return_case (
  id text PRIMARY KEY,
  return_no text NOT NULL UNIQUE,
  source_request_id text NOT NULL UNIQUE,
  purchase_order_id text NOT NULL REFERENCES business_purchase_order(id) ON DELETE RESTRICT,
  payable_id text NOT NULL REFERENCES business_payable(id) ON DELETE RESTRICT,
  supplier_partner_id text REFERENCES business_partner(id) ON DELETE SET NULL,
  supplier_name text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','partially_shipped','refund_pending','completed','rejected','cancelled')),
  reason_code text NOT NULL CHECK (reason_code IN ('wrong_part','quality_issue','damaged','excess','other')),
  description text NOT NULL DEFAULT '',
  requested_credit_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (requested_credit_amount >= 0),
  credited_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (credited_amount >= 0),
  refunded_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0 AND refunded_amount <= credited_amount),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  updated_by_id text NOT NULL,
  updated_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_supplier_return_item (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES business_supplier_return_case(id) ON DELETE RESTRICT,
  purchase_order_item_id text NOT NULL REFERENCES business_purchase_order_item(id) ON DELETE RESTRICT,
  inventory_lot_id text NOT NULL REFERENCES business_inventory_lot(id) ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES business_warehouse(id) ON DELETE RESTRICT,
  description text NOT NULL,
  oe_number text NOT NULL DEFAULT '',
  unit text NOT NULL,
  requested_quantity numeric(12,3) NOT NULL CHECK (requested_quantity > 0),
  approved_quantity numeric(12,3) NOT NULL DEFAULT 0 CHECK (approved_quantity >= 0 AND approved_quantity <= requested_quantity),
  shipped_quantity numeric(12,3) NOT NULL DEFAULT 0 CHECK (shipped_quantity >= 0 AND shipped_quantity <= approved_quantity),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  approved_unit_credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (approved_unit_credit >= 0 AND approved_unit_credit <= unit_cost),
  credited_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (credited_amount >= 0),
  UNIQUE (case_id,inventory_lot_id)
);

CREATE TABLE IF NOT EXISTS business_supplier_return_shipment (
  id text PRIMARY KEY,
  shipment_no text NOT NULL UNIQUE,
  source_request_id text NOT NULL UNIQUE,
  case_id text NOT NULL REFERENCES business_supplier_return_case(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'posted' CHECK (status='posted'),
  note text NOT NULL DEFAULT '',
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_supplier_return_shipment_item (
  id text PRIMARY KEY,
  shipment_id text NOT NULL REFERENCES business_supplier_return_shipment(id) ON DELETE RESTRICT,
  supplier_return_item_id text NOT NULL REFERENCES business_supplier_return_item(id) ON DELETE RESTRICT,
  inventory_lot_id text NOT NULL REFERENCES business_inventory_lot(id) ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES business_warehouse(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  credited_amount numeric(14,2) NOT NULL CHECK (credited_amount >= 0),
  UNIQUE (shipment_id,supplier_return_item_id)
);

CREATE TABLE IF NOT EXISTS business_supplier_refund (
  id text PRIMARY KEY,
  refund_no text NOT NULL UNIQUE,
  source_request_id text NOT NULL UNIQUE,
  case_id text NOT NULL REFERENCES business_supplier_return_case(id) ON DELETE RESTRICT,
  payable_id text NOT NULL REFERENCES business_payable(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  refund_method text NOT NULL CHECK (refund_method IN ('bank_transfer','cash','wechat','alipay','card','other')),
  refunded_at timestamptz NOT NULL,
  reference_no text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_supplier_return_event (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES business_supplier_return_case(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text NOT NULL DEFAULT '',
  to_status text NOT NULL DEFAULT '',
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  note text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_supplier_return_purchase_idx ON business_supplier_return_case(purchase_order_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_supplier_return_supplier_idx ON business_supplier_return_case(supplier_partner_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_supplier_return_item_lot_idx ON business_supplier_return_item(inventory_lot_id,case_id);
CREATE INDEX IF NOT EXISTS business_supplier_return_shipment_case_idx ON business_supplier_return_shipment(case_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS business_supplier_refund_case_idx ON business_supplier_refund(case_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS business_supplier_return_event_idx ON business_supplier_return_event(case_id,created_at DESC,id DESC);
