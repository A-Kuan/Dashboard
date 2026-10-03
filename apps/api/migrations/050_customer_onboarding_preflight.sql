ALTER TABLE business_customer_onboarding_request
  ADD COLUMN IF NOT EXISTS decision_fingerprint text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS decision_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE business_customer_onboarding_request
  DROP CONSTRAINT IF EXISTS business_customer_onboarding_request_matched_by_check;

ALTER TABLE business_customer_onboarding_request
  ADD CONSTRAINT business_customer_onboarding_request_matched_by_check
  CHECK (matched_by IN ('created','vin','license_plate','phone','tax_id','selected_customer'));
