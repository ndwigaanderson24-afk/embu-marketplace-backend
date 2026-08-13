// models/featuredRequest.js
const pool = require('../db');

const FeaturedRequest = {
  async create({ seller_id, product_id, days, price }) {
    const [result] = await pool.query(
      'INSERT INTO featured_requests (seller_id, product_id, days, price) VALUES (?,?,?,?)',
      [seller_id, product_id, days, price]
    );
    return result.insertId;
  },

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM featured_requests WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async findAllForAdmin() {
    const [rows] = await pool.query(
      `SELECT fr.*, u.business_name AS seller_business_name, u.email AS seller_email,
              p.name AS product_name, p.image AS product_image
       FROM featured_requests fr
       JOIN users u ON u.id = fr.seller_id
       JOIN products p ON p.id = fr.product_id
       ORDER BY fr.created_at DESC`
    );
    return rows;
  },

  async updateStatus(id, status) {
    await pool.query('UPDATE featured_requests SET status = ? WHERE id = ?', [status, id]);
  }
};

module.exports = FeaturedRequest;
