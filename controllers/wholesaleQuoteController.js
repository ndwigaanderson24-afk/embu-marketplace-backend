// controllers/wholesaleQuoteController.js

const Product = require('../models/product');
const WholesaleQuote = require('../models/wholesaleQuote');
const { sendSuccess, sendError } = require('../helpers');

// POST /api/wholesale-quotes - buyer requesting a custom bulk quote on
// a specific wholesale product. No login required (matches how the
// rest of checkout already supports guest buyers) - just needs a real
// way to reach the buyer back.
exports.create = async (req, res) => {
  const { product_id, quantity_requested, message, buyer_name, buyer_phone, buyer_email } = req.body;

  if (!product_id) return sendError(res, 400, 'product_id is required.');
  if (!quantity_requested || Number(quantity_requested) <= 0) {
    return sendError(res, 400, 'quantity_requested must be a positive number.');
  }
  if (!buyer_name || !buyer_phone) {
    return sendError(res, 400, 'buyer_name and buyer_phone are required.');
  }

  const product = await Product.findById(product_id);
  if (!product) return sendError(res, 404, 'Product not found.');
  if (!product.wholesale_tiers_json || product.wholesale_tiers_json === '[]') {
    return sendError(res, 400, 'This product is not enabled for wholesale.');
  }

  const id = await WholesaleQuote.create({
    productId: product_id,
    sellerId: product.seller_id || null,
    buyerUserId: req.user ? req.user.id : null,
    buyerName: buyer_name,
    buyerPhone: buyer_phone,
    buyerEmail: buyer_email,
    quantityRequested: Number(quantity_requested),
    message
  });

  return sendSuccess(res, 201, 'Quote request sent.', { id });
};

// GET /api/wholesale-quotes/mine - a seller's own incoming bulk quote
// requests. Requires login - only the seller who owns the product
// should see who's asking for a bulk deal on it.
exports.getMine = async (req, res) => {
  const quotes = await WholesaleQuote.findForSeller(req.user.id);
  return sendSuccess(res, 200, 'Quote requests retrieved.', { quotes });
};

// PUT /api/wholesale-quotes/:id/status - seller marking a request as
// responded to or closed, once they've followed up with the buyer
// directly (phone/WhatsApp, same pattern as the rest of the buyer-
// request system).
exports.updateStatus = async (req, res) => {
  const { status } = req.body;
  if (!['responded', 'closed'].includes(status)) {
    return sendError(res, 400, "status must be 'responded' or 'closed'.");
  }
  const updated = await WholesaleQuote.updateStatus(req.params.id, req.user.id, status);
  if (!updated) return sendError(res, 404, 'Quote request not found or already closed.');
  return sendSuccess(res, 200, 'Status updated.', {});
};
