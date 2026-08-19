// controllers/analyticsController.js
// Receives the fire-and-forget POST /analytics/view and POST /analytics/click
// calls the frontend already makes on every product-detail open and
// Add-to-Cart tap (window._trackProductView / window._trackProductClick).
// No auth required - a product view/click should count whether the
// visitor is logged in or not, same as any storefront analytics.

const AnalyticsEvent = require('../models/analyticsEvent');
const { sendSuccess, sendError } = require('../helpers');

exports.trackView = async (req, res) => {
  const { product_id } = req.body;
  if (!product_id) return sendError(res, 400, 'product_id is required.');
  await AnalyticsEvent.track(product_id, 'view');
  return sendSuccess(res, 200, 'View tracked.');
};

exports.trackClick = async (req, res) => {
  const { product_id } = req.body;
  if (!product_id) return sendError(res, 400, 'product_id is required.');
  await AnalyticsEvent.track(product_id, 'click');
  return sendSuccess(res, 200, 'Click tracked.');
};
