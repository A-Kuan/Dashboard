DROP INDEX IF EXISTS business_stock_reservation_active_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS business_stock_reservation_active_warehouse_unique_idx
  ON business_stock_reservation(sales_order_id,warehouse_id)
  WHERE status='active';
