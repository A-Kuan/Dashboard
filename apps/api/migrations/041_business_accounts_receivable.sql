CREATE TABLE IF NOT EXISTS business_receivable (
  id text PRIMARY KEY,
  receivable_no text NOT NULL UNIQUE,
  sales_order_id text NOT NULL UNIQUE REFERENCES business_sales_order(id) ON DELETE RESTRICT,
  customer_partner_id text REFERENCES business_partner(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','paid','void')),
  currency text NOT NULL DEFAULT 'CNY',
  original_amount numeric(14,2) NOT NULL CHECK (original_amount >= 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  due_at date NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  updated_by_id text NOT NULL,
  updated_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (paid_amount <= original_amount),
  CHECK ((status='open' AND paid_amount=0) OR (status='partial' AND paid_amount>0 AND paid_amount<original_amount) OR (status='paid' AND paid_amount=original_amount) OR status='void')
);

CREATE TABLE IF NOT EXISTS business_payment (
  id text PRIMARY KEY,
  payment_no text NOT NULL UNIQUE,
  source_request_id text NOT NULL UNIQUE,
  receivable_id text NOT NULL REFERENCES business_receivable(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('bank_transfer','cash','wechat','alipay','card','other')),
  paid_at timestamptz NOT NULL,
  reference_no text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_receivable_event (
  id text PRIMARY KEY,
  receivable_id text NOT NULL REFERENCES business_receivable(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text NOT NULL DEFAULT '',
  to_status text NOT NULL DEFAULT '',
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  note text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_receivable_customer_idx ON business_receivable(customer_partner_id,status,due_at,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_receivable_status_due_idx ON business_receivable(status,due_at,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_payment_receivable_idx ON business_payment(receivable_id,paid_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS business_receivable_event_idx ON business_receivable_event(receivable_id,created_at DESC,id DESC);

INSERT INTO business_receivable
  (id,receivable_no,sales_order_id,customer_partner_id,customer_name,status,currency,original_amount,paid_amount,payment_terms_days,due_at,created_by_id,created_by_name,updated_by_id,updated_by_name,created_at,updated_at)
SELECT 'recv-'||md5(s.id),'AR-LEGACY-'||upper(substr(md5(s.id),1,10)),s.id,s.customer_partner_id,s.customer_name,
  CASE WHEN s.status='cancelled' THEN 'void' WHEN s.total_amount=0 THEN 'paid' ELSE 'open' END,s.currency,s.total_amount,0,COALESCE(p.payment_terms_days,0),
  s.created_at::date+COALESCE(p.payment_terms_days,0),s.created_by_id,s.created_by_name,s.updated_by_id,s.updated_by_name,s.created_at,s.updated_at
FROM business_sales_order s LEFT JOIN business_partner p ON p.id=s.customer_partner_id
ON CONFLICT (sales_order_id) DO NOTHING;

INSERT INTO business_receivable_event
  (id,receivable_id,action,from_status,to_status,actor_id,actor_name,note,snapshot,created_at)
SELECT 'recv-event-'||md5(r.id),r.id,'created_from_existing_order','',r.status,r.created_by_id,r.created_by_name,
  '数据库升级时为既有销售订单补建应收单',jsonb_build_object('salesOrderId',r.sales_order_id,'originalAmount',r.original_amount),r.created_at
FROM business_receivable r
WHERE NOT EXISTS (SELECT 1 FROM business_receivable_event e WHERE e.receivable_id=r.id);
