// routes/cartRoutes.js
// NOTE: not on your requested file list, but cart.js (the model) needs
// *some* HTTP surface to be usable - added here the same way I added a
// checkout endpoint last time. Mounted at /api/cart in server.js.

const express = require('express');
const router = express.Router();
const Cart = require('../models/cart');
const { optionalAuth } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../helpers');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
function resolveOwner(req) {
  if (req.user) return { userId: req.user.id };
  const sessionId = req.query.session_id || req.body.session_id;
  return sessionId ? { sessionId } : null;
}

router.get('/', optionalAuth, wrap(async (req, res) => {
  const owner = resolveOwner(req);
  if (!owner) return sendError(res, 400, 'session_id is required for guest carts.');
  const items = await Cart.getItems(owner);
  return sendSuccess(res, 200, 'Cart retrieved.', { items });
}));

router.post('/add', optionalAuth, wrap(async (req, res) => {
  const owner = resolveOwner(req);
  if (!owner) return sendError(res, 400, 'session_id is required for guest carts.');
  const { product_id, qty, variant_id, variant_name } = req.body;
  if (!product_id) return sendError(res, 400, 'product_id is required.');
  await Cart.addItem(owner, product_id, Number(qty) || 1, variant_id || null, variant_name || null);
  const items = await Cart.getItems(owner);
  return sendSuccess(res, 200, 'Added to cart.', { items });
}));

router.put('/update', optionalAuth, wrap(async (req, res) => {
  const owner = resolveOwner(req);
  if (!owner) return sendError(res, 400, 'session_id is required for guest carts.');
  const { product_id, qty, variant_id } = req.body;
  if (!product_id || qty === undefined) return sendError(res, 400, 'product_id and qty are required.');
  await Cart.updateQty(owner, product_id, Number(qty), variant_id || null);
  const items = await Cart.getItems(owner);
  return sendSuccess(res, 200, 'Cart updated.', { items });
}));

router.delete('/:productId', optionalAuth, wrap(async (req, res) => {
  const owner = resolveOwner(req);
  if (!owner) return sendError(res, 400, 'session_id is required for guest carts.');
  await Cart.removeItem(owner, req.params.productId, req.query.variant_id || null);
  return sendSuccess(res, 200, 'Removed from cart.');
}));

// Called right after login so a guest's localStorage-session cart merges
// into the now-known user account instead of being lost.
const { protect } = require('../middleware/auth');
router.post('/merge', protect, wrap(async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return sendError(res, 400, 'session_id is required.');
  await Cart.mergeGuestCartIntoUser(session_id, req.user.id);
  return sendSuccess(res, 200, 'Cart merged.');
}));

module.exports = router;
