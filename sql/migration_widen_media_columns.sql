-- Migration: widen columns that hold compressed base64 data URLs
-- (the frontend compresses images/documents client-side to a data: URL
-- string rather than uploading files - VARCHAR(255) is nowhere near
-- big enough for any of these).
--
-- Run this once against your existing database:
--   mysql -u root -p embu_marketplace < sql/migration_widen_media_columns.sql

USE embu_marketplace;

ALTER TABLE products MODIFY image LONGTEXT NULL;
ALTER TABLE users MODIFY id_photo_path LONGTEXT NULL;
ALTER TABLE users MODIFY business_doc_path LONGTEXT NULL;
