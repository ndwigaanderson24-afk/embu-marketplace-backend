// models/pricingRule.js
const pool = require('../db');

const PricingRule = {
  async findAllActive() {
    const [rows] = await pool.query('SELECT * FROM pricing_rules WHERE active = 1');
    return rows;
  },

  async findAllForAdmin() {
    const [rows] = await pool.query('SELECT * FROM pricing_rules ORDER BY priority DESC, created_at DESC');
    return rows;
  },

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM pricing_rules WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async create(data) {
    const [result] = await pool.query(
      `INSERT INTO pricing_rules
        (name, category, min_value, max_value, margin_type, margin_value,
         delivery_type, delivery_value, priority, active)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [data.name, data.category || null, data.min_value || 0, data.max_value ?? null,
       data.margin_type, data.margin_value, data.delivery_type, data.delivery_value,
       data.priority || 0, data.active === undefined ? 1 : !!data.active]
    );
    return result.insertId;
  },

  async update(id, data) {
    const allowed = ['name', 'category', 'min_value', 'max_value', 'margin_type',
      'margin_value', 'delivery_type', 'delivery_value', 'priority', 'active'];
    const keys = Object.keys(data).filter(k => allowed.includes(k) && data[k] !== undefined);
    if (!keys.length) return false;
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => data[k]);
    values.push(id);
    await pool.query(`UPDATE pricing_rules SET ${setClause} WHERE id = ?`, values);
    return true;
  },

  async delete(id) {
    await pool.query('DELETE FROM pricing_rules WHERE id = ?', [id]);
  }
};

module.exports = PricingRule;
