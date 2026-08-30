-- Migration: adds Delivery Failed and the full return/refund workflow
-- (Return Requested -> Return Approved -> Returned -> Refund Processing
-- -> Refunded) to the order status ENUM, plus refund tracking columns.
--
-- Run with:
--   node runSqlFile.js sql/migration_exception_statuses.sql

ALTER TABLE orders MODIFY status ENUM(
  'Pending Payment','Paid','Processing','Ready for Delivery',
  'Out for Delivery','Delivery Failed','Delivered',
  'Awaiting Admin Confirmation','Completed',
  'Return Requested','Return Approved','Returned','Refund Processing',
  'Cancelled','Refunded'
) NOT NULL DEFAULT 'Pending Payment';

ALTER TABLE orders ADD COLUMN return_reason TEXT NULL;
ALTER TABLE orders ADD COLUMN refund_amount DECIMAL(10,2) NULL;
ALTER TABLE orders ADD COLUMN refunded_at TIMESTAMP NULL;
