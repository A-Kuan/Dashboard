CREATE TABLE IF NOT EXISTS business_customer_onboarding_request (
  request_key text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES business_partner(id) ON DELETE RESTRICT,
  customer_vehicle_id text NOT NULL REFERENCES business_customer_vehicle(id) ON DELETE RESTRICT,
  created_partner boolean NOT NULL,
  created_vehicle boolean NOT NULL,
  matched_by text NOT NULL CHECK (matched_by IN ('created','vin','license_plate','phone')),
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_customer_onboarding_partner_idx
  ON business_customer_onboarding_request(partner_id,created_at DESC);
