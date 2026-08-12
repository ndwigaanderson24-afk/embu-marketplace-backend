// controllers/productRequestController.js
const { ProductRequest, RequestOffer } = require('../models/productRequest');
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
