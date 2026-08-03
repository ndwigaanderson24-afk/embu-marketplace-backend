-- ============================================================
-- KenLynk Marketplace — Product Variants System Migration
-- Run: node runSqlFile.js sql/migration_product_variants.sql
-- ============================================================

-- 1. Add brand column to products if not present
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand VARCHAR(120) NULL AFTER category;

-- 2. Add has_variants flag so the storefront knows whether to render
--    a variant picker or a simple buy button.
ALTER TABLE products ADD COLUMN IF NOT EXISTS has_variants TINYINT(1) NOT NULL DEFAULT 0 AFTER brand;

-- 3. Add images_json column for multiple product images (JSON array of URLs)
ALTER TABLE products ADD COLUMN IF NOT EXISTS images_json TEXT NULL AFTER image;

-- ── Variant Attribute Types ──────────────────────────────────
-- Defines the names of variant dimensions for a product.
-- e.g. "Colour", "Size", "Storage", "Weight", "Material"
-- Each row belongs to exactly one product.
CREATE TABLE IF NOT EXISTS product_variant_attributes (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  product_id  INT NOT NULL,
  name        VARCHAR(80)  NOT NULL,   -- e.g. "Colour", "Size", "RAM"
  position    TINYINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_pva_product (product_id)
) ENGINE=InnoDB;

-- ── Variants ───────────────────────────────────────────────
-- Each row is one purchasable combination (e.g. Black / EU41).
CREATE TABLE IF NOT EXISTS product_variants (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  product_id   INT NOT NULL,
  sku          VARCHAR(120) NULL,
  price        DECIMAL(12,2) NOT NULL,
  original_price DECIMAL(12,2) NULL,
  stock        INT NOT NULL DEFAULT 0,
  images_json  TEXT NULL,           -- JSON array of variant-specific image URLs
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_pv_product (product_id),
  UNIQUE KEY uq_sku (sku)
) ENGINE=InnoDB;

-- ── Variant Option Values ───────────────────────────────────
-- Links a variant to its attribute values.
-- e.g. variant 7 → attribute "Colour" = "Black"
--       variant 7 → attribute "Size"   = "EU41"
CREATE TABLE IF NOT EXISTS product_variant_options (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  variant_id   INT NOT NULL,
  attribute_id INT NOT NULL,
  value        VARCHAR(120) NOT NULL,   -- e.g. "Black", "EU41", "128GB"

  FOREIGN KEY (variant_id)   REFERENCES product_variants(id) ON DELETE CASCADE,
  FOREIGN KEY (attribute_id) REFERENCES product_variant_attributes(id) ON DELETE CASCADE,
  INDEX idx_pvo_variant   (variant_id),
  INDEX idx_pvo_attribute (attribute_id)
) ENGINE=InnoDB;
