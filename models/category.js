// models/category.js
// Dynamic, self-referencing category tree.
// parent_id = NULL  → top-level (main) category
// parent_id = X     → child of category X
// Unlimited depth — no schema changes needed to add new levels.

const pool = require('../db');

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const Category = {

  // ── Read ────────────────────────────────────────────────────────────

  // All categories flat — used for admin tables and building the tree client-side
  async findAll({ activeOnly = false } = {}) {
    let sql = 'SELECT * FROM categories';
    if (activeOnly) sql += ' WHERE is_active = 1';
    sql += ' ORDER BY position ASC, name ASC';
    const [rows] = await pool.query(sql);
    return rows;
  },

  // Direct children of a given parent (or top-level if parentId is null)
  async findChildren(parentId, { activeOnly = true } = {}) {
    let sql, params;
    if (parentId === null || parentId === undefined) {
      sql = 'SELECT * FROM categories WHERE parent_id IS NULL';
      params = [];
    } else {
      sql = 'SELECT * FROM categories WHERE parent_id = ?';
      params = [parentId];
    }
    if (activeOnly) sql += ' AND is_active = 1';
    sql += ' ORDER BY position ASC, name ASC';
    const [rows] = await pool.query(sql, params);
    return rows;
  },

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM categories WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async findBySlug(slug) {
    const [rows] = await pool.query('SELECT * FROM categories WHERE slug = ?', [slug]);
    return rows[0] || null;
  },

  // Full ancestor breadcrumb path for a given category id
  // e.g. [ {id:1,name:'Electronics'}, {id:3,name:'Mobile Phones'}, {id:7,name:'Smartphones'} ]
  async breadcrumb(id) {
    const path = [];
    let current = await this.findById(id);
    while (current) {
      path.unshift(current);
      if (!current.parent_id) break;
      current = await this.findById(current.parent_id);
    }
    return path;
  },

  // Build the full tree (all levels) as nested objects.
  // Efficient: one DB query, then assemble in JS.
  async getTree({ activeOnly = true } = {}) {
    let sql = 'SELECT * FROM categories';
    if (activeOnly) sql += ' WHERE is_active = 1';
    sql += ' ORDER BY position ASC, name ASC';
    const [rows] = await pool.query(sql);

    const map = {};
    rows.forEach(r => { map[r.id] = { ...r, children: [] }; });

    const roots = [];
    rows.forEach(r => {
      if (r.parent_id && map[r.parent_id]) {
        map[r.parent_id].children.push(map[r.id]);
      } else if (!r.parent_id) {
        roots.push(map[r.id]);
      }
    });
    return roots;
  },

  // ── Write ────────────────────────────────────────────────────────────

  async create({ parent_id, name, description, icon, image_url, position }) {
    // Auto-generate a unique slug
    let baseSlug = slugify(name);
    if (parent_id) {
      const parent = await this.findById(parent_id);
      if (parent) baseSlug = parent.slug + '-' + baseSlug;
    }
    // Ensure uniqueness
    let slug = baseSlug;
    let attempt = 0;
    while (await this.findBySlug(slug)) {
      attempt++;
      slug = baseSlug + '-' + attempt;
    }

    // Default position = last among siblings
    if (position === undefined || position === null) {
      const siblings = await this.findChildren(parent_id || null, { activeOnly: false });
      position = siblings.length;
    }

    const [result] = await pool.query(
      `INSERT INTO categories (parent_id, name, slug, description, icon, image_url, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [parent_id || null, name, slug, description || null, icon || null, image_url || null, position]
    );
    return result.insertId;
  },

  async update(id, { name, parent_id, description, icon, image_url, position, is_active }) {
    const fields = [];
    const values = [];

    if (name !== undefined)        { fields.push('name = ?');        values.push(name); }
    if (parent_id !== undefined)   { fields.push('parent_id = ?');   values.push(parent_id || null); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }
    if (icon !== undefined)        { fields.push('icon = ?');        values.push(icon); }
    if (image_url !== undefined)   { fields.push('image_url = ?');   values.push(image_url); }
    if (position !== undefined)    { fields.push('position = ?');    values.push(position); }
    if (is_active !== undefined)   { fields.push('is_active = ?');   values.push(is_active ? 1 : 0); }

    if (!fields.length) return false;
    values.push(id);
    await pool.query(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
  },

  // Reorder siblings — accepts array of {id, position}
  async reorder(items) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const { id, position } of items) {
        await conn.query('UPDATE categories SET position = ? WHERE id = ?', [position, id]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },

  async delete(id) {
    // CASCADE on parent_id means all descendants are deleted automatically
    const [result] = await pool.query('DELETE FROM categories WHERE id = ?', [id]);
    return result.affectedRows > 0;
  },

  // Count products linked to this category (including descendants)
  async productCount(id) {
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS n FROM products WHERE category_id = ?', [id]
    );
    return rows[0].n;
  }
};

module.exports = Category;
