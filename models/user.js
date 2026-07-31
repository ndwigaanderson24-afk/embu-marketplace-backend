// models/user.js
// Unified user model - every registered account is a row here. Applying to
// sell just fills in the seller_* columns on the same row (see
// user.applyAsSeller), matching how embu-marketplace.html treats sellers
// as users with an application, not a separate account type.

const pool = require('../db');

const User = {
  async create({ name, email, phone, password_hash, referral_code, referred_by_code }) {
    const [result] = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, referral_code, referred_by_code)
       VALUES (?,?,?,?,?,?)`,
      [name, email, phone, password_hash, referral_code, referred_by_code || null]
    );
    return result.insertId;
  },

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async findByEmail(email) {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0] || null;
  },

  async findByPhone(phone) {
    const [rows] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    return rows[0] || null;
  },

  async findByReferralCode(code) {
    const [rows] = await pool.query('SELECT * FROM users WHERE referral_code = ?', [code]);
    return rows[0] || null;
  },

  // Case-insensitive exact match against other sellers whose application
  // is pending or approved (a rejected applicant's old name doesn't block
  // reuse). Used to stop two shops from registering the same business
  // name and confusing customers.
  async findByBusinessName(businessName, excludeUserId = null) {
    let sql = `SELECT id, business_name FROM users
               WHERE LOWER(business_name) = LOWER(?) AND seller_status IN ('pending','approved')`;
    const params = [businessName];
    if (excludeUserId) { sql += ' AND id != ?'; params.push(excludeUserId); }
    const [rows] = await pool.query(sql, params);
    return rows[0] || null;
  },

  async updatePassword(id, password_hash) {
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, id]);
  },

  async setResetToken(email, token, expires) {
    await pool.query('UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE email = ?', [token, expires, email]);
  },

  async findByResetToken(token) {
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE reset_password_token = ? AND reset_password_expires > NOW()',
      [token]
    );
    return rows[0] || null;
  },

  // Turns a plain user into a pending seller applicant. Records exactly
  // when they accepted the Seller Terms & Conditions as a real audit
  // trail (the frontend gate is enforced again server-side in
  // authController.applySeller, so this timestamp always reflects an
  // actual accepted application, not just a UI flag).
  async applyAsSeller(id, { business_name, kra_pin, county, business_description, id_photo_path, business_doc_path }) {
    await pool.query(
      `UPDATE users SET business_name=?, kra_pin=?, county=?, business_description=?,
        id_photo_path=?, business_doc_path=?, seller_status='pending', seller_rejection_reason=NULL,
        seller_terms_accepted_at=NOW()
       WHERE id = ?`,
      [business_name, kra_pin, county, business_description || null, id_photo_path || null, business_doc_path || null, id]
    );
  },

  async setSellerStatus(id, status, rejectionReason = null) {
    await pool.query('UPDATE users SET seller_status = ?, seller_rejection_reason = ? WHERE id = ?', [status, rejectionReason, id]);
  },

  async setSubscription(id, { status, start, end }) {
    await pool.query(
      'UPDATE users SET subscription_status = ?, subscription_start = ?, subscription_end = ? WHERE id = ?',
      [status, start, end, id]
    );
  },

  async setShopDisabled(id, disabled) {
    await pool.query('UPDATE users SET shop_disabled = ? WHERE id = ?', [disabled, id]);
  },

  async findAllSellers({ status, limit = 50, offset = 0 } = {}) {
    let sql = "SELECT id, name, email, phone, business_name, county, kra_pin, seller_status, seller_rejection_reason, subscription_status, subscription_end, shop_disabled, created_at FROM users WHERE seller_status != 'none'";
    const params = [];
    if (status) { sql += ' AND seller_status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const [rows] = await pool.query(sql, params);
    return rows;
  },

  // A seller's shop counts as "active" only if approved, subscribed
  // (non-expired), and not manually disabled by admin - matches the
  // website's isSellerShopActive() check exactly.
  async isSellerShopActive(id) {
    const user = await this.findById(id);
    if (!user) return false;
    const notExpired = user.subscription_end && new Date(user.subscription_end) >= new Date();
    return user.seller_status === 'approved' && user.subscription_status === 'active' && notExpired && !user.shop_disabled;
  }
};

module.exports = User;
