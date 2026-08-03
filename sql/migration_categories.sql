-- ============================================================
-- KenLynk Marketplace — Dynamic Category System Migration
-- Run: node runSqlFile.js sql/migration_categories.sql
-- ============================================================
-- Self-referencing parent_id enables unlimited hierarchy depth:
--   level 0: parent_id IS NULL  → Main Category  (e.g. Electronics)
--   level 1: parent_id = root   → Subcategory    (e.g. Mobile Phones)
--   level 2: parent_id = sub    → Child Category  (e.g. Smartphones)
--   (deeper levels work automatically without schema changes)

CREATE TABLE IF NOT EXISTS categories (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  parent_id     INT NULL,                        -- NULL = top-level category
  name          VARCHAR(120) NOT NULL,
  slug          VARCHAR(120) NOT NULL UNIQUE,    -- URL-safe identifier
  description   TEXT NULL,
  icon          VARCHAR(60)  NULL,               -- emoji or icon name
  image_url     TEXT NULL,                       -- banner / category image
  position      INT NOT NULL DEFAULT 0,          -- display order within siblings
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE,
  INDEX idx_cat_parent   (parent_id),
  INDEX idx_cat_active   (is_active),
  INDEX idx_cat_position (position)
) ENGINE=InnoDB;

-- Add category_id FK to products so products link to the leaf category
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INT NULL AFTER category;
ALTER TABLE products ADD CONSTRAINT fk_product_category
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);

-- ── Seed Data: starter categories matching KenLynk's existing slugs ──

-- Level 0: Main categories
INSERT IGNORE INTO categories (name, slug, icon, position) VALUES
  ('Electronics',      'electronics',  '📱', 1),
  ('Fashion',          'fashion',      '👗', 2),
  ('Grocery',          'grocery',      '🛒', 3),
  ('Home & Living',    'home-living',  '🏠', 4),
  ('Beauty & Health',  'beauty',       '💄', 5),
  ('Sports & Fitness', 'sports',       '⚽', 6),
  ('Automotive',       'automotive',   '🚗', 7),
  ('Books & Stationery','books',       '📚', 8),
  ('Kids & Toys',      'kids',         '🧸', 9),
  ('Agriculture',      'agriculture',  '🌾', 10);

-- Level 1: Subcategories (Electronics)
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Mobile Phones',     'electronics-mobile-phones',  '📱', 1 FROM categories WHERE slug='electronics';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Laptops & Computers','electronics-laptops',       '💻', 2 FROM categories WHERE slug='electronics';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Audio & Headphones','electronics-audio',          '🎧', 3 FROM categories WHERE slug='electronics';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'TVs & Displays',    'electronics-tvs',            '📺', 4 FROM categories WHERE slug='electronics';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Cameras',           'electronics-cameras',        '📷', 5 FROM categories WHERE slug='electronics';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Power & Solar',     'electronics-power',          '⚡', 6 FROM categories WHERE slug='electronics';

-- Level 2: Child categories (Mobile Phones)
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Smartphones',       'electronics-mobile-smartphones', '📲', 1 FROM categories WHERE slug='electronics-mobile-phones';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Feature Phones',    'electronics-mobile-feature',     '📞', 2 FROM categories WHERE slug='electronics-mobile-phones';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Phone Accessories', 'electronics-mobile-accessories', '🔌', 3 FROM categories WHERE slug='electronics-mobile-phones';

-- Level 1: Subcategories (Fashion)
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, "Women's Fashion",   'fashion-women', '👗', 1 FROM categories WHERE slug='fashion';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, "Men's Fashion",     'fashion-men',   '👔', 2 FROM categories WHERE slug='fashion';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, "Kids' Fashion",     'fashion-kids',  '🧒', 3 FROM categories WHERE slug='fashion';

-- Level 2: Child categories (Women's Fashion)
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Dresses',  'fashion-women-dresses',  '👗', 1 FROM categories WHERE slug='fashion-women';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Shoes',    'fashion-women-shoes',     '👠', 2 FROM categories WHERE slug='fashion-women';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Handbags', 'fashion-women-handbags',  '👜', 3 FROM categories WHERE slug='fashion-women';

-- Level 2: Child categories (Men's Fashion)
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Shirts & T-Shirts', 'fashion-men-shirts',  '👕', 1 FROM categories WHERE slug='fashion-men';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Shoes',             'fashion-men-shoes',    '👞', 2 FROM categories WHERE slug='fashion-men';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Watches',           'fashion-men-watches',  '⌚', 3 FROM categories WHERE slug='fashion-men';

-- Level 1: Subcategories (Home & Living)
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Furniture',       'home-living-furniture',  '🪑', 1 FROM categories WHERE slug='home-living';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Kitchen & Dining','home-living-kitchen',    '🍳', 2 FROM categories WHERE slug='home-living';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Bedding',         'home-living-bedding',    '🛏️', 3 FROM categories WHERE slug='home-living';

-- Level 1: Subcategories (Grocery)
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Fresh Produce',   'grocery-fresh',    '🥦', 1 FROM categories WHERE slug='grocery';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Dairy & Eggs',    'grocery-dairy',    '🥛', 2 FROM categories WHERE slug='grocery';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Cereals & Grains','grocery-cereals',  '🌾', 3 FROM categories WHERE slug='grocery';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Animal Feeds',    'grocery-feeds',    '🌿', 4 FROM categories WHERE slug='grocery';

-- Level 1: Subcategories (Agriculture)
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Seeds & Fertilisers','agriculture-seeds',    '🌱', 1 FROM categories WHERE slug='agriculture';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Livestock',          'agriculture-livestock','🐄', 2 FROM categories WHERE slug='agriculture';
INSERT IGNORE INTO categories (parent_id, name, slug, icon, position)
SELECT id, 'Farm Equipment',     'agriculture-equipment','🚜', 3 FROM categories WHERE slug='agriculture';
