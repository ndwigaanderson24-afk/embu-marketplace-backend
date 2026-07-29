// models/cart.js
// Server-side cart, keyed by user_id (logged in) or session_id (guest).
// Every function takes an `owner` object: { userId } or { sessionId } -
// exactly one should be set, matching how the website supports guest
// checkout without ever forcing a login.

const pool = require('../db');

function ownerClause(owner) {
  return owner.userId ? { clause: 'user_id = ?', value: owner.userId } : { clause: 'session_id = ?', value: owner.sessionId };
}

const Cart = {
  async getItems(owner) {
    const { clause, value } = ownerClause(owner);
    const [rows] = await pool.query(
      `SELECT c.id AS cart_item_id, c.qty, p.* FROM cart_items c
       JOIN products p ON p.id = c.product_id
       WHERE c.${clause}`,
      [value]
    );
    return rows;
  },

  async addItem(owner, productId, qty = 1) {
    const [existing] = owner.userId
      ? await pool.query('SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?', [owner.userId, productId])
      : await pool.query('SELECT * FROM cart_items WHERE session_id = ? AND product_id = ?', [owner.sessionId, productId]);

    if (existing.length) {
      await pool.query('UPDATE cart_items SET qty = qty + ? WHERE id = ?', [qty, existing[0].id]);
      return existing[0].id;
    }
    const [result] = await pool.query(
      'INSERT INTO cart_items (user_id, session_id, product_id, qty) VALUES (?,?,?,?)',
      [owner.userId || null, owner.sessionId || null, productId, qty]
    );
    return result.insertId;
  },

  async updateQty(owner, productId, qty) {
    const { clause, value } = ownerClause(owner);
    if (qty <= 0) {
      await pool.query(`DELETE FROM cart_items WHERE ${clause} AND product_id = ?`, [value, productId]);
      return;
    }
    await pool.query(`UPDATE cart_items SET qty = ? WHERE ${clause} AND product_id = ?`, [qty, value, productId]);
  },

  async removeItem(owner, productId) {
    const { clause, value } = ownerClause(owner);
    await pool.query(`DELETE FROM cart_items WHERE ${clause} AND product_id = ?`, [value, productId]);
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
      await this.addItem({ userId }, item.product_id, item.qty);
    }
    await pool.query('DELETE FROM cart_items WHERE session_id = ?', [sessionId]);
  }
};

module.exports = Cart;
