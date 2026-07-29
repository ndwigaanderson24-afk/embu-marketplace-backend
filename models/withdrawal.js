// models/withdrawal.js

const pool = require('../db');

const Withdrawal = {
  async create(sellerId, { amount, method, bank_details, mpesa_number }) {
    const [result] = await pool.query(
      `INSERT INTO withdrawals (seller_id, amount, method, bank_details, mpesa_number, status)
       VALUES (?,?,?,?,?,'pending')`,
      [sellerId, amount, method, bank_details || null, mpesa_number || null]
    );
    return result.insertId;
  },

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM withdrawals WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async findBySeller(sellerId) {
    const [rows] = await pool.query('SELECT * FROM withdrawals WHERE seller_id = ? ORDER BY requested_at DESC', [sellerId]);
    return rows;
  },

  async findAll({ status, limit = 50, offset = 0 } = {}) {
    let sql = `SELECT w.*, u.name, u.business_name, u.email FROM withdrawals w
               JOIN users u ON u.id = w.seller_id WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND w.status = ?'; params.push(status); }
    sql += ' ORDER BY w.requested_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const [rows] = await pool.query(sql, params);
    return rows;
  },

  // Everything already paid out or in-flight, so a seller can't request
  // more than their true remaining balance.
  async sumCommittedBySeller(sellerId) {
    const [rows] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawals
       WHERE seller_id = ? AND status IN ('pending','processing','completed')`,
      [sellerId]
    );
    return Number(rows[0].total);
  },

  async updateStatus(id, status, { reference_number, notes } = {}) {
    await pool.query(
      'UPDATE withdrawals SET status = ?, reference_number = ?, notes = ?, processed_at = NOW() WHERE id = ?',
      [status, reference_number || null, notes || null, id]
    );
  }
};

module.exports = Withdrawal;
