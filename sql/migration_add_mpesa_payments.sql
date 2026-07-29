-- Migration: adds a table to track real M-Pesa STK Push payments.
-- Every payment attempt gets a row here the moment it's initiated
-- (status 'pending'), and only gets marked 'completed' once Safaricom's
-- own servers confirm it via the callback - never based on what the
-- browser claims.
--
-- Run this once against your existing database:
--   Get-Content sql/migration_add_mpesa_payments.sql | C:\xampp\mysql\bin\mysql.exe -u root -p embu_marketplace

USE embu_marketplace;

CREATE TABLE IF NOT EXISTS mpesa_payments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  merchant_request_id VARCHAR(100) NULL,
  checkout_request_id VARCHAR(100) NULL UNIQUE,
  phone VARCHAR(20) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  purpose ENUM('subscription','order') NOT NULL,
  purpose_months INT NULL,              -- for subscription payments
  user_id INT NULL,
  status ENUM('pending','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
  mpesa_receipt_number VARCHAR(50) NULL,
  result_desc TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_mpesa_checkout (checkout_request_id),
  INDEX idx_mpesa_user (user_id)
) ENGINE=InnoDB;
