// models/admin.js
// Real admin accounts, each with their own email/password - replaces the
// old single admin defined via ADMIN_EMAIL/ADMIN_PASSWORD_HASH in .env.
// One admin can be flagged is_super_admin - only that person (or people)
// can add or remove other admin accounts; everyone else just has normal
// admin access to the dashboard itself.

const pool = require('../db');

const Admin = {
  async findByEmail(email) {
    const [rows] = await pool.query('SELECT * FROM admins WHERE email = ?', [email]);
    return rows[0] || null;
  },

  async findById(id) {
    const [rows] = await pool.query('SELECT id, name, email, is_super_admin, created_at FROM admins WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async create({ name, email, password_hash, is_super_admin = false }) {
    const [result] = await pool.query(
      'INSERT INTO admins (name, email, password_hash, is_super_admin) VALUES (?,?,?,?)',
      [name, email, password_hash, is_super_admin]
    );
    return result.insertId;
  },

  async findAll() {
    const [rows] = await pool.query('SELECT id, name, email, is_super_admin, created_at FROM admins ORDER BY created_at DESC');
    return rows;
  },

  async delete(id) {
    await pool.query('DELETE FROM admins WHERE id = ?', [id]);
  },

  async updatePassword(id, password_hash) {
    await pool.query('UPDATE admins SET password_hash = ? WHERE id = ?', [password_hash, id]);
  },

  async setSuperAdmin(id, isSuperAdmin) {
    await pool.query('UPDATE admins SET is_super_admin = ? WHERE id = ?', [isSuperAdmin, id]);
  }
};

module.exports = Admin;
