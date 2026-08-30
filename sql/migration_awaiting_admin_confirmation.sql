-- Migration: adds OTP-based delivery verification and the
-- "Awaiting Admin Confirmation" gate between Delivered and Completed.
--
-- Behavior change: after this migration + the matching code deploy,
-- a customer confirming receipt no longer completes the order by
-- itself - it only records that they confirmed. Only admin can move
-- an order from Awaiting Admin Confirmation to Completed.
--
-- Run with:
--   node runSqlFile.js sql/migration_awaiting_admin_confirmation.sql

ALTER TABLE orders MODIFY status ENUM(
  'Pending Payment','Paid','Processing','Ready for Delivery',
  'Out for Delivery','Delivered','Awaiting Admin Confirmation',
  'Completed','Cancelled','Refunded'
) NOT NULL DEFAULT 'Pending Payment';

ALTER TABLE orders ADD COLUMN delivery_otp VARCHAR(6) NULL;
ALTER TABLE orders ADD COLUMN otp_generated_at TIMESTAMP NULL;
ALTER TABLE orders ADD COLUMN otp_verified_at TIMESTAMP NULL;
ALTER TABLE orders ADD COLUMN awaiting_confirmation_at TIMESTAMP NULL;
ALTER TABLE orders ADD COLUMN customer_confirmed_at TIMESTAMP NULL;
