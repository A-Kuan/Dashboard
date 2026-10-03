ALTER TABLE business_quote_item
  ADD COLUMN IF NOT EXISTS fulfillment_source text NOT NULL DEFAULT 'purchase'
    CHECK (fulfillment_source IN ('stock','purchase'));

ALTER TABLE business_sales_order_item
  ADD COLUMN IF NOT EXISTS fulfillment_source text NOT NULL DEFAULT 'purchase'
    CHECK (fulfillment_source IN ('stock','purchase'));

CREATE INDEX IF NOT EXISTS business_quote_item_fulfillment_source_idx
  ON business_quote_item(quote_id,fulfillment_source);

CREATE INDEX IF NOT EXISTS business_sales_order_item_fulfillment_source_idx
  ON business_sales_order_item(sales_order_id,fulfillment_source);
