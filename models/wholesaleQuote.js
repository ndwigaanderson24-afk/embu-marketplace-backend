// models/wholesaleQuote.js
// A buyer requesting a custom bulk quote on a specific wholesale
// product - distinct from the general "Can't Find What You Want?"
// custom request feature (page-request), which isn't tied to any
// specific existing product or seller. This one always has a real
// product_id and seller_id attached, since it comes from the
// "Request Bulk Quote" button on an actual wholesale listing.

const pool = require('../db');

const WholesaleQuote = {
  async create({ productId, sellerId, buyerUserId, buyerName, buyerPhone, buyerEmail, quantityRequested, message }) {
    const [result] = await pool.query(
      `INSERT INTO wholesale_quote_requests
        (product_id, seller_id, buyer_user_id, buyer_name, buyer_phone, buyer_email, quantity_requested, message, status)
       VALUES (?,?,?,?,?,?,?,?,'pending')`,
      [productId, sellerId, buyerUserId || null, buyerName, buyerPhone, buyerEmail || null, quantityRequested, message || null]
    );
    return result.insertId;
  },

  // A seller's own incoming bulk-quote requests, newest first, with
  // enough product context to act on without a second lookup.
  async findForSeller(sellerId) {
    const [rows] = await pool.query(
      `SELECT wq.*, p.name AS product_name, p.image AS product_image
       FROM wholesale_quote_requests wq
       JOIN products p ON p.id = wq.product_id
       WHERE wq.seller_id = ?
       ORDER BY wq.created_at DESC`,
      [sellerId]
    );
    return rows;
  },

  async updateStatus(id, sellerId, status) {
    const [result] = await pool.query(
      "UPDATE wholesale_quote_requests SET status = ? WHERE id = ? AND seller_id = ? AND status IN ('pending','responded')",
      [status, id, sellerId]
    );
    return result.affectedRows > 0;
  }
};

module.exports = WholesaleQuote;
