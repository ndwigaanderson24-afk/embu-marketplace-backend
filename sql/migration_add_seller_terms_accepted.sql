-- Migration: adds a timestamp recording when a seller accepted the
-- Seller Terms & Conditions. This is the audit trail proving consent was
-- given, separate from the frontend's localStorage flag (which only
-- controls what the UI shows - this column is the real record).
--
-- Run this once against your existing database:
--   mysql -u root -p embu_marketplace < sql/migration_add_seller_terms_accepted.sql

USE defaultdb;

ALTER TABLE users ADD COLUMN seller_terms_accepted_at DATETIME NULL;
