-- Migration: adds a super-admin flag so one person (Anderson) can control
-- who else is allowed to be an admin, while regular admins can no longer
-- add/remove admin accounts themselves.
--
-- Run this once against your existing database:
--   Get-Content sql/migration_add_super_admin.sql | mysql -u root -p embu_marketplace

USE embu_marketplace;

ALTER TABLE admins ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Make Anderson the super admin (adjust the email if needed):
UPDATE admins SET is_super_admin = TRUE WHERE email = 'adeppoultryhub254@gmail.com';
