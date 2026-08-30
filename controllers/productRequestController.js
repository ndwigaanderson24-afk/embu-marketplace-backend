// controllers/productRequestController.js
const { ProductRequest, RequestOffer } = require('../models/productRequest');
const Product = require('../models/product');
const Cart = require('../models/cart');
const { sendSuccess, sendError } = require('../helpers');

// Buyer submits a request - works for guests too, matched later by
// phone number since not every buyer has an account.
exports.createRequest = async (req, res) => {
  const { full_name, phone, email, delivery_location, product_name, category, description, quantity, budget, needed_by_date, image } = req.body;
  if (!full_name || !phone || !delivery_location || !product_name || !category || !description) {
    return sendError(res, 400, 'Please fill in all required fields.');
  }
  const id = await ProductRequest.create({
    buyer_user_id: req.user ? req.user.id : null,
    full_name, phone, email, delivery_location, product_name, category, description,
    quantity, budget, needed_by_date, image
  });
  const request = await ProductRequest.findById(id);
  return sendSuccess(res, 201, 'Request submitted.', { request });
};

// Buyer's own requests, with their offers attached - matched by
// account if logged in, or by phone for guests.
exports.getMyRequests = async (req, res) => {
  const phone = req.query.phone || '';
  const userId = req.user ? req.user.id : null;
  if (!phone && !userId) return sendSuccess(res, 200, 'No requests.', { requests: [] });
  const requests = await ProductRequest.findForBuyer({ userId, phone });
  for (const r of requests) r.offers = await RequestOffer.findByRequestId(r.id);
  return sendSuccess(res, 200, 'Requests retrieved.', { requests });
};

// What sellers browsing for requests to fulfil can see.
exports.getSharedRequests = async (req, res) => {
  const requests = await ProductRequest.findSharedWithSellers();
  for (const r of requests) r.offers = await RequestOffer.findByRequestId(r.id);
  return sendSuccess(res, 200, 'Shared requests retrieved.', { requests });
};

exports.submitOffer = async (req, res) => {
  const request = await ProductRequest.findById(req.params.id);
  if (!request) return sendError(res, 404, 'Request not found.');
  if (!['shared_with_sellers', 'seller_found'].includes(request.status)) {
    return sendError(res, 400, 'This request is not open for offers right now.');
  }
  const { available_qty, price, delivery_time, notes } = req.body;
  if (!available_qty || available_qty < 1) return sendError(res, 400, 'Please enter a valid available quantity.');
  if (!price || price <= 0) return sendError(res, 400, 'Please enter a valid price.');
  if (!delivery_time) return sendError(res, 400, 'Please enter an estimated delivery time.');

  const already = await RequestOffer.hasSellerAlreadyOffered(request.id, req.user.id);
  if (already) return sendError(res, 400, 'You have already submitted an offer for this request.');

  await RequestOffer.create(request.id, { seller_id: req.user.id, available_qty, price, delivery_time, notes });
  if (request.status === 'shared_with_sellers') await ProductRequest.updateStatus(request.id, 'seller_found');

  return sendSuccess(res, 201, 'Offer submitted.', {});
};

// Buyer's response once admin has approved an offer - accepting is
// handled separately (Stage 2, wires into the real order pipeline);
// declining sends the request back into the pool for admin to approve
// a different offer instead.
exports.declineOffer = async (req, res) => {
  const request = await ProductRequest.findById(req.params.id);
  if (!request) return sendError(res, 404, 'Request not found.');
  if (request.approved_offer_id) await RequestOffer.updateStatus(request.approved_offer_id, 'rejected');
  const pendingCount = await RequestOffer.findPendingCountForRequest(request.id);
  await ProductRequest.updateStatus(request.id, pendingCount > 0 ? 'seller_found' : 'shared_with_sellers', { approved_offer_id: null });
  return sendSuccess(res, 200, "Offer declined. We'll look for another seller.", {});
};

