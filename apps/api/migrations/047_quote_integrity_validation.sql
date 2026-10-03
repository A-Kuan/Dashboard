ALTER TABLE business_quote
  ADD COLUMN IF NOT EXISTS integrity_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS integrity_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS integrity_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS integrity_fingerprint text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS integrity_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS integrity_validated_action text NOT NULL DEFAULT '';

ALTER TABLE business_quote DROP CONSTRAINT IF EXISTS business_quote_integrity_status_check;
ALTER TABLE business_quote DROP CONSTRAINT IF EXISTS business_quote_integrity_shape_check;
ALTER TABLE business_quote DROP CONSTRAINT IF EXISTS business_quote_integrity_action_check;
ALTER TABLE business_quote
  ADD CONSTRAINT business_quote_integrity_status_check CHECK (integrity_status IN ('pending','valid','blocked')),
  ADD CONSTRAINT business_quote_integrity_shape_check CHECK (jsonb_typeof(integrity_reasons)='array' AND jsonb_typeof(integrity_snapshot)='object'),
  ADD CONSTRAINT business_quote_integrity_action_check CHECK (integrity_validated_action IN ('','created','revised','send','decision','conversion'));

CREATE TABLE IF NOT EXISTS business_quote_integrity_event (
  id text PRIMARY KEY,
  quote_id text NOT NULL REFERENCES business_quote(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created','revised','send','decision','conversion')),
  result text NOT NULL CHECK (result IN ('valid','blocked')),
  from_status text NOT NULL DEFAULT '',
  to_status text NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reasons)='array'),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(snapshot)='object'),
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_quote_integrity_status_idx
  ON business_quote(integrity_status,updated_at DESC);
CREATE INDEX IF NOT EXISTS business_quote_integrity_event_idx
  ON business_quote_integrity_event(quote_id,created_at DESC,id DESC);
