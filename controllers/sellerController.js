// controllers/sellerController.js
// Backs the public seller-shop page's profile card + follow button, and
// the seller dashboard's real views/clicks analytics tiles - all three
// were already being called by the frontend (window._renderSellerShopPage,
// window._toggleFollowSeller, window._renderSellerAnalytics) with a
// try/catch fallback, since none of these endpoints existed yet.

const pool = require('../db');
const SellerFollow = require('../models/sellerFollow');
const AnalyticsEvent = require('../models/analyticsEvent');
const { sendSuccess, sendError } = require('../helpers');

async function findApprovedSellerByEmail(email) {
  const [rows] = await pool.query(
    "SELECT * FROM users WHERE email = ? AND seller_status = 'approved'",
    [email]
  );
  return rows[0] || null;
}

// GET /api/sellers/:email/profile - public, no auth required. Combines
// the already-existing `verified` flag (set via the admin's existing
// Mark Verified toggle) with a real rating/review count computed from
// this seller's actual reviews, and a real follower count.
exports.getProfile = async (req, res) => {
  const seller = await findApprovedSellerByEmail(req.params.email);
  if (!seller) return sendError(res, 404, 'Seller not found.');

  const [[reviewRow]] = await pool.query(
    `SELECT COUNT(*) AS num_reviews, COALESCE(AVG(r.rating), 0) AS rating
     FROM reviews r JOIN products p ON p.id = r.product_id
     WHERE p.seller_id = ?`,
    [seller.id]
  );
  const [[orderRow]] = await pool.query(
    "SELECT COUNT(*) AS completed_orders FROM orders WHERE seller_id = ? AND status = 'Completed'",
    [seller.id]
  );
  const followers = await SellerFollow.countFollowers(seller.id);

  return sendSuccess(res, 200, 'Seller profile retrieved.', {
    verified: !!seller.verified,
    rating: Number(reviewRow.rating) || 0,
    num_reviews: reviewRow.num_reviews,
    completed_orders: orderRow.completed_orders,
    // Neither of these is tracked anywhere in the system yet (no
    // message-response-time log, no defined performance-score formula) -
    // left null on purpose rather than inventing a fake number. The
    // frontend already handles null here (shows nothing for these two).
    response_time: null,
    performance_score: null,
    followers
  });
};

// POST /api/sellers/:email/follow - requires login (only a real buyer
// account can follow a shop).
exports.followSeller = async (req, res) => {
  const seller = await findApprovedSellerByEmail(req.params.email);
  if (!seller) return sendError(res, 404, 'Seller not found.');
  await SellerFollow.follow(seller.id, req.user.id);
  return sendSuccess(res, 200, 'Now following seller.');
};

// DELETE /api/sellers/:email/follow
exports.unfollowSeller = async (req, res) => {
  const seller = await findApprovedSellerByEmail(req.params.email);
  if (!seller) return sendError(res, 404, 'Seller not found.');
  await SellerFollow.unfollow(seller.id, req.user.id);
  return sendSuccess(res, 200, 'Unfollowed seller.');
};

// GET /api/sellers/:email/analytics - a seller's own view/click/
// conversion numbers are private to them; only the seller themself can
// read this (matches how their revenue/orders numbers already work -
// nothing here goes through the separate admin auth/token, so this
// intentionally doesn't offer an admin bypass).
exports.getSellerAnalytics = async (req, res) => {
  const seller = await findApprovedSellerByEmail(req.params.email);
  if (!seller) return sendError(res, 404, 'Seller not found.');
  if (!req.user || req.user.id !== seller.id) {
    return sendError(res, 403, "Not authorized to view this seller's analytics.");
  }

  const { views, clicks } = await AnalyticsEvent.getSellerCounts(seller.id);
  const [[orderCountRow]] = await pool.query('SELECT COUNT(*) AS n FROM orders WHERE seller_id = ?', [seller.id]);
  const orderCount = Number(orderCountRow.n) || 0;
  const conversion_rate = views > 0 ? ((orderCount / views) * 100).toFixed(1) + '%' : null;

  return sendSuccess(res, 200, 'Seller analytics retrieved.', {
    views, product_clicks: clicks, conversion_rate
  });
};
