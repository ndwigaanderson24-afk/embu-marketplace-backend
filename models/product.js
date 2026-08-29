// models/product.js

const pool = require('../db');
const { computeFinalPrice, SELLER_PLAN_PRODUCT_LIMITS } = require('../helpers');
const { uploadAnyToCloudinary, needsMigration } = require('../cloudinaryUpload');

// Shared by create/update - runs the actual calculation in one place so
// product creation and product editing can never compute the price two
// different ways. Weight-driven, not category/fragile-driven - the old
// pricing_rules/pricing_settings tables are no longer read here at all.
function priceProduct(sellerPrice, { weight }) {
  return computeFinalPrice(sellerPrice, { weight });
}

const Product = {
  // Exposed for the price-preview endpoint, so a seller can see the
  // final price before actually creating/saving anything.
  async previewPrice(sellerPrice, { weight }) {
    return priceProduct(sellerPrice, { weight });
  },

  // This replaces both of the old pricing migrations (migrateExistingPricing
  // for never-priced products, backfillCategoryCommission for the old
  // per-category commission rollout) with a single pass: every existing
  // product, regardless of its current pricing state, gets its price
  // recalculated under the new fixed commission/delivery-fee brackets.
  // seller_price is treated as the base "Product Price" the new formula
  // starts from (falling back to whatever price was already stored, for
  // any product that somehow never had seller_price set at all) - the
  // final buyer-facing price is what actually changes here, seller_price
  // itself is left as-is. Safe to run more than once, e.g. after
  // deliberately changing the bracket amounts in code and wanting every
  // product to pick up the new numbers.
  async recalculateAllPricesNewModel() {
    const [rows] = await pool.query('SELECT id, price, seller_price, weight FROM products');
    let migrated = 0;
    const errors = [];
    for (const row of rows) {
      try {
        const basePrice = row.seller_price !== null && row.seller_price !== undefined ? row.seller_price : row.price;
        const priced = priceProduct(basePrice, { weight: row.weight });
        await pool.query(
          `UPDATE products SET seller_price = ?, price = ?, price_commission = ?, price_delivery_fee = ? WHERE id = ?`,
          [priced.sellerPrice, priced.finalPrice, priced.commission, priced.deliveryFee, row.id]
        );
        migrated++;
      } catch (err) {
        errors.push({ productId: row.id, error: err.message });
      }
    }
    return { totalFound: rows.length, migrated, errors };
  },

  // One-time migration: moves every existing product photo that isn't
  // already on Cloudinary (raw base64 still sitting in the database, or
  // an old link pointing at Render's own /uploads/ disk) over to
  // Cloudinary, rewriting the stored value to the real URL Cloudinary
  // hands back. Only touches rows that actually still need it, so it's
  // safe to run more than once - same pattern as the pricing migrations
  // above. Covers both the single `image` field and every entry inside
  // `images_json` (a product can have more than one photo).
  async migrateImagesToCloudinary() {
    const [rows] = await pool.query(`
      SELECT id, image, images_json FROM products
      WHERE (image IS NOT NULL AND image != '' AND image NOT LIKE '%res.cloudinary.com%')
         OR (images_json IS NOT NULL AND images_json NOT LIKE '%res.cloudinary.com%'
             AND images_json != '[]' AND images_json != 'null')
    `);
    let migrated = 0;
    const errors = [];
    for (const row of rows) {
      try {
        let changed = false;
        let newImage = row.image;
        let newImagesJson = row.images_json;

        if (needsMigration(row.image)) {
          newImage = await uploadAnyToCloudinary(row.image, 'kenlynk/products');
          changed = true;
        }

        if (row.images_json) {
          const images = JSON.parse(row.images_json);
          if (Array.isArray(images) && images.some(needsMigration)) {
            const migratedImages = [];
            for (const img of images) {
              migratedImages.push(needsMigration(img) ? await uploadAnyToCloudinary(img, 'kenlynk/products') : img);
            }
            newImagesJson = JSON.stringify(migratedImages);
            changed = true;
          }
        }

        if (changed) {
          await pool.query('UPDATE products SET image = ?, images_json = ? WHERE id = ?', [newImage, newImagesJson, row.id]);
          migrated++;
        }
      } catch (err) {
        errors.push({ productId: row.id, error: err.message });
      }
    }
    return { totalFound: rows.length, migrated, errors };
  },

  // Normalizes the raw payload the seller/admin forms actually send:
  // - images (array) -> images_json (stored as a JSON string)
  // - wholesale_tiers (array) -> wholesale_tiers_json
  // - made_in_kenya is derived from country_of_origin, never sent directly
  // Used by create/update/updateAsAdmin so all three handle every real
  // field the same way - this replaces an earlier version of this file
  // that silently dropped most of these (including images), based on a
  // stale copy that predated several fields being added.
  _normalizeIncoming(data) {
    const out = { ...data };
    if (out.images !== undefined) {
      out.images_json = JSON.stringify(out.images || []);
      if (!out.image && out.images && out.images.length) out.image = out.images[0];
      delete out.images;
    }
    if (out.wholesale_tiers !== undefined) {
      out.wholesale_tiers_json = JSON.stringify(out.wholesale_tiers || []);
      delete out.wholesale_tiers;
    }
    if (out.country_of_origin !== undefined) {
      out.made_in_kenya = out.country_of_origin === 'Kenya';
    }
    if (out.has_variants !== undefined) out.has_variants = !!out.has_variants ? 1 : 0;
    return out;
  },

  // Whether a seller can add one more product right now, based on their
  // EFFECTIVE plan (see SELLER_PLAN_PRODUCT_LIMITS comment in helpers.js)
  // and how many products they already have. Deliberately a separate
  // method rather than baked into create() itself, so the controller can
  // check it first and return a clean, specific error message - this was
  // the one confirmed real gap in the whole plan system: a Free seller
  // could list unlimited products despite the documented 20-product cap,
  // since nothing anywhere actually enforced it before now. Counts every
  // product the seller has regardless of active/inactive status, so
  // hiding old listings can't be used to sneak past the cap.
  async checkProductLimit(sellerId) {
    const [[planRow]] = await pool.query(
      `SELECT
         CASE
           WHEN subscription_status = 'active' AND subscription_end >= CURDATE()
             THEN COALESCE(seller_plan, 'free')
           ELSE 'free'
         END AS effective_plan
       FROM users WHERE id = ?`,
      [sellerId]
    );
    const effectivePlan = (planRow && SELLER_PLAN_PRODUCT_LIMITS[planRow.effective_plan] !== undefined)
      ? planRow.effective_plan
      : 'free';
    const limit = SELLER_PLAN_PRODUCT_LIMITS[effectivePlan];

    const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM products WHERE seller_id = ?', [sellerId]);

    return {
      allowed: count < limit,
      current: count,
      limit: limit === Infinity ? null : limit,
      effectivePlan
    };
  },

  async create(sellerId, data) {
    data = this._normalizeIncoming(data);
    const priced = priceProduct(data.seller_price, { weight: data.weight || 1 });

    const [result] = await pool.query(
      `INSERT INTO products
        (seller_id, name, description, category, category_id, brand, price, seller_price, price_commission,
         price_delivery_fee, original_price, emoji, image, images_json, video,
         weight, fragile, stock, county, hot, is_new_arrival, is_best_rated, country_of_origin, made_in_kenya,
         flash_deal_ends_at, wholesale_tiers_json, has_variants, status, low_stock_threshold,
         kanyaga_price, kanyaga_start_at, kanyaga_end_at, kanyaga_campaign)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [sellerId || null, data.name, data.description || null, data.category || null, data.category_id || null,
       data.brand || null, priced.finalPrice, priced.sellerPrice, priced.commission, priced.deliveryFee,
       data.original_price || null, data.emoji || null, data.image || null, data.images_json || null, data.video || null,
       data.weight || 1, !!data.fragile, data.stock || 0, data.county || null, !!data.hot,
       !!data.is_new_arrival, !!data.is_best_rated, data.country_of_origin || null, !!data.made_in_kenya,
       data.flash_deal_ends_at || null, data.wholesale_tiers_json || null, data.has_variants || 0,
       data.status || 'active', data.low_stock_threshold || null,
       data.kanyaga_price || null, data.kanyaga_start_at || null, data.kanyaga_end_at || null,
       data.kanyaga_price ? (data.kanyaga_campaign || 'kanyaga') : null]
    );
    return result.insertId;
  },

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async findBySeller(sellerId, { limit = 100, offset = 0 } = {}) {
    const [rows] = await pool.query(
      'SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [sellerId, Number(limit), Number(offset)]
    );
    return rows;
  },

  // Public storefront listing - only active products from sellers whose
  // shop is actually active (approved + subscribed + not disabled), or
  // platform/demo products (seller_id IS NULL), matching the website's
  // getFilteredProducts() behaviour.
  // Every wholesale-enabled product across every category - "enabled"
  // simply means it has wholesale tiers set, same signal the existing
  // Shop-page wholesale filter chip already uses (no separate
  // wholesale_enabled column needed, per the existing product/category
  // system already covering this). Reuses findPublic's exact seller-
  // visibility rules (approved, not disabled, plan-eligible) so a
  // wholesale listing never shows a product a buyer couldn't actually
  // buy from the regular Shop page. Filtering/sorting on tier data
  // (price, MOQ) happens in the controller, not here, since tiers are
  // stored as JSON and matching the existing pattern elsewhere in this
  // codebase (getUnitPriceForQty) of parsing them in JS is safer than
  // fragile JSON-path SQL.
  async findWholesale() {
    const [rows] = await pool.query(`
      SELECT p.*, u.email AS seller_email, u.business_name AS seller_business_name
      FROM products p
      LEFT JOIN users u ON u.id = p.seller_id
      WHERE p.status = 'active'
      AND (
        p.seller_id IS NULL
        OR (u.seller_status = 'approved' AND u.shop_disabled = FALSE AND (
          COALESCE(u.seller_plan, 'free') = 'free'
          OR (u.subscription_status = 'active' AND u.subscription_end >= CURDATE())
        ))
      )
      AND p.wholesale_tiers_json IS NOT NULL
      AND p.wholesale_tiers_json != '[]'
      AND p.wholesale_tiers_json != 'null'
    `);
    return rows;
  },

  // Every product currently flagged for Kanyaga (any campaign variant -
  // "kanyaga", "kanyaga_week", "mega_kanyaga" etc - the field exists
  // specifically so future campaigns need zero schema changes). Same
  // seller-visibility rules as findWholesale/findPublic. Whether a
  // given row is currently Active/Scheduled/Expired is worked out live
  // in the controller from kanyaga_start_at/kanyaga_end_at, never
  // stored, so it can't go stale.
  async findKanyaga() {
    const [rows] = await pool.query(`
      SELECT p.*, u.email AS seller_email, u.business_name AS seller_business_name
      FROM products p
      LEFT JOIN users u ON u.id = p.seller_id
      WHERE p.status = 'active'
      AND (
        p.seller_id IS NULL
        OR (u.seller_status = 'approved' AND u.shop_disabled = FALSE AND (
          COALESCE(u.seller_plan, 'free') = 'free'
          OR (u.subscription_status = 'active' AND u.subscription_end >= CURDATE())
        ))
      )
      AND p.kanyaga_price IS NOT NULL
    `);
    return rows;
  },

  async findPublic({ category, search, limit = 50, offset = 0 } = {}) {
    let sql = `
      SELECT p.*, u.email AS seller_email, u.business_name AS seller_business_name
      FROM products p
      LEFT JOIN users u ON u.id = p.seller_id
      WHERE p.status = 'active'
      AND (
        p.seller_id IS NULL
        OR (u.seller_status = 'approved' AND u.shop_disabled = FALSE AND (
          COALESCE(u.seller_plan, 'free') = 'free'
          OR (u.subscription_status = 'active' AND u.subscription_end >= CURDATE())
        ))
      )`;
    const params = [];
    if (category) { sql += ' AND p.category = ?'; params.push(category); }
    if (search) { sql += ' AND p.name LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const [rows] = await pool.query(sql, params);
    return rows;
  },

  // Re-runs the pricing calculation whenever seller_price or weight
  // changes - those are the only two inputs the new fixed-bracket model
  // uses (category and fragile status no longer affect price at all).
  // price/price_commission/price_delivery_fee are stripped from the
  // incoming data unconditionally first - a client can NEVER set the
  // buyer-facing price directly, only ever through this calculation.
  async _repriceIfNeeded(id, data, currentRow) {
    const { price, price_commission, price_delivery_fee, ...clean } = data;
    const touchesPricing = clean.seller_price !== undefined || clean.weight !== undefined;
    if (!touchesPricing) return clean;
    const sellerPrice = clean.seller_price !== undefined ? clean.seller_price : currentRow.seller_price;
    const weight = clean.weight !== undefined ? clean.weight : currentRow.weight;
    const priced = priceProduct(sellerPrice, { weight });
    return {
      ...clean,
      seller_price: priced.sellerPrice,
      price: priced.finalPrice,
      price_commission: priced.commission,
      price_delivery_fee: priced.deliveryFee
    };
  },

  async update(id, sellerId, data) {
    const current = await this.findById(id);
    if (!current || current.seller_id !== sellerId) return false;
    data = this._normalizeIncoming(data);
    data = await this._repriceIfNeeded(id, data, current);

    const allowed = ['name', 'description', 'category', 'category_id', 'brand', 'price', 'seller_price', 'price_commission', 'price_delivery_fee', 'original_price', 'emoji',
      'image', 'images_json', 'video', 'weight', 'fragile', 'stock', 'hot', 'is_new_arrival', 'is_best_rated',
      'country_of_origin', 'made_in_kenya', 'flash_deal_ends_at', 'wholesale_tiers_json', 'has_variants',
      'status', 'low_stock_threshold', 'kanyaga_price', 'kanyaga_start_at', 'kanyaga_end_at', 'kanyaga_campaign'];
    const keys = Object.keys(data).filter(k => allowed.includes(k));
    if (!keys.length) return false;
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => data[k]);
    values.push(id, sellerId);
    const [result] = await pool.query(`UPDATE products SET ${setClause} WHERE id = ? AND seller_id = ?`, values);
    return result.affectedRows > 0;
  },

  // Admin-only update: edits any product regardless of which seller (or
  // no seller) owns it - used for platform products added directly by
  // an admin, since those have no seller to match against.
  async updateAsAdmin(id, data) {
    const current = await this.findById(id);
    if (!current) return false;
    data = this._normalizeIncoming(data);
    data = await this._repriceIfNeeded(id, data, current);

    const allowed = ['name', 'description', 'category', 'category_id', 'brand', 'price', 'seller_price', 'price_commission', 'price_delivery_fee', 'original_price', 'emoji',
      'image', 'images_json', 'video', 'weight', 'fragile', 'stock', 'hot', 'is_new_arrival', 'is_best_rated',
      'country_of_origin', 'made_in_kenya', 'flash_deal_ends_at', 'wholesale_tiers_json', 'has_variants',
      'status', 'low_stock_threshold', 'kanyaga_price', 'kanyaga_start_at', 'kanyaga_end_at', 'kanyaga_campaign'];
    const keys = Object.keys(data).filter(k => allowed.includes(k));
    if (!keys.length) return false;
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => data[k]);
    values.push(id);
    const [result] = await pool.query(`UPDATE products SET ${setClause} WHERE id = ?`, values);
    return result.affectedRows > 0;
  },

  async delete(id, sellerId) {
    const [result] = await pool.query('DELETE FROM products WHERE id = ? AND seller_id = ?', [id, sellerId]);
    return result.affectedRows > 0;
  },

  // Admin-only removal: deletes any product regardless of which seller
  // owns it. Used when a product violates platform standards and needs
  // to come down permanently, as opposed to adminHide/adminUnhide which
  // just toggle visibility and can be reversed by the seller re-listing.
  async deleteAsAdmin(id) {
    const [result] = await pool.query('DELETE FROM products WHERE id = ?', [id]);
    return result.affectedRows > 0;
  },

  async decrementStock(id, qty) {
    await pool.query('UPDATE products SET stock = GREATEST(0, stock - ?) WHERE id = ?', [qty, id]);
  },

  async addReview(id, rating) {
    const product = await this.findById(id);
    if (!product) return;
    const newCount = product.num_reviews + 1;
    const newAvg = ((product.rating * product.num_reviews) + rating) / newCount;
    await pool.query('UPDATE products SET rating = ?, num_reviews = ? WHERE id = ?', [newAvg.toFixed(2), newCount, id]);
  },

  // Admin view - every product regardless of seller shop status.
  async findAllForAdmin({ limit = 100, offset = 0 } = {}) {
    const [rows] = await pool.query(
      `SELECT p.*, u.business_name AS seller_business_name FROM products p
       LEFT JOIN users u ON u.id = p.seller_id
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [Number(limit), Number(offset)]
    );
    return rows;
  }
};

module.exports = Product;
