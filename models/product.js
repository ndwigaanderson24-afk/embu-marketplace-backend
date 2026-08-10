// models/product.js

const pool = require('../db');

const Product = {
  async create(sellerId, data) {
    // images_json holds the full gallery (array of image URLs/data-URIs);
    // `image` keeps mirroring the first one so every existing feature
    // that only ever reads `.image` (cards, cart, orders, admin lists)
    // keeps working unchanged.
    const images = Array.isArray(data.images) ? data.images.filter(Boolean) : null;
    const primaryImage = (images && images.length) ? images[0] : (data.image || null);
    const imagesJson = (images && images.length) ? JSON.stringify(images) : null;

    const [result] = await pool.query(
      `INSERT INTO products
        (seller_id, name, description, category, category_id, price, original_price, emoji, image, images_json, video,
         weight, fragile, stock, county, hot, flash_deal_ends_at, status, low_stock_threshold)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [sellerId || null, data.name, data.description || null, data.category || null, data.category_id || null, data.price,
       data.original_price || null, data.emoji || null, primaryImage, imagesJson, data.video || null,
       data.weight || 1, !!data.fragile, data.stock || 0, data.county || null, !!data.hot, data.flash_deal_ends_at || null,
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
  //
  // category_ids (preferred): filter by the real category tree - pass a
  // category plus all of its descendant ids (see Category.getDescendantIds)
  // so filtering by a parent category also returns products filed under
  // its subcategories. category (legacy): still supported as a plain
  // string match for anything not yet migrated to category_id.
  async findPublic({ category, category_ids, search, limit = 50, offset = 0 } = {}) {
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
    if (category_ids && category_ids.length) {
      sql += ` AND p.category_id IN (${category_ids.map(() => '?').join(',')})`;
      params.push(...category_ids);
    } else if (category) {
      sql += ' AND p.category = ?'; params.push(category);
    }
    if (search) { sql += ' AND p.name LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const [rows] = await pool.query(sql, params);
    return rows;
  },

  async update(id, sellerId, data) {
    // If a new gallery was submitted, derive image/images_json from it
    // the same way create() does, rather than expecting the caller to
    // pass images_json pre-built.
    if (Array.isArray(data.images)) {
      const images = data.images.filter(Boolean);
      data = { ...data, image: images.length ? images[0] : data.image, images_json: images.length ? JSON.stringify(images) : null };
    }
    const allowed = ['name', 'description', 'category', 'category_id', 'price', 'original_price', 'emoji',
      'image', 'images_json', 'video', 'weight', 'fragile', 'stock', 'hot', 'flash_deal_ends_at', 'status', 'low_stock_threshold'];
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
    if (Array.isArray(data.images)) {
      const images = data.images.filter(Boolean);
      data = { ...data, image: images.length ? images[0] : data.image, images_json: images.length ? JSON.stringify(images) : null };
    }
    const allowed = ['name', 'description', 'category', 'category_id', 'price', 'original_price', 'emoji',
      'image', 'images_json', 'video', 'weight', 'fragile', 'stock', 'hot', 'flash_deal_ends_at', 'status', 'low_stock_threshold'];
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
