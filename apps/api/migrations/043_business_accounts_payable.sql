CREATE TABLE IF NOT EXISTS business_payable (
  id text PRIMARY KEY,
  payable_no text NOT NULL UNIQUE,
  purchase_order_id text NOT NULL UNIQUE REFERENCES business_purchase_order(id) ON DELETE RESTRICT,
  sales_order_id text NOT NULL REFERENCES business_sales_order(id) ON DELETE RESTRICT,
  supplier_partner_id text REFERENCES business_partner(id) ON DELETE SET NULL,
  supplier_name text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','paid','void')),
  currency text NOT NULL DEFAULT 'CNY',
  original_amount numeric(14,2) NOT NULL CHECK (original_amount >= 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0 AND paid_amount <= original_amount),
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  due_at date NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  updated_by_id text NOT NULL,
  updated_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='open' AND paid_amount=0 AND original_amount>0) OR (status='partial' AND paid_amount>0 AND paid_amount<original_amount) OR (status='paid' AND paid_amount=original_amount) OR status='void')
);

CREATE TABLE IF NOT EXISTS business_supplier_payment (
  id text PRIMARY KEY,
  payment_no text NOT NULL UNIQUE,
  source_request_id text NOT NULL UNIQUE,
  payable_id text NOT NULL REFERENCES business_payable(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('bank_transfer','cash','wechat','alipay','card','other')),
  paid_at timestamptz NOT NULL,
  reference_no text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_payable_event (
  id text PRIMARY KEY,
  payable_id text NOT NULL REFERENCES business_payable(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text NOT NULL DEFAULT '',
  to_status text NOT NULL DEFAULT '',
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  note text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_payable_supplier_idx ON business_payable(supplier_partner_id,status,due_at,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_payable_status_due_idx ON business_payable(status,due_at,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_payable_sales_idx ON business_payable(sales_order_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_supplier_payment_payable_idx ON business_supplier_payment(payable_id,paid_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS business_payable_event_idx ON business_payable_event(payable_id,created_at DESC,id DESC);

INSERT INTO business_payable
  (id,payable_no,purchase_order_id,sales_order_id,supplier_partner_id,supplier_name,status,currency,original_amount,paid_amount,payment_terms_days,due_at,created_by_id,created_by_name,updated_by_id,updated_by_name,created_at,updated_at)
SELECT 'payable-'||md5(p.id),'AP-LEGACY-'||upper(substr(md5(p.id),1,10)),p.id,p.sales_order_id,p.supplier_partner_id,p.supplier_name,
  CASE WHEN p.status='cancelled' THEN 'void' WHEN p.total_amount=0 THEN 'paid' ELSE 'open' END,p.currency,p.total_amount,0,COALESCE(s.payment_terms_days,0),
  p.created_at::date+COALESCE(s.payment_terms_days,0),p.created_by_id,p.created_by_name,p.updated_by_id,p.updated_by_name,p.created_at,p.updated_at
FROM business_purchase_order p LEFT JOIN business_partner s ON s.id=p.supplier_partner_id
ON CONFLICT (purchase_order_id) DO NOTHING;

INSERT INTO business_payable_event
  (id,payable_id,action,from_status,to_status,actor_id,actor_name,note,snapshot,created_at)
SELECT 'payable-event-'||md5(a.id),a.id,'created_from_existing_order','',a.status,a.created_by_id,a.created_by_name,
  '数据库升级时为既有采购订单补建应付单',jsonb_build_object('purchaseOrderId',a.purchase_order_id,'originalAmount',a.original_amount),a.created_at
FROM business_payable a
WHERE NOT EXISTS (SELECT 1 FROM business_payable_event e WHERE e.payable_id=a.id);
