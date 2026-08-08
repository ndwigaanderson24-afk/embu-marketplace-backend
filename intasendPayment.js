// models/intasendPayment.js

const pool = require('../db');

const IntasendPayment = {
  async create({ api_ref, phone, amount, purpose, purpose_months, purpose_plan, payload_json, user_id }) {
    const [result] = await pool.query(
      `INSERT INTO intasend_payments (api_ref, phone, amount, purpose, purpose_months, purpose_plan, payload_json, user_id, status)
       VALUES (?,?,?,?,?,?,?,?,'PENDING')`,
      [api_ref, phone, amount, purpose, purpose_months || null, purpose_plan || null, payload_json || null, user_id || null]
    );
    return result.insertId;
  },

  // Stores the outcome of a completed 'order' purpose payment (the
  // orders that were actually created) so the frontend's status-poll
  // can retrieve them once ready.
  async setResult(apiRef, resultJson) {
    await pool.query('UPDATE intasend_payments SET result_json = ? WHERE api_ref = ?', [resultJson, apiRef]);
  },

  async setInvoiceId(apiRef, invoiceId) {
    await pool.query('UPDATE intasend_payments SET invoice_id = ? WHERE api_ref = ?', [invoiceId, apiRef]);
  },

  async findByApiRef(apiRef) {
    const [rows] = await pool.query('SELECT * FROM intasend_payments WHERE api_ref = ?', [apiRef]);
    return rows[0] || null;
  },

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM intasend_payments WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async updateStatus(apiRef, status, failedReason = null) {
    await pool.query(
      'UPDATE intasend_payments SET status = ?, failed_reason = ? WHERE api_ref = ?',
      [status, failedReason, apiRef]
    );
  }
};

module.exports = IntasendPayment;
