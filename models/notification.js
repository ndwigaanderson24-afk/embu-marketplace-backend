// models/notification.js

const pool = require('../db');

const Notification = {
  async create(userId, { title, message, type = 'general' }) {
    await pool.query(
      'INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,?)',
      [userId, title, message, type]
    );
  },

  async broadcast(userIds, { title, message, type = 'announcement' }) {
    for (const id of userIds) await this.create(id, { title, message, type });
  },

  async findForUser(userId, { unreadOnly = false } = {}) {
    let sql = 'SELECT * FROM notifications WHERE user_id = ?';
    const params = [userId];
    if (unreadOnly) sql += ' AND is_read = FALSE';
    sql += ' ORDER BY created_at DESC';
    const [rows] = await pool.query(sql, params);
    return rows;
  },

  async markRead(id, userId) {
    await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?', [id, userId]);
  }
};

module.exports = Notification;
