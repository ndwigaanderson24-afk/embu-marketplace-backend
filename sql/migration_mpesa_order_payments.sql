-- Migration: extends mpesa_payments so direct M-Pesa (Daraja) can handle
-- order checkout the same way it already handles subscriptions, and the
-- same way intasend_payments already handles both - "charge first,
-- create/apply only once the callback confirms payment."
--
-- purpose_plan: which Silver/Gold plan a subscription payment was for
--   (subscribe-via-M-Pesa was previously broken - see paymentController.js
--   comments - because it never stored or used this at all)
-- payload_json: everything needed to create the order once payment is
--   confirmed (customer details, delivery choice, cart owner) - stashed
--   here until mpesaCallback fires, never before
-- result_json: what actually happened once applied (created order IDs,
--   or an error if something went wrong after payment was confirmed)
--
-- Run with:
--   node runSqlFile.js sql/migration_mpesa_order_payments.sql

ALTER TABLE mpesa_payments ADD COLUMN purpose_plan VARCHAR(20) NULL;
ALTER TABLE mpesa_payments ADD COLUMN payload_json TEXT NULL;
ALTER TABLE mpesa_payments ADD COLUMN result_json TEXT NULL;
