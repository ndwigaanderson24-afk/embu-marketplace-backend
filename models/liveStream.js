// models/liveStream.js
// Real, server-side tracking of ShopStream live sessions - this is
// what makes "who's currently live" and viewer counts visible from any
// device (admin, other sellers, buyers), not just the seller's own
// browser tab.

const pool = require('../db');

const LiveStream = {
  async create({ sellerId, productId, channelName, title }) {
    const [result] = await pool.query(
      'INSERT INTO live_streams (seller_id, product_id, channel_name, title, status) VALUES (?,?,?,?,\'live\')',
      [sellerId, productId || null, channelName, title || null]
    );
    return result.insertId;
  },

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM live_streams WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async findByChannelName(channelName) {
    const [rows] = await pool.query('SELECT * FROM live_streams WHERE channel_name = ?', [channelName]);
    return rows[0] || null;
  },

  // Every currently-live stream, joined to the seller's public info and
  // (when set) the product being showcased - this is the single source
  // of truth for "who's live right now", read the same way regardless
  // of which device or role is asking.
  async findAllLive() {
    const [rows] = await pool.query(
      `SELECT ls.*, u.business_name AS seller_business_name, u.email AS seller_email,
              p.name AS product_name, p.image AS product_image
       FROM live_streams ls
       JOIN users u ON u.id = ls.seller_id
       LEFT JOIN products p ON p.id = ls.product_id
       WHERE ls.status = 'live'
       ORDER BY ls.started_at DESC`
    );
    return rows;
  },

  async updateViewerCount(id, count) {
    await pool.query('UPDATE live_streams SET current_viewers = ? WHERE id = ? AND status = \'live\'', [count, id]);
  },

  async end(id) {
    await pool.query('UPDATE live_streams SET status = \'ended\', ended_at = NOW() WHERE id = ?', [id]);
  },

  // Ends any stream a seller left open without properly clicking "End
  // Live" (closed tab, lost connection, etc) - called when they start a
  // new one, so a seller never shows as live twice or gets stuck live
  // forever from an abandoned session.
  async endAllForSeller(sellerId) {
    await pool.query('UPDATE live_streams SET status = \'ended\', ended_at = NOW() WHERE seller_id = ? AND status = \'live\'', [sellerId]);
  }
};

module.exports = LiveStream;
