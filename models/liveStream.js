// models/liveStream.js
// Real, server-side tracking of ShopStream live sessions - this is
// what makes "who's currently live" and viewer counts visible from any
// device (admin, other sellers, buyers), not just the seller's own
// browser tab.

const pool = require('../db');

const LiveStream = {
  async create({ sellerId, productId, channelName, title }) {
    const [result] = await pool.query(
      'INSERT INTO live_streams (seller_id, product_id, channel_name, title, status) VALUES (?,?,?,?,\'live\')',
      [sellerId, productId || null, channelName, title || null]
    );
    return result.insertId;
  },

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM live_streams WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async findByChannelName(channelName) {
    const [rows] = await pool.query('SELECT * FROM live_streams WHERE channel_name = ?', [channelName]);
    return rows[0] || null;
  },

  // Every currently-live stream, joined to the seller's public info and
  // (when set) the product being showcased - this is the single source
  // of truth for "who's live right now", read the same way regardless
  // of which device or role is asking.
  async findAllLive() {
    const [rows] = await pool.query(
      `SELECT ls.*, u.business_name AS seller_business_name, u.email AS seller_email,
              p.name AS product_name, p.image AS product_image
       FROM live_streams ls
       JOIN users u ON u.id = ls.seller_id
       LEFT JOIN products p ON p.id = ls.product_id
       WHERE ls.status = 'live'
       ORDER BY ls.started_at DESC`
    );
    return rows;
  },

  async updateViewerCount(id, count) {
    await pool.query('UPDATE live_streams SET current_viewers = ? WHERE id = ? AND status = \'live\'', [count, id]);
  },

  async end(id) {
    await pool.query('UPDATE live_streams SET status = \'ended\', ended_at = NOW() WHERE id = ?', [id]);
  },

  // Ends any stream a seller left open without properly clicking "End
  // Live" (closed tab, lost connection, etc) - called when they start a
  // new one, so a seller never shows as live twice or gets stuck live
  // forever from an abandoned session.
  async endAllForSeller(sellerId) {
    await pool.query('UPDATE live_streams SET status = \'ended\', ended_at = NOW() WHERE seller_id = ? AND status = \'live\'', [sellerId]);
  },

  // Likes are a simple running count on the stream itself - not tied to
  // who liked it, since ShopStream viewers are frequently guests with
  // no account. Returns the new total so the caller can broadcast it.
  async incrementLikes(id) {
    await pool.query('UPDATE live_streams SET like_count = like_count + 1 WHERE id = ?', [id]);
    const stream = await this.findById(id);
    return stream ? stream.like_count : 0;
  },

  // Records that a specific viewer is still watching (upserts their
  // last-seen time), then recomputes and stores how many distinct
  // viewers have pinged in the last 30s. This is the real, working
  // replacement for Agora's client-side user-joined/user-left events,
  // which never fire for audience members in live-streaming mode.
  async recordViewerPing(id, viewerKey) {
    await pool.query(
      `INSERT INTO live_stream_viewer_pings (stream_id, viewer_key) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE last_ping_at = CURRENT_TIMESTAMP`,
      [id, viewerKey]
    );
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c FROM live_stream_viewer_pings
       WHERE stream_id = ? AND last_ping_at > NOW() - INTERVAL 30 SECOND`,
      [id]
    );
    const count = rows[0].c;
    await pool.query('UPDATE live_streams SET current_viewers = ? WHERE id = ?', [count, id]);
    return count;
  }
};

const LiveStreamMessage = {
  async create(streamId, { senderName, senderRole, message }) {
    const [result] = await pool.query(
      'INSERT INTO live_stream_messages (stream_id, sender_name, sender_role, message) VALUES (?,?,?,?)',
      [streamId, senderName, senderRole, message]
    );
    return result.insertId;
  },

  // Polling-based chat: the caller passes the highest message id they've
  // already seen, and gets back only what's new since then - avoids
  // needing a websocket/real-time connection for something as simple as
  // a live chat feed.
  async findSince(streamId, afterId) {
    const [rows] = await pool.query(
      'SELECT * FROM live_stream_messages WHERE stream_id = ? AND id > ? ORDER BY id ASC',
      [streamId, afterId || 0]
    );
    return rows;
  }
};

module.exports = { LiveStream, LiveStreamMessage };
