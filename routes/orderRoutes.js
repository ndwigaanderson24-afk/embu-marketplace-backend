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

// Buyers see subtotal/total (what they paid) but never how that price
// breaks down internally - no commission, margin, risk allocation,
// seller earnings, or per-item seller price. delivery_fee is stripped
// too, since delivery is already baked into the price, not a separate
// charge the buyer should see a number for.
const ORDER_FIELDS_HIDDEN_FROM_BUYER = ['commission', 'margin_total', 'risk_allocation_total', 'seller_earnings', 'delivery_fee'];
function stripOrderForBuyer(order) {
  const clean = { ...order };
  ORDER_FIELDS_HIDDEN_FROM_BUYER.forEach(f => delete clean[f]);
  if (Array.isArray(clean.items)) clean.items = clean.items.map(i => { const c = { ...i }; delete c.seller_price; return c; });
  return clean;
}

// Sellers see their own earnings and their own per-item price (it's
// literally the number they set), and the existing top-line commission
// figure - but not the newer, more granular margin/risk split, which
// stays admin-only.
const ORDER_FIELDS_HIDDEN_FROM_SELLER = ['margin_total', 'risk_allocation_total'];
function stripOrderForSeller(order) {
  const clean = { ...order };
  ORDER_FIELDS_HIDDEN_FROM_SELLER.forEach(f => delete clean[f]);
  return clean;
}

// ---------- Checkout (public - works for guests via session_id, or logged-in users) ----------
// Body: { session_id?, name, phone, id_number, address, delivery: { type, dest_county, dest_area?, address?, weight_override?, referral_code? }, pickup_date? }
router.post('/', optionalAuth, wrap(async (req, res) => {
  const { session_id, name, phone, id_number, address, delivery, pickup_date } = req.body;
  if (!name || !phone || !id_number) return sendError(res, 400, 'name, phone and id_number are required.');
  if (!isValidPhoneNumber(phone)) return sendError(res, 400, 'Please enter a valid phone number.');
  if (!delivery || !delivery.type || !delivery.dest_county) return sendError(res, 400, 'delivery.type and delivery.dest_county are required.');
  if (delivery.type === 'delivery' && !delivery.address) return sendError(res, 400, 'delivery.address is required for home delivery.');

  const owner = req.user ? { userId: req.user.id } : { sessionId: session_id };
  if (!owner.userId && !owner.sessionId) return sendError(res, 400, 'session_id is required for guest checkout.');

  const cartItems = await Cart.getItems(owner);
  if (!cartItems.length) return sendError(res, 400, 'Your cart is empty.');

  for (const item of cartItems) {
    if (item.qty > item.stock) return sendError(res, 400, `Insufficient stock for "${item.name}" (${item.stock} left).`);
  }

  const orders = await Order.createFromCart(cartItems, {
    userId: req.user ? req.user.id : null, name, phone, idNumber: id_number, address
  }, {
    type: delivery.type,
    destCounty: delivery.dest_county,
    destArea: delivery.dest_area,
    address: delivery.address,
    weightOverride: delivery.weight_override,
    referralCode: delivery.referral_code,
    pickupDate: pickup_date || null
  });

  await Cart.clear(owner);

  return sendSuccess(res, 201, orders.length > 1
    ? `${orders.length} orders placed (one per seller).`
    : 'Order placed.', { orders });
}));

// ---------- Delivery price preview (no order created - for the cart page live total) ----------
router.post('/preview', optionalAuth, wrap(async (req, res) => {
  const { session_id, dest_county, delivery_type, weight_override } = req.body;
  const owner = req.user ? { userId: req.user.id } : { sessionId: session_id };
  const cartItems = await Cart.getItems(owner);
  const plan = Order.computeDeliveryPlan(cartItems, dest_county, delivery_type, weight_override);
  // This is a buyer-facing preview (the cart page's live total) - strip
  // the internal breakdown (seller price, margin, delivery/risk
  // allocation) from each group before it ever leaves the server. The
  // buyer should see only that delivery is free, never the numbers
  // behind it.
  const safePlan = {
    totalWeight: plan.totalWeight,
    groups: plan.groups.map(g => ({ sellerId: g.sellerId, county: g.county, weight: g.weight, subtotal: g.subtotal }))
  };
  return sendSuccess(res, 200, 'Delivery plan calculated.', safePlan);
}));

// ---------- Logged-in customer's own order history ----------
router.get('/customer/mine', protect, wrap(async (req, res) => {
  const orders = await Order.findByCustomerUserId(req.user.id);
  return sendSuccess(res, 200, 'Orders retrieved.', { orders: orders.map(stripOrderForBuyer) });
}));

// ---------- Public tracking ----------
router.get('/:trackingNumber/track', wrap(async (req, res) => {
  const order = await Order.findByTrackingNumber(req.params.trackingNumber);
  if (!order) return sendError(res, 404, 'Order not found.');
  return sendSuccess(res, 200, 'Order found.', { order: stripOrderForBuyer(order) });
}));

// ---------- Seller ----------
router.get('/mine', protect, requireActiveSeller, wrap(async (req, res) => {
  const orders = await Order.findBySeller(req.user.id, req.query);
  return sendSuccess(res, 200, 'Orders retrieved.', { orders: orders.map(stripOrderForSeller) });
}));

