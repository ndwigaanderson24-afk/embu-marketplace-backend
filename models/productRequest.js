// models/productRequest.js
// Real, server-side product requests - a buyer asks for something not
// currently listed, admin shares it with sellers, sellers make supply
// offers, admin approves one, buyer confirms. Every step here is
// visible from any device for whichever role needs to see it, unlike
// the previous localStorage-only version.

const pool = require('../db');

const ProductRequest = {
  async create(data) {
    const [result] = await pool.query(
      `INSERT INTO product_requests
        (buyer_user_id, full_name, phone, email, delivery_location, product_name, category, description, quantity, budget, needed_by_date, image)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [data.buyer_user_id || null, data.full_name, data.phone, data.email || null, data.delivery_location,
       data.product_name, data.category || null, data.description, data.quantity || 1, data.budget || null,
       data.needed_by_date || null, data.image || null]
    );
    return result.insertId;
  },

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM product_requests WHERE id = ?', [id]);
    return rows[0] || null;
  },

  // A buyer's own requests - matched by their account if logged in, or
  // by phone number for guests, same as the old localStorage version
  // matched by phone/userId.
  async findForBuyer({ userId, phone }) {
    const [rows] = await pool.query(
      'SELECT * FROM product_requests WHERE (buyer_user_id = ? OR phone = ?) ORDER BY created_at DESC',
      [userId || 0, phone || '']
    );
    return rows;
  },

  // What a seller browsing for requests to fulfil should see - only
  // ones admin has actually shared, matching the original flow where
  // requests aren't visible to sellers until admin opts them in.
  async findSharedWithSellers() {
    const [rows] = await pool.query(
      `SELECT * FROM product_requests WHERE status IN ('shared_with_sellers','seller_found') ORDER BY created_at DESC`
    );
    return rows;
  },

  async findAllForAdmin() {
    const [rows] = await pool.query('SELECT * FROM product_requests ORDER BY created_at DESC');
    return rows;
  },

  async updateStatus(id, status, extra = {}) {
    const fields = ['status = ?'];
    const values = [status];
    if ('approved_offer_id' in extra) { fields.push('approved_offer_id = ?'); values.push(extra.approved_offer_id); }
    if ('order_id' in extra) { fields.push('order_id = ?'); values.push(extra.order_id); }
    values.push(id);
    await pool.query(`UPDATE product_requests SET ${fields.join(', ')} WHERE id = ?`, values);
  }
};

const RequestOffer = {
  async create(requestId, data) {
    const [result] = await pool.query(
      'INSERT INTO request_offers (request_id, seller_id, available_qty, price, delivery_time, notes) VALUES (?,?,?,?,?,?)',
      [requestId, data.seller_id, data.available_qty, data.price, data.delivery_time, data.notes || null]
    );
    return result.insertId;
  },

  // Every offer for a request, joined to the seller's public info - the
  // shape both admin's review panel and the buyer's confirmation screen
  // need.
  async findByRequestId(requestId) {
    const [rows] = await pool.query(
      `SELECT ro.*, u.business_name AS seller_business_name, u.email AS seller_email
       FROM request_offers ro JOIN users u ON u.id = ro.seller_id
       WHERE ro.request_id = ? ORDER BY ro.submitted_at ASC`,
      [requestId]
    );
    return rows;
  },

  async findById(id) {
    const [rows] = await pool.query(
      `SELECT ro.*, u.business_name AS seller_business_name, u.email AS seller_email
       FROM request_offers ro JOIN users u ON u.id = ro.seller_id WHERE ro.id = ?`,
      [id]
    );
    return rows[0] || null;
  },

  async hasSellerAlreadyOffered(requestId, sellerId) {
    const [rows] = await pool.query('SELECT id FROM request_offers WHERE request_id = ? AND seller_id = ?', [requestId, sellerId]);
    return rows.length > 0;
  },

  async updateStatus(id, status) {
    await pool.query('UPDATE request_offers SET status = ? WHERE id = ?', [status, id]);
  },

  async findPendingCountForRequest(requestId) {
    const [rows] = await pool.query("SELECT COUNT(*) AS c FROM request_offers WHERE request_id = ? AND status = 'pending'", [requestId]);
    return rows[0].c;
  }
};

module.exports = { ProductRequest, RequestOffer };
