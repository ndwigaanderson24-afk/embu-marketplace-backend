-- Migration: adds a real `admins` table so multiple people can each have
-- their own admin login, instead of the single email/password pair that
-- used to live in .env.
--
-- Run this once against your existing database:
--   mysql -u root -p embu_marketplace < sql/migration_add_admins_table.sql
--
-- After running this, use `node createAdmin.js` (see that file) to add
-- each admin account - starting with yourself, since ADMIN_EMAIL/
-- ADMIN_PASSWORD_HASH in .env are no longer checked at all.

USE embu_marketplace;

CREATE TABLE IF NOT EXISTS admins (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
