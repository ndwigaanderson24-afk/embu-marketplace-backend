-- ============================================================
-- Embu Marketplace - Database Schema (v2)
-- Matches the ACTUAL website's data model: one unified users table
-- (customers who can also apply to become sellers), county-based
-- delivery pricing, multi-seller order splitting, and referral codes -
-- not the generic multi-vendor spec from the uploaded document.
--
-- Run once:  mysql -u root -p < sql/schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS embu_marketplace CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE embu_marketplace;

-- ------------------------------------------------------------
-- users
-- One table for everyone. Anyone can register as a plain customer;
-- applying to sell just fills in the seller_* columns and moves
-- seller_status through pending -> approved -> rejected. This mirrors
-- the website, where a seller is just a user with an application on file
-- (there's no separate "sellers" table there).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,

  referral_code VARCHAR(20) NOT NULL UNIQUE,
  referred_by_code VARCHAR(20) NULL,

  -- Seller application fields (NULL/none until they apply)
  business_name VARCHAR(255) NULL,
  kra_pin VARCHAR(50) NULL,
  county VARCHAR(100) NULL,               -- also the seller's shipping-origin county
  business_description TEXT NULL,
  id_photo_path VARCHAR(255) NULL,
  business_doc_path VARCHAR(255) NULL,
  seller_status ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none',
  seller_rejection_reason TEXT NULL,

  -- Subscription (only meaningful once seller_status = 'approved')
  subscription_status ENUM('none','active','expired') NOT NULL DEFAULT 'none',
  subscription_start DATE NULL,
  subscription_end DATE NULL,
  shop_disabled BOOLEAN NOT NULL DEFAULT FALSE,   -- admin manual shop toggle

  reset_password_token VARCHAR(255) NULL,
  reset_password_expires DATETIME NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_users_email (email),
  INDEX idx_users_seller_status (seller_status),
  INDEX idx_users_referral_code (referral_code)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- products
-- seller_id NULL = platform/demo catalog product (matches the website's
-- built-in products with no seller attached). county is copied from the
-- seller's county at creation time and drives delivery-fee calculation.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id INT PRIMARY KEY AUTO_INCREMENT,
  seller_id INT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  price DECIMAL(10,2) NOT NULL,
  original_price DECIMAL(10,2) NULL,
  emoji VARCHAR(10) NULL,
  image VARCHAR(255) NULL,
  video VARCHAR(255) NULL,
  weight DECIMAL(10,2) NOT NULL DEFAULT 1,
  fragile BOOLEAN NOT NULL DEFAULT FALSE,
  stock INT NOT NULL DEFAULT 0,
  county VARCHAR(100) NULL,
  hot BOOLEAN NOT NULL DEFAULT FALSE,
  rating DECIMAL(3,2) NOT NULL DEFAULT 0,
  num_reviews INT NOT NULL DEFAULT 0,
  status ENUM('draft','active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_products_seller (seller_id),
  INDEX idx_products_category (category),
  INDEX idx_products_status (status)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- cart_items
-- Server-side cart, keyed by user_id (logged in) OR session_id (guest) -
-- exactly one of the two is set. Matches the website's ability to shop
-- as a guest through checkout.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cart_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NULL,
  session_id VARCHAR(100) NULL,
  product_id INT NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_user_product (user_id, product_id),
  UNIQUE KEY uniq_session_product (session_id, product_id),
  INDEX idx_cart_user (user_id),
  INDEX idx_cart_session (session_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- orders
-- ONE ROW PER SELLER per checkout - a cart spanning 3 sellers becomes 3
-- order rows sharing the same customer details, exactly like the website's
-- checkout splitting logic. seller_id NULL = platform/demo products.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_number VARCHAR(50) NOT NULL UNIQUE,
  tracking_number VARCHAR(50) NOT NULL UNIQUE,
  seller_id INT NULL,
  customer_user_id INT NULL,

  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  customer_id_number VARCHAR(20) NOT NULL,
  customer_address TEXT,

  -- Canonical 6-stage lifecycle, matches the website exactly.
  -- 'Booked' is used only for scheduled pickup-date orders before Pending.
  status ENUM('Booked','Pending','Accepted','Packed','In Transit','Delivered','Completed','Cancelled')
    NOT NULL DEFAULT 'Pending',

  delivery_type ENUM('pickup','delivery') NOT NULL,
  delivery_address TEXT NULL,               -- only used when delivery_type = 'delivery'
  origin_county VARCHAR(100) NOT NULL,       -- seller's county (or platform default)
  dest_county VARCHAR(100) NOT NULL,
  dest_area VARCHAR(100) NULL,               -- e.g. "Pipeline", "Dandora", or a highway-corridor town
  weight_kg DECIMAL(10,2) NOT NULL,
  delivery_fee DECIMAL(10,2) NOT NULL,

  subtotal DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  commission DECIMAL(10,2) NOT NULL DEFAULT 0,     -- platform's cut of subtotal
  seller_earnings DECIMAL(10,2) NOT NULL DEFAULT 0, -- subtotal - commission, payable once status = Completed

  referral_code VARCHAR(20) NULL,
  pickup_date DATE NULL,

  -- Rider (only present for delivery_type = 'delivery' orders that have been assigned one)
  rider_name VARCHAR(255) NULL,
  rider_phone VARCHAR(20) NULL,
  rider_photo VARCHAR(255) NULL,
  rider_assigned_at TIMESTAMP NULL,

  -- Delivery experience rating - intentionally independent of whether a
  -- rider was ever assigned, since Pickup orders have no rider at all.
  delivery_rating TINYINT NULL,
  delivery_remarks TEXT NULL,
  delivery_rated_at TIMESTAMP NULL,

  placed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_orders_seller (seller_id),
  INDEX idx_orders_status (status),
  INDEX idx_orders_tracking (tracking_number),
  INDEX idx_orders_phone (customer_phone)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- order_items
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  product_id INT NULL,
  product_name VARCHAR(255) NOT NULL,
  qty INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,

  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  INDEX idx_items_order (order_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- referral_earnings
-- 10% commission when a referred customer's order exceeds the minimum
-- threshold, exactly as on the website.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_earnings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  referrer_id INT NOT NULL,
  referred_user_id INT NULL,
  order_id INT NOT NULL,
  order_total DECIMAL(10,2) NOT NULL,
  commission DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_referral_referrer (referrer_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- withdrawals
-- Sellers request a payout from their Completed-order earnings; admin
-- reviews and processes it. Minimum KES 800, matching the website.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS withdrawals (
  id INT PRIMARY KEY AUTO_INCREMENT,
  seller_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  method ENUM('bank_transfer','mpesa') NOT NULL,
  bank_details TEXT NULL,
  mpesa_number VARCHAR(20) NULL,
  status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  reference_number VARCHAR(255) NULL,
  notes TEXT NULL,
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,

  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_withdrawals_seller (seller_id),
  INDEX idx_withdrawals_status (status)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- reviews
-- Product reviews, gated to customers whose order for that product has
-- reached Delivered or Completed - matches the website's review flow.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  customer_user_id INT NULL,
  customer_name VARCHAR(255) NOT NULL,
  rating TINYINT NOT NULL,
  comment TEXT NULL,
  verified BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uniq_order_product_review (order_id, product_id),
  INDEX idx_reviews_product (product_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- notifications
-- In-app notifications, including admin announcements broadcast to sellers.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  type VARCHAR(50) DEFAULT 'general',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notifications_user (user_id, is_read)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- activity_logs
-- Lightweight audit trail for admin actions.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  actor VARCHAR(100) NOT NULL,        -- 'admin' or a user id as a string
  action VARCHAR(255) NOT NULL,
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
-- History of what a seller has paid, per the website's sliding-scale plan
-- (6 months = KES 150, +KES ~18-19 per extra month up to 12 months = KES 260).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_payments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  seller_id INT NOT NULL,
  months INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_subpay_seller (seller_id)
) ENGINE=InnoDB;
