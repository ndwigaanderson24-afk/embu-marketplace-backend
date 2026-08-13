// models/adminNotification.js
const pool = require('../db');

const AdminNotification = {
  async create({ title, message, type = 'general', orderId = null }) {
    await pool.query(
      'INSERT INTO admin_notifications (title, message, type, order_id) VALUES (?,?,?,?)',
      [title, message, type, orderId]
    );
  },

  async findRecent(limit = 50) {
    const [rows] = await pool.query(
      'SELECT * FROM admin_notifications ORDER BY created_at DESC LIMIT ?',
      [Number(limit)]
    );
    return rows;
  }
};

module.exports = AdminNotification;
