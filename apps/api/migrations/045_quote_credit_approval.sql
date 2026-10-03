INSERT INTO app_configuration (key,payload,version,updated_by)
VALUES ('business_controls','{"marginControlEnabled":true,"minimumMarginRate":15,"creditControlEnabled":true}'::jsonb,1,'migration-045')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE business_quote
  ADD COLUMN IF NOT EXISTS margin_rate numeric(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS risk_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_fingerprint text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_revision integer,
  ADD COLUMN IF NOT EXISTS approved_by_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_by_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_note text NOT NULL DEFAULT '';

UPDATE business_quote
SET margin_rate=CASE WHEN total_amount>0 THEN round((margin_amount/total_amount*100)::numeric,4) ELSE 0 END
WHERE margin_rate=0 AND margin_amount<>0;

ALTER TABLE business_quote DROP CONSTRAINT IF EXISTS business_quote_approval_status_check;
ALTER TABLE business_quote DROP CONSTRAINT IF EXISTS business_quote_approval_shape_check;
ALTER TABLE business_quote
  ADD CONSTRAINT business_quote_approval_status_check CHECK (approval_status IN ('not_required','pending','approved','rejected')),
  ADD CONSTRAINT business_quote_approval_shape_check CHECK (
    jsonb_typeof(risk_reasons)='array' AND jsonb_typeof(risk_snapshot)='object' AND
    ((approval_status='approved' AND approved_revision IS NOT NULL AND approved_by_id<>'' AND approved_by_name<>'' AND approved_at IS NOT NULL)
      OR approval_status<>'approved')
  );

CREATE TABLE IF NOT EXISTS business_quote_approval_event (
  id text PRIMARY KEY,
  quote_id text NOT NULL REFERENCES business_quote(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('requested','refreshed','approved','rejected','not_required','invalidated')),
  from_status text NOT NULL DEFAULT '',
  to_status text NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  note text NOT NULL DEFAULT '',
  risk_reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(risk_reasons)='array'),
  risk_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(risk_snapshot)='object'),
  fingerprint text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_control_event (
  id text PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('updated')),
  from_version integer NOT NULL CHECK (from_version>0),
  to_version integer NOT NULL CHECK (to_version>from_version),
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  note text NOT NULL DEFAULT '',
  before_snapshot jsonb NOT NULL CHECK (jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb NOT NULL CHECK (jsonb_typeof(after_snapshot)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_quote_approval_status_idx ON business_quote(approval_status,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_quote_approval_event_idx ON business_quote_approval_event(quote_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS business_control_event_idx ON business_control_event(created_at DESC,id DESC);
