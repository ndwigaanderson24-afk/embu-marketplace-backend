// controllers/adminController.js

const pool = require('../db');
const User = require('../models/user');
const Notification = require('../models/notification');
const { sendSuccess, sendError } = require('../helpers');
const Product = require('../models/product');
const FeaturedRequest = require('../models/featuredRequest');
const FeaturedLiveRequest = require('../models/featuredLiveRequest');
const PricingRule = require('../models/pricingRule');
const AdminNotification = require('../models/adminNotification');
const PricingSettings = require('../models/pricingSettings');

async function logActivity(actor, action, details) {
  try { await pool.query('INSERT INTO activity_logs (actor, action, details) VALUES (?,?,?)', [actor, action, details || null]); }
  catch (err) { console.error('Activity log failed (non-fatal):', err.message); }
}

// ---------- Sellers ----------

// GET /api/admin/sellers?status=pending
exports.getAllSellers = async (req, res) => {
  const sellers = await User.findAllSellers(req.query);
  return sendSuccess(res, 200, 'Sellers retrieved.', { sellers });
};

// GET /api/admin/sellers/:id
exports.getSeller = async (req, res) => {
  const seller = await User.findById(req.params.id);
  if (!seller || seller.seller_status === 'none') return sendError(res, 404, 'Seller not found.');
  delete seller.password_hash;
  return sendSuccess(res, 200, 'Seller retrieved.', { seller });
};

// POST /api/admin/sellers/:id/approve
exports.approveSeller = async (req, res) => {
  const seller = await User.findById(req.params.id);
  if (!seller) return sendError(res, 404, 'Seller not found.');
  await User.setSellerStatus(req.params.id, 'approved');
  await Notification.create(req.params.id, { title: 'Application approved!', message: 'Pay your subscription to start selling.', type: 'seller_approved' });
  await logActivity('admin', 'seller_approved', `seller ${req.params.id}`);
  return sendSuccess(res, 200, 'Seller approved. They can now pay for a subscription.');
};

// POST /api/admin/sellers/:id/reject  { reason }
exports.rejectSeller = async (req, res) => {
  const { reason } = req.body;
  const seller = await User.findById(req.params.id);
  if (!seller) return sendError(res, 404, 'Seller not found.');
  await User.setSellerStatus(req.params.id, 'rejected', reason || 'Application did not meet requirements.');
  await Notification.create(req.params.id, { title: 'Application update', message: reason || 'Your application was not approved.', type: 'seller_rejected' });
  await logActivity('admin', 'seller_rejected', `seller ${req.params.id}: ${reason || ''}`);
  return sendSuccess(res, 200, 'Seller application rejected.');
};

// POST /api/admin/sellers/:id/reset - clears a rejected application back
// to no-status, so the seller can genuinely reapply from scratch (their
// old application data isn't preserved, matching what "reset" implies).
exports.resetSeller = async (req, res) => {
  const seller = await User.findById(req.params.id);
  if (!seller) return sendError(res, 404, 'Seller not found.');
  await User.setSellerStatus(req.params.id, null, null);
  await logActivity('admin', 'seller_reset', `seller ${req.params.id}`);
  return sendSuccess(res, 200, 'Application reset. Seller can now reapply.');
};

// POST /api/admin/sellers/:id/suspend
exports.suspendSeller = async (req, res) => {
  await User.setShopDisabled(req.params.id, true);
  await logActivity('admin', 'seller_shop_disabled', `seller ${req.params.id}`);
  return sendSuccess(res, 200, "Seller's shop has been disabled.");
};

// POST /api/admin/sellers/:id/activate
exports.activateSeller = async (req, res) => {
  await User.setShopDisabled(req.params.id, false);
  await logActivity('admin', 'seller_shop_enabled', `seller ${req.params.id}`);
  return sendSuccess(res, 200, "Seller's shop has been re-enabled.");
};

// ---------- Seller earnings overview ----------

// GET /api/admin/sellers-earnings
exports.getSellerEarningsOverview = async (req, res) => {
  const [sellers] = await pool.query(`
    SELECT u.id, u.business_name, u.email,
           COUNT(o.id) AS total_orders,
           COALESCE(SUM(CASE WHEN o.status = 'Completed' THEN o.seller_earnings ELSE 0 END), 0) AS payable,
           COALESCE(SUM(CASE WHEN o.status NOT IN ('Completed','Cancelled') THEN o.seller_earnings ELSE 0 END), 0) AS pending
    FROM users u
    LEFT JOIN orders o ON o.seller_id = u.id
    WHERE u.seller_status = 'approved'
    GROUP BY u.id
    ORDER BY payable DESC
  `);
  return sendSuccess(res, 200, 'Seller earnings overview retrieved.', { sellers });
};

