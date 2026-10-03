ALTER TABLE business_quote_item
  ADD COLUMN IF NOT EXISTS fulfillment_warehouse_id text REFERENCES business_warehouse(id) ON DELETE RESTRICT;

ALTER TABLE business_sales_order_item
  ADD COLUMN IF NOT EXISTS fulfillment_warehouse_id text REFERENCES business_warehouse(id) ON DELETE RESTRICT;

ALTER TABLE business_quote_item
  ADD CONSTRAINT business_quote_item_fulfillment_warehouse_check
  CHECK (
    (fulfillment_source='stock' AND fulfillment_warehouse_id IS NOT NULL)
    OR (fulfillment_source='purchase' AND fulfillment_warehouse_id IS NULL)
  );

ALTER TABLE business_sales_order_item
  ADD CONSTRAINT business_sales_order_item_fulfillment_warehouse_check
  CHECK (
    (fulfillment_source='stock' AND fulfillment_warehouse_id IS NOT NULL)
    OR (fulfillment_source='purchase' AND fulfillment_warehouse_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS business_quote_item_fulfillment_warehouse_idx
  ON business_quote_item(fulfillment_warehouse_id,quote_id)
  WHERE fulfillment_warehouse_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS business_sales_order_item_fulfillment_warehouse_idx
  ON business_sales_order_item(fulfillment_warehouse_id,sales_order_id)
  WHERE fulfillment_warehouse_id IS NOT NULL;
