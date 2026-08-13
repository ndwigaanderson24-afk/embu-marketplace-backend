// models/featuredLiveRequest.js
const pool = require('../db');

const FeaturedLiveRequest = {
  async create({ seller_id, stream_id, price }) {
    const [result] = await pool.query(
      'INSERT INTO featured_live_requests (seller_id, stream_id, price) VALUES (?,?,?)',
      [seller_id, stream_id, price]
    );
    return result.insertId;
  },

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM featured_live_requests WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async findAllForAdmin() {
    const [rows] = await pool.query(
      `SELECT flr.*, u.business_name AS seller_business_name, u.email AS seller_email,
              ls.status AS stream_status, ls.channel_name
       FROM featured_live_requests flr
       JOIN users u ON u.id = flr.seller_id
       JOIN live_streams ls ON ls.id = flr.stream_id
       ORDER BY flr.created_at DESC`
    );
    return rows;
  },

  async updateStatus(id, status) {
    await pool.query('UPDATE featured_live_requests SET status = ? WHERE id = ?', [status, id]);
  }
};

module.exports = FeaturedLiveRequest;
