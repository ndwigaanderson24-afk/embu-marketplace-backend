// models/pricingSettings.js
const pool = require('../db');

const PricingSettings = {
  async get() {
    const [rows] = await pool.query('SELECT * FROM pricing_settings WHERE id = 1');
    return rows[0] || null;
  },

  async update(data) {
    const allowed = ['default_margin_type', 'default_margin_value', 'default_delivery_type',
      'default_delivery_value', 'fragile_risk_type', 'fragile_risk_value', 'default_category_commission_rate'];
    const keys = Object.keys(data).filter(k => allowed.includes(k) && data[k] !== undefined);
    if (!keys.length) return false;
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => data[k]);
    await pool.query(`UPDATE pricing_settings SET ${setClause} WHERE id = 1`, values);
    return true;
  }
};

module.exports = PricingSettings;