// ---------- Referral overview ----------

// GET /api/admin/referrals
// GET /api/admin/featured-requests - every "Feature My Product" request,
// paid for via real IntaSend payment (see intasendController webhook),
// awaiting a real admin decision.
exports.getFeaturedRequests = async (req, res) => {
  const requests = await FeaturedRequest.findAllForAdmin();
  return sendSuccess(res, 200, 'Featured requests retrieved.', { requests });
};

// POST /api/admin/featured-requests/:id/approve - activates the feature
// for real: the product only actually becomes featured here, never
// automatically from payment alone.
exports.approveFeaturedRequest = async (req, res) => {
  const request = await FeaturedRequest.findById(req.params.id);
  if (!request) return sendError(res, 404, 'Request not found.');
  const until = new Date(Date.now() + request.days * 24 * 60 * 60 * 1000);
  await pool.query('UPDATE products SET is_featured = 1, featured_until = ? WHERE id = ?', [until, request.product_id]);
  await FeaturedRequest.updateStatus(request.id, 'approved');
  return sendSuccess(res, 200, 'Product is now featured.', {});
};

exports.rejectFeaturedRequest = async (req, res) => {
  const request = await FeaturedRequest.findById(req.params.id);
  if (!request) return sendError(res, 404, 'Request not found.');
  await FeaturedRequest.updateStatus(request.id, 'rejected');
  return sendSuccess(res, 200, 'Request rejected.', {});
};

// GET /api/admin/featured-live-requests - real, paid "Promote Your
// Live" requests awaiting review.
exports.getFeaturedLiveRequests = async (req, res) => {
  const requests = await FeaturedLiveRequest.findAllForAdmin();
  return sendSuccess(res, 200, 'Featured live requests retrieved.', { requests });
};

// POST /api/admin/featured-live-requests/:id/approve - only takes
// effect if the stream is still actually live; if it's already ended
// by the time this runs, approving it is a harmless no-op (matches
// "usually within minutes" in the seller-facing copy).
exports.approveFeaturedLiveRequest = async (req, res) => {
  const request = await FeaturedLiveRequest.findById(req.params.id);
  if (!request) return sendError(res, 404, 'Request not found.');
  await pool.query("UPDATE live_streams SET is_promoted = 1 WHERE id = ? AND status = 'live'", [request.stream_id]);
  await FeaturedLiveRequest.updateStatus(request.id, 'approved');
  return sendSuccess(res, 200, 'Live stream promoted.', {});
};

exports.rejectFeaturedLiveRequest = async (req, res) => {
  const request = await FeaturedLiveRequest.findById(req.params.id);
  if (!request) return sendError(res, 404, 'Request not found.');
  await FeaturedLiveRequest.updateStatus(request.id, 'rejected');
  return sendSuccess(res, 200, 'Request rejected.', {});
};

// ---------- Pricing engine admin controls ----------

// GET /api/admin/pricing/settings - the single global-defaults row.
exports.getPricingSettings = async (req, res) => {
  const settings = await PricingSettings.get();
  return sendSuccess(res, 200, 'Pricing settings retrieved.', { settings });
};

// PUT /api/admin/pricing/settings
exports.updatePricingSettings = async (req, res) => {
  await PricingSettings.update(req.body);
  const settings = await PricingSettings.get();
  return sendSuccess(res, 200, 'Pricing settings updated.', { settings });
};

// GET /api/admin/pricing/rules - every rule, for the admin's own
// management view (findAllActive, used by product pricing itself,
// only returns active ones).
exports.getPricingRules = async (req, res) => {
  const rules = await PricingRule.findAllForAdmin();
  return sendSuccess(res, 200, 'Pricing rules retrieved.', { rules });
};

exports.createPricingRule = async (req, res) => {
  const { name, margin_type, margin_value, delivery_type, delivery_value } = req.body;
  if (!name || !margin_type || margin_value === undefined || !delivery_type || delivery_value === undefined) {
    return sendError(res, 400, 'name, margin_type, margin_value, delivery_type, and delivery_value are required.');
  }
  const id = await PricingRule.create(req.body);
  return sendSuccess(res, 201, 'Pricing rule created.', { id });
};

