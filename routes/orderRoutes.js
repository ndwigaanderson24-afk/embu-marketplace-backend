// routes/orderRoutes.js
// Mounted at /api/orders in server.js. No separate orderController.js by
// design (per the requested file list) - handlers live inline here.

const express = require('express');
const router = express.Router();
const Order = require('../models/order');
const Cart = require('../models/cart');
const { protect, optionalAuth, requireAdmin, requireActiveSeller } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../helpers');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
function isValidPhoneNumber(phone) {
  return phone && phone.replace(/\D/g, '').length >= 10;
}

// ---------- Checkout ----------
// A raw, unpaid POST '/' checkout endpoint used to live here - it created
// a real order and decremented real stock with no payment step at all
// (the frontend never called it, correctly using the payment-verified
// /api/intasend/checkout flow instead, but it was still live and
// reachable by anyone who found it: a free, unpaid order with real stock
// loss on every call). Removed entirely rather than gated, since there's
// no legitimate case - admin included - for creating a real order
// outside a confirmed payment. See intasendController.initiateCheckoutPayment
// for the actual checkout flow; it creates the order only once IntaSend's
// webhook confirms payment, using this same Order.createFromCart() call.
router.post('/preview', optionalAuth, wrap(async (req, res) => {
  const { session_id, dest_county, delivery_type, weight_override } = req.body;
  const owner = req.user ? { userId: req.user.id } : { sessionId: session_id };
  const cartItems = await Cart.getItems(owner);
  const plan = Order.computeDeliveryPlan(cartItems, dest_county, delivery_type, weight_override);
  return sendSuccess(res, 200, 'Delivery plan calculated.', plan);
}));

// ---------- Logged-in customer's own order history ----------
router.get('/customer/mine', protect, wrap(async (req, res) => {
  const orders = await Order.findByCustomerUserId(req.user.id);
  return sendSuccess(res, 200, 'Orders retrieved.', { orders });
}));

// ---------- Public tracking ----------
router.get('/:trackingNumber/track', wrap(async (req, res) => {
  const order = await Order.findByTrackingNumber(req.params.trackingNumber);
  if (!order) return sendError(res, 404, 'Order not found.');
  return sendSuccess(res, 200, 'Order found.', { order });
}));

// ---------- Seller ----------
router.get('/mine', protect, requireActiveSeller, wrap(async (req, res) => {
  const orders = await Order.findBySeller(req.user.id, req.query);
  return sendSuccess(res, 200, 'Orders retrieved.', { orders });
}));

router.get('/:id', protect, wrap(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return sendError(res, 404, 'Order not found.');
  const isOwner = req.user && (order.seller_id === req.user.id || order.customer_user_id === req.user.id);
  if (!isOwner && !req.isAdmin) return sendError(res, 403, 'You do not have access to this order.');
  return sendSuccess(res, 200, 'Order retrieved.', { order });
}));

// Canonical 6-stage lifecycle: Pending -> Accepted -> Packed -> In Transit
// -> Delivered -> Completed. A seller is only paid once Completed.
router.put('/:id/status', protect, requireActiveSeller, wrap(async (req, res) => {
  const { status } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order || order.seller_id !== req.user.id) return sendError(res, 404, 'Order not found.');
  await Order.updateStatus(req.params.id, status);

  if (order.customer_user_id) {
    const Notification = require('../models/notification');
    await Notification.create(order.customer_user_id, {
      title: `Order #${order.order_number} update`,
      message: `Your order status is now: ${status}.`,
      type: 'order_status'
    });
  }
  const { logActivity } = require('../controllers/adminController');
  await logActivity(String(req.user.id), 'order_status_updated', `order ${req.params.id} -> ${status}`);

  return sendSuccess(res, 200, `Order status updated to ${status}.`);
}));

// ---------- Rider assignment (admin) ----------
// Photo is optional and expected to already be a path/URL from your
// upload endpoint - this route just links it to the order.
router.post('/:id/rider', protect, requireAdmin, wrap(async (req, res) => {
  const { name, phone, photo } = req.body;
  if (!name || !phone) return sendError(res, 400, 'Rider name and phone are required.');
  const order = await Order.findById(req.params.id);
  if (!order) return sendError(res, 404, 'Order not found.');
  await Order.assignRider(req.params.id, { name, phone, photo });
  const { logActivity } = require('../controllers/adminController');
  await logActivity('admin', 'rider_assigned', `order ${req.params.id}: ${name}`);
  return sendSuccess(res, 200, `Rider ${name} assigned - linked to ${order.customer_name}'s delivery.`);
}));

// ---------- Delivery rating ----------
// Deliberately NOT gated on a rider being assigned - a Pickup order has
// none, but the customer still had a delivery/pickup experience worth
// rating (product condition, speed, how the order was handled overall).
router.post('/:id/rate', wrap(async (req, res) => {
  const { rating, remarks } = req.body;
  const numRating = Number(rating);
  if (!numRating || numRating < 1 || numRating > 5) return sendError(res, 400, 'rating must be between 1 and 5.');

  const order = await Order.findById(req.params.id);
  if (!order) return sendError(res, 404, 'Order not found.');
  if (order.status !== 'Completed') return sendError(res, 400, 'You can rate a delivery once the order is Completed.');
  if (order.delivery_rated_at) return sendError(res, 409, 'This order has already been rated.');

  await Order.rateDelivery(req.params.id, numRating, remarks);
  return sendSuccess(res, 200, 'Thank you for rating your delivery!');
}));

// ---------- Admin ----------
router.get('/admin/all', protect, requireAdmin, wrap(async (req, res) => {
  const orders = await Order.findAllForAdmin(req.query);
  return sendSuccess(res, 200, 'Orders retrieved.', { orders });
}));

// Admin can update ANY order's status (no seller-ownership check, unlike
// the seller-facing PUT /:id/status above).
router.put('/admin/:id/status', protect, requireAdmin, wrap(async (req, res) => {
  const { status } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) return sendError(res, 404, 'Order not found.');
  await Order.updateStatus(req.params.id, status);
  return sendSuccess(res, 200, `Order status updated to ${status}.`);
}));

module.exports = router;
