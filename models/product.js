// models/product.js

const pool = require('../db');
const PricingRule = require('./pricingRule');
const PricingSettings = require('./pricingSettings');
const { computeFinalPrice } = require('../helpers');

// Shared by create/update - fetches the current active rules + global
// settings and runs the actual calculation. Kept in one place so
// product creation and product editing can never compute the price
// two different ways.
async function priceProduct(sellerPrice, { category, fragile }) {
  const [rules, settings] = await Promise.all([
    PricingRule.findAllActive(),
    PricingSettings.get()
  ]);
  return computeFinalPrice(sellerPrice, { category, fragile }, rules, settings);
}

const Product = {
  // Exposed for the price-preview endpoint, so a seller can see the
  // final price before actually creating/saving anything.
  async previewPrice(sellerPrice, { category, fragile }) {
    return priceProduct(sellerPrice, { category, fragile });
  },

  // One-time migration: every product created before the pricing engine
  // existed has a plain price and no seller_price at all. This treats
  // that existing price as what the seller was actually asking for,
  // then computes a new final price on top of it using the current
  // rules/defaults - after this runs, that product behaves exactly like
  // one created fresh under the new system.
  //
  // Only touches products where seller_price IS NULL, so running this
  // twice is safe - it will never re-apply markup to an already-migrated
  // or newly-created product.
  async migrateExistingPricing() {
    const [rows] = await pool.query('SELECT id, price, category, fragile FROM products WHERE seller_price IS NULL');
    let migrated = 0;
    const errors = [];
    for (const row of rows) {
      try {
        const priced = await priceProduct(row.price, { category: row.category, fragile: !!row.fragile });
        await pool.query(
          `UPDATE products SET seller_price = ?, price = ?, price_margin = ?,
           price_delivery_allocation = ?, price_risk_allocation = ? WHERE id = ?`,
          [priced.sellerPrice, priced.finalPrice, priced.margin, priced.deliveryAllocation, priced.riskAllocation, row.id]
        );
        migrated++;
      } catch (err) {
        errors.push({ productId: row.id, error: err.message });
      }
    }
    return { totalFound: rows.length, migrated, errors };
  },

  async create(sellerId, data) {
    const priced = await priceProduct(data.seller_price, { category: data.category, fragile: !!data.fragile });

    const [result] = await pool.query(
      `INSERT INTO products
        (seller_id, name, description, category, price, seller_price, price_margin,
         price_delivery_allocation, price_risk_allocation, original_price, emoji, image, video,
         weight, fragile, stock, county, hot, status, low_stock_threshold)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [sellerId || null, data.name, data.description || null, data.category || null,
       priced.finalPrice, priced.sellerPrice, priced.margin, priced.deliveryAllocation, priced.riskAllocation,
       data.original_price || null, data.emoji || null, data.image || null, data.video || null,
       data.weight || 1, !!data.fragile, data.stock || 0, data.county || null, !!data.hot,
       data.status || 'active', data.low_stock_threshold || null]
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

  // Re-runs the pricing calculation whenever seller_price, category, or
  // fragile status changes - those are the only inputs that affect the
  // final price, so a plain stock/description edit skips this entirely.
  // price/price_margin/price_delivery_allocation/price_risk_allocation
  // are stripped from the incoming data unconditionally first - a
  // client can NEVER set the buyer-facing price directly, only ever
  // through this calculation.
  async _repriceIfNeeded(id, data, currentRow) {
    const { price, price_margin, price_delivery_allocation, price_risk_allocation, ...clean } = data;
    const touchesPricing = clean.seller_price !== undefined || clean.category !== undefined || clean.fragile !== undefined;
    if (!touchesPricing) return clean;
    const sellerPrice = clean.seller_price !== undefined ? clean.seller_price : currentRow.seller_price;
    const category = clean.category !== undefined ? clean.category : currentRow.category;
    const fragile = clean.fragile !== undefined ? !!clean.fragile : !!currentRow.fragile;
    const priced = await priceProduct(sellerPrice, { category, fragile });
    return {
      ...clean,
      seller_price: priced.sellerPrice,
      price: priced.finalPrice,
      price_margin: priced.margin,
      price_delivery_allocation: priced.deliveryAllocation,
      price_risk_allocation: priced.riskAllocation
    };
  },

  async update(id, sellerId, data) {
    const current = await this.findById(id);
    if (!current || current.seller_id !== sellerId) return false;
    data = await this._repriceIfNeeded(id, data, current);

    const allowed = ['name', 'description', 'category', 'price', 'seller_price', 'price_margin',
      'price_delivery_allocation', 'price_risk_allocation', 'original_price', 'emoji',
      'image', 'video', 'weight', 'fragile', 'stock', 'hot', 'status', 'low_stock_threshold'];
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
    data = await this._repriceIfNeeded(id, data, current);

    const allowed = ['name', 'description', 'category', 'price', 'seller_price', 'price_margin',
      'price_delivery_allocation', 'price_risk_allocation', 'original_price', 'emoji',
      'image', 'video', 'weight', 'fragile', 'stock', 'hot', 'status', 'low_stock_threshold'];
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
