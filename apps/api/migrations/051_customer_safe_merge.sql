ALTER TABLE business_partner
  ADD COLUMN IF NOT EXISTS merged_into_partner_id text REFERENCES business_partner(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz;

ALTER TABLE business_partner
  DROP CONSTRAINT IF EXISTS business_partner_merge_shape_check;

ALTER TABLE business_partner
  ADD CONSTRAINT business_partner_merge_shape_check CHECK (
    (merged_into_partner_id IS NULL AND merged_at IS NULL)
    OR (merged_into_partner_id IS NOT NULL AND merged_into_partner_id<>id AND merged_at IS NOT NULL AND status='inactive')
  );

CREATE INDEX IF NOT EXISTS business_partner_merged_into_idx
  ON business_partner(merged_into_partner_id,merged_at DESC)
  WHERE merged_into_partner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS business_partner_merge (
  id text PRIMARY KEY,
  request_key text NOT NULL UNIQUE,
  survivor_partner_id text NOT NULL REFERENCES business_partner(id) ON DELETE RESTRICT,
  retired_partner_id text NOT NULL UNIQUE REFERENCES business_partner(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  decision_fingerprint text NOT NULL,
  decision_snapshot jsonb NOT NULL,
  impact_snapshot jsonb NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (survivor_partner_id<>retired_partner_id),
  CHECK (length(trim(reason))>=8),
  CHECK (jsonb_typeof(decision_snapshot)='object'),
  CHECK (jsonb_typeof(impact_snapshot)='object')
);

CREATE INDEX IF NOT EXISTS business_partner_merge_survivor_idx
  ON business_partner_merge(survivor_partner_id,created_at DESC,id DESC);

ALTER TABLE business_quick_quote_draft_event
  DROP CONSTRAINT IF EXISTS business_quick_quote_draft_event_action_check;

ALTER TABLE business_quick_quote_draft_event
  ADD CONSTRAINT business_quick_quote_draft_event_action_check
  CHECK (action IN ('created','saved','submission_started','submission_failed','submitted','abandoned','customer_merged'));
