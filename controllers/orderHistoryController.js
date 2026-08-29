// controllers/orderHistoryController.js
// Exposes OrderStatus.getHistory() (already existed, was write-only -
// every status change was being recorded with a timestamp but nothing
// anywhere ever read it back) to whoever is actually allowed to see a
// given order's timeline: the order's own customer, the order's own
// seller, or admin.

const Order = require('../models/order');
const OrderStatus = require('../models/orderStatus');
const { sendSuccess, sendError } = require('../helpers');

// GET /api/orders/:id/history  (protected)
exports.getHistory = async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return sendError(res, 404, 'Order not found.');

  const isOwner = order.customer_user_id && String(order.customer_user_id) === String(req.user.id);
  const isSeller = order.seller_id && String(order.seller_id) === String(req.user.id);
  if (!isOwner && !isSeller && !req.isAdmin) {
    return sendError(res, 403, 'This order does not belong to you.');
  }

  const history = await OrderStatus.getHistory(req.params.id);
  return sendSuccess(res, 200, 'Order history retrieved.', { history });
};
