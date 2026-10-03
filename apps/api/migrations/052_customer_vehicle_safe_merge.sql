ALTER TABLE business_customer_vehicle
  ADD COLUMN IF NOT EXISTS merged_into_vehicle_id text REFERENCES business_customer_vehicle(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz;

ALTER TABLE business_customer_vehicle
  DROP CONSTRAINT IF EXISTS business_customer_vehicle_merge_shape_check;

ALTER TABLE business_customer_vehicle
  ADD CONSTRAINT business_customer_vehicle_merge_shape_check CHECK (
    (merged_into_vehicle_id IS NULL AND merged_at IS NULL)
    OR (merged_into_vehicle_id IS NOT NULL AND merged_into_vehicle_id<>id AND merged_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS business_customer_vehicle_merged_into_idx
  ON business_customer_vehicle(merged_into_vehicle_id,merged_at DESC)
  WHERE merged_into_vehicle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS business_customer_vehicle_merge (
  id text PRIMARY KEY,
  request_key text NOT NULL UNIQUE,
  partner_id text NOT NULL REFERENCES business_partner(id) ON DELETE RESTRICT,
  survivor_vehicle_id text NOT NULL REFERENCES business_customer_vehicle(id) ON DELETE RESTRICT,
  retired_vehicle_id text NOT NULL UNIQUE REFERENCES business_customer_vehicle(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  decision_fingerprint text NOT NULL,
  decision_snapshot jsonb NOT NULL,
  impact_snapshot jsonb NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (survivor_vehicle_id<>retired_vehicle_id),
  CHECK (length(trim(reason))>=8),
  CHECK (jsonb_typeof(decision_snapshot)='object'),
  CHECK (jsonb_typeof(impact_snapshot)='object')
);

CREATE INDEX IF NOT EXISTS business_customer_vehicle_merge_survivor_idx
  ON business_customer_vehicle_merge(survivor_vehicle_id,created_at DESC,id DESC);

ALTER TABLE business_quick_quote_draft_event
  DROP CONSTRAINT IF EXISTS business_quick_quote_draft_event_action_check;

ALTER TABLE business_quick_quote_draft_event
  ADD CONSTRAINT business_quick_quote_draft_event_action_check
  CHECK (action IN ('created','saved','submission_started','submission_failed','submitted','abandoned','customer_merged','vehicle_merged'));