exports.updatePricingRule = async (req, res) => {
  const rule = await PricingRule.findById(req.params.id);
  if (!rule) return sendError(res, 404, 'Rule not found.');
  await PricingRule.update(req.params.id, req.body);
  return sendSuccess(res, 200, 'Pricing rule updated.', {});
};

exports.deletePricingRule = async (req, res) => {
  const rule = await PricingRule.findById(req.params.id);
  if (!rule) return sendError(res, 404, 'Rule not found.');
  await PricingRule.delete(req.params.id);
  return sendSuccess(res, 200, 'Pricing rule deleted.', {});
};

// POST /api/admin/pricing/migrate-existing-products - one-time action
// (safe to run more than once - only touches products that haven't
// been migrated yet). Treats each existing product's current price as
// what the seller was asking for, then computes a real final price on
// top of it using whatever rules/defaults are active right now.
exports.migrateExistingProductPricing = async (req, res) => {
  const result = await Product.migrateExistingPricing();
  return sendSuccess(res, 200, `Migrated ${result.migrated} of ${result.totalFound} products.`, result);
};

// GET /api/admin/notifications - the real broadcast feed every admin
// account sees, including full order details behind each entry.
exports.getAdminNotifications = async (req, res) => {
  const notifications = await AdminNotification.findRecent(req.query.limit || 50);
  return sendSuccess(res, 200, 'Notifications retrieved.', { notifications });
};

exports.getReferralOverview = async (req, res) => {
  const [rows] = await pool.query(`
    SELECT re.*, ur.name AS referrer_name, ur.email AS referrer_email
    FROM referral_earnings re
    JOIN users ur ON ur.id = re.referrer_id
    ORDER BY re.created_at DESC LIMIT 100
  `);
  const [[{ total }]] = await pool.query('SELECT COALESCE(SUM(commission),0) AS total FROM referral_earnings');
  return sendSuccess(res, 200, 'Referral overview retrieved.', { earnings: rows, total_paid_out: Number(total) });
};

// ---------- Analytics ----------

// GET /api/admin/analytics
exports.getAnalytics = async (req, res) => {
  const [[{ total_users }]] = await pool.query('SELECT COUNT(*) AS total_users FROM users');
  const [[{ pending_applications }]] = await pool.query("SELECT COUNT(*) AS pending_applications FROM users WHERE seller_status = 'pending'");
  const [[{ active_sellers }]] = await pool.query("SELECT COUNT(*) AS active_sellers FROM users WHERE seller_status = 'approved' AND subscription_status = 'active'");
  const [[{ total_products }]] = await pool.query('SELECT COUNT(*) AS total_products FROM products');
  const [[{ total_orders }]] = await pool.query('SELECT COUNT(*) AS total_orders FROM orders');
  const [[{ total_revenue }]] = await pool.query("SELECT COALESCE(SUM(total),0) AS total_revenue FROM orders WHERE status = 'Completed'");
  const [[{ pending_withdrawals }]] = await pool.query("SELECT COUNT(*) AS pending_withdrawals FROM withdrawals WHERE status = 'pending'");

  return sendSuccess(res, 200, 'Admin analytics retrieved.', {
    total_users, pending_applications, active_sellers, total_products,
    total_orders, total_revenue, pending_withdrawals
  });
};

// ---------- Announcements ----------

// POST /api/admin/announcements  { title, message, target: 'all' | [userId,...] }
exports.sendAnnouncement = async (req, res) => {
  const { title, message, target } = req.body;
  if (!title || !message) return sendError(res, 400, 'title and message are required.');

  let userIds;
  if (!target || target === 'all') {
    const [rows] = await pool.query("SELECT id FROM users WHERE seller_status = 'approved'");
    userIds = rows.map(r => r.id);
  } else if (Array.isArray(target)) {
    userIds = target;
  } else {
    return sendError(res, 400, 'target must be "all" or an array of user IDs.');
  }

  await Notification.broadcast(userIds, { title, message, type: 'announcement' });
  await logActivity('admin', 'announcement_sent', `to ${userIds.length} sellers: ${title}`);
  return sendSuccess(res, 200, `Announcement sent to ${userIds.length} seller(s).`);
};

// GET /api/admin/logs
exports.getLogs = async (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const [rows] = await pool.query('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ? OFFSET ?', [Number(limit), Number(offset)]);
  return sendSuccess(res, 200, 'Activity logs retrieved.', { logs: rows });
};

exports.logActivity = logActivity;
