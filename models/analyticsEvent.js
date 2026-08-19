// models/analyticsEvent.js
// Real product view/click tracking - previously the seller analytics
// dashboard showed "—" for these forever, since window._trackProductView
// and window._trackProductClick (already firing in the frontend on every
// product-detail open and Add-to-Cart tap) had nothing on the backend to
// actually receive them.

const pool = require('../db');

const AnalyticsEvent = {
  async track(productId, eventType) {
    await pool.query(
      'INSERT INTO product_analytics_events (product_id, event_type) VALUES (?, ?)',
      [productId, eventType]
    );
  },

  // Aggregated view/click counts across every product a seller owns -
  // this is what the seller analytics dashboard's Views/Clicks tiles
  // and conversion-rate calculation are actually reading now.
  async getSellerCounts(sellerId) {
    const [[row]] = await pool.query(
      `SELECT
         SUM(CASE WHEN e.event_type = 'view' THEN 1 ELSE 0 END) AS views,
         SUM(CASE WHEN e.event_type = 'click' THEN 1 ELSE 0 END) AS clicks
       FROM product_analytics_events e
       JOIN products p ON p.id = e.product_id
       WHERE p.seller_id = ?`,
      [sellerId]
    );
    return { views: Number(row.views) || 0, clicks: Number(row.clicks) || 0 };
  }
};

module.exports = AnalyticsEvent;
