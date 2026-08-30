-- Migration: adds the two-branch post-payment workflow.
--   Platform/admin-owned products (seller_id IS NULL):
--     Paid -> Availability Confirmed -> Processing / Sourcing ->
--     Product Purchased -> Ready for Delivery -> ...
--   Third-party seller-owned products (seller_id IS NOT NULL):
--     Paid -> Seller Confirmed -> Seller Preparing ->
--     Ready for Delivery -> ...
-- Which branch applies is determined automatically from orders.seller_id
-- by the backend state machine (models/orderStatus.js) - never chosen
-- manually by an admin.
--
-- Run with:
--   node runSqlFile.js sql/migration_supplier_sourcing.sql

ALTER TABLE orders MODIFY status ENUM(
  'Pending Payment','Paid',
  'Availability Confirmed','Processing / Sourcing','Product Purchased','Product Unavailable',
  'Seller Confirmed','Seller Preparing',
  'Processing',
  'Ready for Delivery','Out for Delivery','Delivery Failed','Delivered',
  'Awaiting Admin Confirmation','Completed',
  'Return Requested','Return Approved','Returned','Refund Processing',
  'Cancelled','Refunded'
) NOT NULL DEFAULT 'Pending Payment';

ALTER TABLE orders ADD COLUMN supplier_name VARCHAR(255) NULL;
ALTER TABLE orders ADD COLUMN supplier_order_number VARCHAR(120) NULL;
ALTER TABLE orders ADD COLUMN supplier_purchase_cost DECIMAL(10,2) NULL;
ALTER TABLE orders ADD COLUMN supplier_purchase_date DATE NULL;
ALTER TABLE orders ADD COLUMN supplier_tracking_number VARCHAR(120) NULL;
ALTER TABLE orders ADD COLUMN supplier_notes TEXT NULL;
ALTER TABLE orders ADD COLUMN product_purchased_at TIMESTAMP NULL;
