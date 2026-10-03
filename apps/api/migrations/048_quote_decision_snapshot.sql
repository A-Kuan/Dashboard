ALTER TABLE business_quote_item
  ADD COLUMN IF NOT EXISTS decision_fingerprint text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS decision_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS decision_generated_at timestamptz;

ALTER TABLE business_quote_item DROP CONSTRAINT IF EXISTS business_quote_item_decision_shape_check;
ALTER TABLE business_quote_item DROP CONSTRAINT IF EXISTS business_quote_item_decision_pair_check;
ALTER TABLE business_quote_item
  ADD CONSTRAINT business_quote_item_decision_shape_check
    CHECK (jsonb_typeof(decision_snapshot)='object'),
  ADD CONSTRAINT business_quote_item_decision_pair_check
    CHECK (
      (decision_fingerprint='' AND decision_snapshot='{}'::jsonb AND decision_generated_at IS NULL)
      OR
      (decision_fingerprint ~ '^[a-f0-9]{64}$' AND decision_snapshot<>'{}'::jsonb AND decision_generated_at IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS business_quote_item_decision_fingerprint_idx
  ON business_quote_item(decision_fingerprint)
  WHERE decision_fingerprint<>'';
