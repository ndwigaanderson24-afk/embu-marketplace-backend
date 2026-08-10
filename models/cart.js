// models/cart.js
// Server-side cart, keyed by user_id (logged in) or session_id (guest).
// Every function takes an `owner` object: { userId } or { sessionId } -
// exactly one should be set, matching how the website supports guest
// checkout without ever forcing a login.
//
// Variant-aware: a cart line can optionally carry a variant_id (e.g. a
// specific colour) - two lines for the same product but different
// variants are kept separate, never merged, since they may have
// different price/stock/SKU and the seller needs to know exactly which
// one was ordered. A line with no variant_id (variant_id IS NULL) is
// its own group too, distinct from any variant of the same product.

const pool = require('../db');

function ownerClause(owner) {
  return owner.userId ? { clause: 'user_id = ?', value: owner.userId } : { clause: 'session_id = ?', value: owner.sessionId };
}

// Builds the extra WHERE fragment + params needed to match a specific
// variant line (or specifically the no-variant line) alongside product_id.
function variantClause(variantId) {
  return variantId ? { sql: 'AND variant_id = ?', params: [variantId] } : { sql: 'AND variant_id IS NULL', params: [] };
}

const Cart = {
  // Returns each cart line joined to its product, with price/stock
  // overridden by the selected variant's own price/stock when one is
  // attached - price/stock are never trusted from the client, only ever
  // read fresh from the products/product_variants tables here.
  async getItems(owner) {
    const { clause, value } = ownerClause(owner);
    const [rows] = await pool.query(
      `SELECT c.id AS cart_item_id, c.qty, c.variant_id, c.variant_name,
              p.*,
              COALESCE(v.price, p.price) AS price,
              COALESCE(v.stock, p.stock) AS stock,
              v.sku AS variant_sku,
              v.images_json AS variant_images_json
       FROM cart_items c
       JOIN products p ON p.id = c.product_id
       LEFT JOIN product_variants v ON v.id = c.variant_id
       WHERE c.${clause}`,
      [value]
    );
    return rows;
  },

  async addItem(owner, productId, qty = 1, variantId = null, variantName = null) {
    const vc = variantClause(variantId);
    const [existing] = owner.userId
      ? await pool.query(`SELECT * FROM cart_items WHERE user_id = ? AND product_id = ? ${vc.sql}`, [owner.userId, productId, ...vc.params])
      : await pool.query(`SELECT * FROM cart_items WHERE session_id = ? AND product_id = ? ${vc.sql}`, [owner.sessionId, productId, ...vc.params]);

    if (existing.length) {
      await pool.query('UPDATE cart_items SET qty = qty + ? WHERE id = ?', [qty, existing[0].id]);
      return existing[0].id;
    }
    const [result] = await pool.query(
      'INSERT INTO cart_items (user_id, session_id, product_id, qty, variant_id, variant_name) VALUES (?,?,?,?,?,?)',
      [owner.userId || null, owner.sessionId || null, productId, qty, variantId || null, variantName || null]
    );
    return result.insertId;
  },

  async updateQty(owner, productId, qty, variantId = null) {
    const { clause, value } = ownerClause(owner);
    const vc = variantClause(variantId);
    if (qty <= 0) {
      await pool.query(`DELETE FROM cart_items WHERE ${clause} AND product_id = ? ${vc.sql}`, [value, productId, ...vc.params]);
      return;
    }
    await pool.query(`UPDATE cart_items SET qty = ? WHERE ${clause} AND product_id = ? ${vc.sql}`, [qty, value, productId, ...vc.params]);
  },

  async removeItem(owner, productId, variantId = null) {
    const { clause, value } = ownerClause(owner);
    const vc = variantClause(variantId);
    await pool.query(`DELETE FROM cart_items WHERE ${clause} AND product_id = ? ${vc.sql}`, [value, productId, ...vc.params]);
  },

  async clear(owner) {
    const { clause, value } = ownerClause(owner);
    await pool.query(`DELETE FROM cart_items WHERE ${clause}`, [value]);
  },

  // Called right after login, so a guest's cart carries over instead of
  // being lost - matches the expected UX even though the current
  // frontend keeps cart in localStorage rather than calling this yet.
  async mergeGuestCartIntoUser(sessionId, userId) {
    const [guestItems] = await pool.query('SELECT * FROM cart_items WHERE session_id = ?', [sessionId]);
    for (const item of guestItems) {
      await this.addItem({ userId }, item.product_id, item.qty, item.variant_id, item.variant_name);
    }
    await pool.query('DELETE FROM cart_items WHERE session_id = ?', [sessionId]);
  }
};

module.exports = Cart;
