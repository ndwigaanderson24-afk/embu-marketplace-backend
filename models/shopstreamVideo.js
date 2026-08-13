// models/shopstreamVideo.js
// Real, server-side ShopStream video posts - replaces the previous
// localStorage-only system where an "uploaded" video only ever existed
// as a temporary blob URL in the seller's own browser tab.

const pool = require('../db');

const ShopstreamVideo = {
  async create(data) {
    const [result] = await pool.query(
      `INSERT INTO shopstream_videos
        (seller_id, title, caption, category, hashtags, video_data, thumbnail, product_ids, status)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [data.seller_id, data.title, data.caption || null, data.category || null,
       data.hashtags || null, data.video_data, data.thumbnail || null,
       data.product_ids || null, data.status || 'published']
    );
    return result.insertId;
  },

  async findById(id) {
    const [rows] = await pool.query(
      `SELECT sv.*, u.business_name AS seller_business_name, u.email AS seller_email
       FROM shopstream_videos sv JOIN users u ON u.id = sv.seller_id WHERE sv.id = ?`,
      [id]
    );
    return rows[0] || null;
  },

  // Every published video, for the public buyer-facing feed - video_data
  // is intentionally excluded here (too large for a list response); the
  // single-video fetch below returns the actual video bytes.
  async findAllPublished() {
    const [rows] = await pool.query(
      `SELECT sv.id, sv.seller_id, sv.title, sv.caption, sv.category, sv.hashtags, sv.thumbnail,
              sv.product_ids, sv.status, sv.view_count, sv.like_count, sv.save_count, sv.created_at,
              u.business_name AS seller_business_name, u.email AS seller_email
       FROM shopstream_videos sv JOIN users u ON u.id = sv.seller_id
       WHERE sv.status = 'published' ORDER BY sv.created_at DESC`
    );
    return rows;
  },

  async findBySeller(sellerId) {
    const [rows] = await pool.query(
      `SELECT id, seller_id, title, caption, category, hashtags, thumbnail, product_ids, status,
              view_count, like_count, save_count, created_at
       FROM shopstream_videos WHERE seller_id = ? ORDER BY created_at DESC`,
      [sellerId]
    );
    return rows;
  },

  async findAllForAdmin() {
    const [rows] = await pool.query(
      `SELECT sv.id, sv.seller_id, sv.title, sv.caption, sv.category, sv.hashtags, sv.thumbnail,
              sv.product_ids, sv.status, sv.view_count, sv.like_count, sv.save_count, sv.created_at,
              u.business_name AS seller_business_name, u.email AS seller_email
       FROM shopstream_videos sv JOIN users u ON u.id = sv.seller_id ORDER BY sv.created_at DESC`
    );
    return rows;
  },

  async incrementView(id) {
    await pool.query('UPDATE shopstream_videos SET view_count = view_count + 1 WHERE id = ?', [id]);
  },

  async incrementLike(id) {
    await pool.query('UPDATE shopstream_videos SET like_count = like_count + 1 WHERE id = ?', [id]);
    const [rows] = await pool.query('SELECT like_count FROM shopstream_videos WHERE id = ?', [id]);
    return rows[0] ? rows[0].like_count : 0;
  },

  async incrementSave(id) {
    await pool.query('UPDATE shopstream_videos SET save_count = save_count + 1 WHERE id = ?', [id]);
    const [rows] = await pool.query('SELECT save_count FROM shopstream_videos WHERE id = ?', [id]);
    return rows[0] ? rows[0].save_count : 0;
  },

  async delete(id) {
    await pool.query('DELETE FROM shopstream_videos WHERE id = ?', [id]);
  },

  async update(id, data) {
    const allowed = ['title', 'caption', 'category', 'hashtags', 'product_ids', 'status'];
    const keys = Object.keys(data).filter(k => allowed.includes(k) && data[k] !== undefined);
    if (!keys.length) return false;
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => data[k]);
    values.push(id);
    await pool.query(`UPDATE shopstream_videos SET ${setClause} WHERE id = ?`, values);
    return true;
  }
};

const ShopstreamVideoComment = {
  async create(videoId, senderName, comment) {
    const [result] = await pool.query(
      'INSERT INTO shopstream_video_comments (video_id, sender_name, comment) VALUES (?,?,?)',
      [videoId, senderName, comment]
    );
    return result.insertId;
  },

  async findByVideoId(videoId) {
    const [rows] = await pool.query(
      'SELECT * FROM shopstream_video_comments WHERE video_id = ? ORDER BY created_at ASC',
      [videoId]
    );
    return rows;
  }
};

module.exports = { ShopstreamVideo, ShopstreamVideoComment };