router.get('/:id', protect, wrap(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return sendError(res, 404, 'Order not found.');
  const isSellerOwner = req.user && order.seller_id === req.user.id;
  const isBuyerOwner = req.user && order.customer_user_id === req.user.id;
  if (!isSellerOwner && !isBuyerOwner && !req.isAdmin) return sendError(res, 403, 'You do not have access to this order.');
  // Admin sees everything; a seller sees their own earnings and item
  // prices; a buyer sees only what they paid, nothing about how it
  // breaks down internally.
  const safeOrder = req.isAdmin ? order : isSellerOwner ? stripOrderForSeller(order) : stripOrderForBuyer(order);
  return sendSuccess(res, 200, 'Order retrieved.', { order: safeOrder });
}));

// Canonical 6-stage lifecycle: Pending -> Accepted -> Packed -> In Transit
// -> Delivered -> Completed. A seller is only paid once Completed.
// ---------- Seller: move an order through its own legal stages ----------
router.put('/:id/status', protect, requireActiveSeller, wrap(async (req, res) => {
  const { status, notes } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order || order.seller_id !== req.user.id) return sendError(res, 404, 'Order not found.');

  let result;
  try {
    result = await Order.updateStatus(req.params.id, status, { actorType: 'seller', actorId: req.user.id, notes });
  } catch (err) {
    return sendError(res, 400, err.message);
  }
  if (!result.changed) return sendSuccess(res, 200, `Order is already ${status}.`, result);

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

  return sendSuccess(res, 200, `Order status updated to ${status}.`, result);
}));

// ---------- Customer: confirm they've received a Delivered order ----------
// The only way an order can ever reach Completed - enforced by the state
// machine itself (Completed is only reachable from Delivered, and only a
// customer or admin can make that specific move), not just this route.
router.put('/:id/confirm-receipt', protect, wrap(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order || order.customer_user_id !== req.user.id) return sendError(res, 404, 'Order not found.');

  let result;
  try {
    result = await Order.updateStatus(req.params.id, 'Completed', { actorType: 'customer', actorId: req.user.id, notes: 'Customer confirmed receipt' });
  } catch (err) {
    return sendError(res, 400, err.message);
  }

  if (order.seller_id) {
    const Notification = require('../models/notification');
    await Notification.create(order.seller_id, {
      title: `Order #${order.order_number} completed`,
      message: `${order.customer_name} confirmed they received their order.`,
      type: 'order_status'
    });
  }

  return sendSuccess(res, 200, 'Thanks for confirming! Order marked as completed.', result);
}));

// ---------- Status history - for any of the order's own legitimate viewers ----------
router.get('/:id/history', protect, wrap(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return sendError(res, 404, 'Order not found.');
  const isOwner = (order.seller_id === req.user.id) || (order.customer_user_id === req.user.id);
  if (!isOwner && !req.isAdmin) return sendError(res, 403, 'You do not have access to this order.');
  const OrderStatus = require('../models/orderStatus');
  const history = await OrderStatus.getHistory(req.params.id);
  return sendSuccess(res, 200, 'History retrieved.', { history });
}));

// ---------- Rider assignment (admin) ----------
// Photo is optional and expected to already be a path/URL from your
// upload endpoint - this route just links it to the order.
router.post('/:id/rider', protect, requireAdmin, wrap(async (req, res) => {
  const { name, phone, photo } = req.body;
  if (!name || !phone) return sendError(res, 400, 'Rider name and phone are required.');
  const order = await Order.findById(req.params.id);
  if (!order) return sendError(res, 404, 'Order not found.');
  await Order.assignRider(req.params.id, { name, phone, photo }, { actorType: 'admin', actorId: req.user.id });
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

// GET /api/orders/admin/new-count?since=<ISO timestamp> - a simple "how
// many orders have come in since I last checked" badge for the admin
// dashboard. The admin's own browser remembers when they last looked
// (bookkeeping for themselves, not shared data), and this just answers
// against the real orders table - no separate notification row needed
// since there's realistically one or two admins, not many.
router.get('/admin/new-count', protect, requireAdmin, wrap(async (req, res) => {
  const since = req.query.since;
  if (!since) return sendError(res, 400, 'since is required (ISO timestamp).');
  const count = await Order.countSince(since);
  return sendSuccess(res, 200, 'Count retrieved.', { count });
}));

// Admin can update ANY order's status (no seller-ownership check, unlike
// the seller-facing PUT /:id/status above) - now goes through the same
// state machine, and notifies the customer too (previously only a
// seller-made change would notify - admin changes never did).
router.put('/admin/:id/status', protect, requireAdmin, wrap(async (req, res) => {
  const { status, notes } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) return sendError(res, 404, 'Order not found.');

  let result;
  try {
    result = await Order.updateStatus(req.params.id, status, { actorType: 'admin', actorId: req.user.id, notes });
  } catch (err) {
    return sendError(res, 400, err.message);
  }
  if (!result.changed) return sendSuccess(res, 200, `Order is already ${status}.`, result);

  if (order.customer_user_id) {
    const Notification = require('../models/notification');
    await Notification.create(order.customer_user_id, {
      title: `Order #${order.order_number} update`,
      message: `Your order status is now: ${status}.`,
      type: 'order_status'
    });
  }
  const { logActivity } = require('../controllers/adminController');
  await logActivity('admin', 'order_status_updated', `order ${req.params.id} -> ${status}`);

  return sendSuccess(res, 200, `Order status updated to ${status}.`, result);
}));

module.exports = router;
