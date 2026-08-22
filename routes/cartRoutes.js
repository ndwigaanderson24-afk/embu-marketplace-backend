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

// Cart items carry the full product row (p.* in Cart.getItems), which
// now includes the internal pricing breakdown - this is a buyer-facing
// surface, so that breakdown must never reach the response. The buyer
// sees only the item's final price.
const PRICE_INTERNAL_FIELDS = ['seller_price', 'price_commission', 'price_delivery_fee'];
function stripPricingForBuyer(items) {
  return items.map(item => {
    const clean = { ...item };
    PRICE_INTERNAL_FIELDS.forEach(f => delete clean[f]);
    return clean;
  });
}

router.get('/', optionalAuth, wrap(async (req, res) => {
  const owner = resolveOwner(req);
  if (!owner) return sendError(res, 400, 'session_id is required for guest carts.');
  const items = await Cart.getItems(owner);
  return sendSuccess(res, 200, 'Cart retrieved.', { items: stripPricingForBuyer(items) });
}));

router.post('/add', optionalAuth, wrap(async (req, res) => {
  const owner = resolveOwner(req);
  if (!owner) return sendError(res, 400, 'session_id is required for guest carts.');
  const { product_id, qty, variant_id, variant_name } = req.body;
  if (!product_id) return sendError(res, 400, 'product_id is required.');
  // variant_id/variant_name were being silently dropped here even though
  // the frontend always sends them for a variant product - Cart.addItem
  // has always supported them (4th/5th params), this route just never
  // forwarded what it received. That's what made every variant purchase
  // decrement the base product's stock instead of that specific variant's.
  await Cart.addItem(owner, product_id, Number(qty) || 1, variant_id || null, variant_name || null);
  const items = await Cart.getItems(owner);
  return sendSuccess(res, 200, 'Added to cart.', { items: stripPricingForBuyer(items) });
}));

router.put('/update', optionalAuth, wrap(async (req, res) => {
  const owner = resolveOwner(req);
  if (!owner) return sendError(res, 400, 'session_id is required for guest carts.');
  const { product_id, qty, variant_id } = req.body;
  if (!product_id || qty === undefined) return sendError(res, 400, 'product_id and qty are required.');
  // Same missing variant_id as /add above - without this, changing the
  // quantity of a variant line would actually target the base product's
  // no-variant line instead (variantClause(null) matches variant_id IS
  // NULL), silently updating the wrong cart line.
  await Cart.updateQty(owner, product_id, Number(qty), variant_id || null);
  const items = await Cart.getItems(owner);
  return sendSuccess(res, 200, 'Cart updated.', { items: stripPricingForBuyer(items) });
}));

router.delete('/:productId', optionalAuth, wrap(async (req, res) => {
  const owner = resolveOwner(req);
  if (!owner) return sendError(res, 400, 'session_id is required for guest carts.');
  // A DELETE request has no body, so the frontend sends variant_id as a
  // query param - same missing piece as the two routes above meant
  // removing one colour/size of a product could remove the wrong line.
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
