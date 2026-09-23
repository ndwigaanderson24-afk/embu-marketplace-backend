// models/mpesaPayment.js

const pool = require('../db');

const MpesaPayment = {
  // purpose_plan and payload_json are optional - purpose_plan for a
  // subscription payment (which Silver/Gold plan), payload_json for an
  // order payment (everything needed to create the order once payment
  // is confirmed - see paymentController.js's mpesaCallback).
  async create({ phone, amount, purpose, purpose_months, purpose_plan, payload_json, user_id }) {
    const [result] = await pool.query(
      `INSERT INTO mpesa_payments (phone, amount, purpose, purpose_months, purpose_plan, payload_json, user_id, status)
       VALUES (?,?,?,?,?,?,?,'pending')`,
      [phone, amount, purpose, purpose_months || null, purpose_plan || null, payload_json || null, user_id || null]
    );
    return result.insertId;
  },

  async setCheckoutIds(id, { merchant_request_id, checkout_request_id }) {
    await pool.query(
      'UPDATE mpesa_payments SET merchant_request_id = ?, checkout_request_id = ? WHERE id = ?',
      [merchant_request_id, checkout_request_id, id]
    );
  },

  async findByCheckoutRequestId(checkoutRequestId) {
    const [rows] = await pool.query('SELECT * FROM mpesa_payments WHERE checkout_request_id = ?', [checkoutRequestId]);
    return rows[0] || null;
  },

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM mpesa_payments WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async markCompleted(checkoutRequestId, { mpesa_receipt_number, result_desc }) {
    await pool.query(
      "UPDATE mpesa_payments SET status = 'completed', mpesa_receipt_number = ?, result_desc = ? WHERE checkout_request_id = ?",
      [mpesa_receipt_number || null, result_desc || null, checkoutRequestId]
    );
  },

  async markFailed(checkoutRequestId, result_desc) {
    await pool.query(
      "UPDATE mpesa_payments SET status = 'failed', result_desc = ? WHERE checkout_request_id = ?",
      [result_desc || null, checkoutRequestId]
    );
  },

  // Records what actually happened once a confirmed order payment was
  // applied - the created order IDs, or an error if something went
  // wrong creating the order AFTER payment was already taken (so
  // support can find and refund it, rather than it silently vanishing).
  async setResult(id, resultJson) {
    await pool.query('UPDATE mpesa_payments SET result_json = ? WHERE id = ?', [resultJson, id]);
  }
};

module.exports = MpesaPayment;