// Buyer accepting an admin-approved offer - the "Stage 2" piece that
// was never actually built (only declineOffer existed). Creates a
// real product for this specific fulfillment - not publicly browsable
// (status: 'request_fulfillment' keeps it out of Product.findPublic's
// results automatically, same as any other non-'active' product) but
// otherwise completely real: has its own seller, its own price run
// through the exact same pricing formula every product uses, and adds
// straight to the buyer's cart. From here the buyer checks out through
// the site's existing, already-proven Cart -> IntaSend payment flow
// unchanged - which is what makes order tracking, reviews, and seller
// earnings all work with zero special-casing, instead of needing a
// parallel system just for requests. This only creates the product and
// stages it in the cart - the request's own "Order Created" status
// still needs a real order to exist first, which only happens once the
// buyer actually completes checkout.
exports.acceptOffer = async (req, res) => {
  const request = await ProductRequest.findById(req.params.id);
  if (!request) return sendError(res, 404, 'Request not found.');
  if (request.status !== 'awaiting_buyer_confirmation') {
    return sendError(res, 400, 'This request is not awaiting your confirmation.');
  }
  const offer = await RequestOffer.findById(request.approved_offer_id);
  if (!offer) return sendError(res, 404, 'Approved offer not found.');

  const productId = await Product.create(offer.seller_id, {
    name: request.product_name,
    description: request.description,
    category: request.category,
    seller_price: offer.price,
    image: request.image || undefined,
    stock: offer.available_qty,
    weight: 1,
    status: 'request_fulfillment'
  });

  const owner = req.user ? { userId: req.user.id } : { sessionId: req.body.session_id };
  if (!owner.userId && !owner.sessionId) return sendError(res, 400, 'session_id is required to add this to a guest cart.');
  await Cart.addItem(owner, productId, request.quantity || 1);

  await ProductRequest.setProductId(request.id, productId);

  return sendSuccess(res, 200, "Offer accepted! We've added it to your cart - complete checkout to place the order.", { productId });
};

// ── Admin ────────────────────────────────────────────────────────────
exports.adminGetAllRequests = async (req, res) => {
  const requests = await ProductRequest.findAllForAdmin();
  for (const r of requests) r.offers = await RequestOffer.findByRequestId(r.id);
  return sendSuccess(res, 200, 'Requests retrieved.', { requests });
};

exports.adminShareWithSellers = async (req, res) => {
  const request = await ProductRequest.findById(req.params.id);
  if (!request) return sendError(res, 404, 'Request not found.');
  await ProductRequest.updateStatus(request.id, 'shared_with_sellers');
  return sendSuccess(res, 200, 'Shared with sellers.', {});
};

exports.adminApproveOffer = async (req, res) => {
  const request = await ProductRequest.findById(req.params.id);
  if (!request) return sendError(res, 404, 'Request not found.');
  const offer = await RequestOffer.findById(req.params.offerId);
  if (!offer || offer.request_id !== request.id) return sendError(res, 404, 'Offer not found.');

  await RequestOffer.updateStatus(offer.id, 'approved');
  await ProductRequest.updateStatus(request.id, 'awaiting_buyer_confirmation', { approved_offer_id: offer.id });
  return sendSuccess(res, 200, `Offer from ${offer.seller_business_name} approved and sent to the buyer.`, {});
};

exports.adminRejectOffer = async (req, res) => {
  const offer = await RequestOffer.findById(req.params.offerId);
  if (!offer || offer.request_id !== Number(req.params.id)) return sendError(res, 404, 'Offer not found.');
  await RequestOffer.updateStatus(offer.id, 'rejected');
  return sendSuccess(res, 200, 'Offer rejected.', {});
};

exports.adminCancelRequest = async (req, res) => {
  const request = await ProductRequest.findById(req.params.id);
  if (!request) return sendError(res, 404, 'Request not found.');
  await ProductRequest.updateStatus(request.id, 'cancelled');
  return sendSuccess(res, 200, 'Request cancelled.', {});
};
