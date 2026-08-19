// models/sellerFollow.js
// Tracks which buyers follow which seller's shop. seller_id/follower_user_id
// both point at users.id - a seller is just a user with seller_status =
// 'approved', so no separate sellers table is needed here.

const pool = require('../db');

const SellerFollow = {
  // INSERT IGNORE so tapping "Follow" twice in a row (e.g. a double-tap,
  // or a retry after a network blip) never errors - the UNIQUE key on
  // (seller_id, follower_user_id) makes a duplicate a silent no-op.
  async follow(sellerId, userId) {
    await pool.query(
      'INSERT IGNORE INTO seller_follows (seller_id, follower_user_id) VALUES (?, ?)',
      [sellerId, userId]
    );
  },

  async unfollow(sellerId, userId) {
    await pool.query(
      'DELETE FROM seller_follows WHERE seller_id = ? AND follower_user_id = ?',
      [sellerId, userId]
    );
  },

  async countFollowers(sellerId) {
    const [[row]] = await pool.query(
      'SELECT COUNT(*) AS n FROM seller_follows WHERE seller_id = ?',
      [sellerId]
    );
    return Number(row.n) || 0;
  },

  async isFollowing(sellerId, userId) {
    const [rows] = await pool.query(
      'SELECT 1 FROM seller_follows WHERE seller_id = ? AND follower_user_id = ? LIMIT 1',
      [sellerId, userId]
    );
    return rows.length > 0;
  }
};

module.exports = SellerFollow;
