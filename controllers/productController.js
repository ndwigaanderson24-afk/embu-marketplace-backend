// controllers/productController.js

const Product = require('../models/product');
const Review = require('../models/review');
const Order = require('../models/order');
const { sendSuccess, sendError } = require('../helpers');
const AnalyticsEvent = require('../models/analyticsEvent');
const { uploadBufferToCloudinary } = require('../cloudinaryUpload');

// POST /api/products/upload-video  (protected - seller or admin, either
// can add a product video; not tied to a specific product yet, since
// the video needs to exist on Cloudinary before it can be included in
// a create/update payload). Deliberately its own endpoint rather than
// bundled into the regular product create/update body - a 5-minute
// video is genuinely large, and forcing it through the same base64-in-
// JSON path the admin form uses for photos would risk huge request
// bodies and timeouts. multer hands this a real file buffer instead,
// same pattern already proven for the seller's photo uploads.
exports.uploadVideo = async (req, res) => {
  if (!req.file) return sendError(res, 400, 'No video file was received.');
  try {
    const url = await uploadBufferToCloudinary(req.file.buffer, 'kenlynk/product-videos', 'video');
    return sendSuccess(res, 200, 'Video uploaded.', { url });
  } catch (err) {
    return sendError(res, 500, 'Video upload failed: ' + err.message);
  }
};

// The pricing breakdown (seller_price, price_commission,
// price_delivery_fee) must never reach a buyer - they see only the
// final, all-inclusive `price`. Admin-only endpoints (adminGetAll etc)
// skip this and return the full row.
const PRICE_INTERNAL_FIELDS = ['seller_price', 'price_commission', 'price_delivery_fee'];

function stripPricingForBuyer(product) {
  if (!product) return product;
  const clean = { ...product };
  PRICE_INTERNAL_FIELDS.forEach(f => delete clean[f]);
  return clean;
}

// A seller can see their own asking price and the final buyer price
// (so they understand what changed), but not the commission/delivery-fee
// split - that stays admin-only, same visibility rule as before.
function stripBreakdownForSeller(product) {
  if (!product) return product;
  const clean = { ...product };
  delete clean.price_commission;
  delete clean.price_delivery_fee;
  return clean;
}

// POST /api/products  (protected, requireActiveSeller, multipart/form-data field "images")
// POST /api/products/preview-price  (protected, seller or admin)
// Lets a seller see what a buyer will actually pay before they publish
// - runs the exact same calculation product creation uses, just without
// saving anything. Returns only seller_price (echoed back) and the
// final price to a seller; admin also gets the commission/delivery-fee
// breakdown, matching the same seller-vs-admin visibility rule used
// everywhere else pricing is shown.
exports.previewPrice = async (req, res) => {
  const { seller_price, weight } = req.body;
  if (seller_price === undefined || Number(seller_price) <= 0) {
    return sendError(res, 400, 'seller_price must be greater than 0.');
  }
  const priced = await Product.previewPrice(seller_price, { weight });
  const data = { seller_price: priced.sellerPrice, price: priced.finalPrice };
  if (req.isAdmin) {
    data.commission = priced.commission;
    data.delivery_fee = priced.deliveryFee;
  }
  return sendSuccess(res, 200, 'Price calculated.', data);
};

exports.create = async (req, res) => {
  const { name, seller_price } = req.body;
  if (!name || seller_price === undefined) return sendError(res, 400, 'name and seller_price are required.');
  if (Number(seller_price) <= 0) return sendError(res, 400, 'seller_price must be greater than 0.');

  // The one confirmed real gap in the plan system - a Free seller could
  // list unlimited products despite the documented cap, since nothing
  // actually checked it before now. Admin's own product creation
  // (adminCreate below) deliberately never calls this - admin access
  // stays free and no-friction, same as everywhere else in the app.
  const limitCheck = await Product.checkProductLimit(req.user.id);
  if (!limitCheck.allowed) {
    const planLabel = limitCheck.effectivePlan.charAt(0).toUpperCase() + limitCheck.effectivePlan.slice(1);
    return sendError(res, 403, `Your ${planLabel} plan allows up to ${limitCheck.limit} products, and you've already listed ${limitCheck.current}. Upgrade your plan to add more.`);
  }

  // County always comes from the seller's own account, never the request
  // body - this is what makes delivery-fee calculation trustworthy.
  const image = req.files && req.files.length ? `/uploads/products/${req.files[0].filename}` : (req.body.image || null);
  const productId = await Product.create(req.user.id, { ...req.body, county: req.user.county, image });
  const product = await Product.findById(productId);
  return sendSuccess(res, 201, 'Product added.', { product: stripBreakdownForSeller(product) });
};

// GET /api/products/mine  (protected)
exports.getMine = async (req, res) => {
  const products = await Product.findBySeller(req.user.id, req.query);
  return sendSuccess(res, 200, 'Products retrieved.', { products: products.map(stripBreakdownForSeller) });
};

// PUT /api/products/:id  (protected, multipart/form-data field "images" optional)
exports.update = async (req, res) => {
  const image = req.files && req.files.length ? `/uploads/products/${req.files[0].filename}` : undefined;
  const updated = await Product.update(req.params.id, req.user.id, { ...req.body, ...(image ? { image } : {}) });
  if (!updated) return sendError(res, 404, 'Product not found or nothing to update.');
  const product = await Product.findById(req.params.id);
  return sendSuccess(res, 200, 'Product updated.', { product: stripBreakdownForSeller(product) });
};

// DELETE /api/products/:id  (protected)
exports.remove = async (req, res) => {
  const deleted = await Product.delete(req.params.id, req.user.id);
  if (!deleted) return sendError(res, 404, 'Product not found.');
  return sendSuccess(res, 200, 'Product deleted.');
};

// GET /api/products  (public storefront)
exports.getPublicList = async (req, res) => {
  const products = await Product.findPublic(req.query);
  return sendSuccess(res, 200, 'Products retrieved.', { products: products.map(stripPricingForBuyer) });
};

// GET /api/products/wholesale  (public) - every wholesale-enabled
// product across every category, with filters/sort applied on top of
// the parsed tier data. Filtering/sorting happens here rather than in
// SQL since tiers are stored as JSON and the codebase already parses
// them in JS elsewhere (getUnitPriceForQty in order.js) - keeping that
// same approach here rather than introducing fragile JSON-path SQL.
exports.getWholesale = async (req, res) => {
  const raw = await Product.findWholesale();

  let items = raw.map(p => {
    let tiers = [];
    try { tiers = JSON.parse(p.wholesale_tiers_json || '[]'); } catch (e) { tiers = []; }
    const prices = tiers.map(t => Number(t.price)).filter(n => !isNaN(n));
    const lowestWholesalePrice = prices.length ? Math.min(...prices) : Number(p.price);
    const moq = tiers.length ? Number(tiers[0].min) || 1 : 1;
    const retailPrice = Number(p.price) || 0;
    const bestDealPercent = retailPrice > 0
      ? Math.round(((retailPrice - lowestWholesalePrice) / retailPrice) * 100)
      : 0;
    return { ...stripPricingForBuyer(p), wholesaleTiers: tiers, moq, lowestWholesalePrice, bestDealPercent };
  });

  // Filters
  const { category_id, min_price, max_price, min_moq, seller_id, county, sort } = req.query;
  if (category_id) items = items.filter(p => String(p.category_id) === String(category_id));
  if (min_price) items = items.filter(p => p.lowestWholesalePrice >= Number(min_price));
  if (max_price) items = items.filter(p => p.lowestWholesalePrice <= Number(max_price));
  if (min_moq) items = items.filter(p => p.moq >= Number(min_moq));
  if (seller_id) items = items.filter(p => String(p.seller_id) === String(seller_id));
  if (county) items = items.filter(p => (p.county || '').toLowerCase() === String(county).toLowerCase());

  // Sort
  if (sort === 'popular') {
    const viewCounts = await AnalyticsEvent.getViewCountsByProduct(items.map(p => p.id));
    items.forEach(p => { p.views = viewCounts[p.id] || 0; });
    items.sort((a, b) => b.views - a.views);
  } else if (sort === 'price') {
    items.sort((a, b) => a.lowestWholesalePrice - b.lowestWholesalePrice);
  } else if (sort === 'deal') {
    items.sort((a, b) => b.bestDealPercent - a.bestDealPercent);
  } else {
    // 'newest' or unspecified - default
    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  // Simple pagination
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;
  const total = items.length;
  items = items.slice(offset, offset + limit);

  return sendSuccess(res, 200, 'Wholesale products retrieved.', { products: items, total });
};

// Turns a MySQL datetime into something new Date() can only read one
// way - unambiguously UTC. mysql2 can hand this back either as a plain
// space-separated string ("2026-08-22 10:00:00") or as an already-
// parsed JS Date object depending on driver config, so this handles
// both rather than assuming one. For the string case: without this, V8
// (both in the browser and in this Node backend) falls back to
// interpreting a space-separated datetime as LOCAL time, so the browser
// and this server could each read the exact same stored value as a
// different moment whenever the two run in different timezones. The
// frontend's mapApiProduct() already does the same conversion for
// display (kanyagaStartAt/kanyagaEndAt, flashDealEndsAt) - this mirrors
// it here so the backend's notion of "is this Kanyaga deal active right
// now" can never disagree with what the Shop page already showed the
// admin when they set it up.
function parseMysqlDatetimeAsUtc(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  return new Date(String(value).replace(' ', 'T') + 'Z');
}

// GET /api/products/kanyaga  (public) - every product currently in an
// active Kanyaga campaign. Status (Active/Scheduled/Expired) is worked
// out here by comparing kanyaga_start_at/kanyaga_end_at to right now,
// never stored on the row, so a product can never get stuck showing a
// stale status - only genuinely Active ones are returned here; a
// Scheduled or Expired product just quietly isn't included, no cleanup
// job needed.
exports.getKanyaga = async (req, res) => {
  const raw = await Product.findKanyaga();
  const now = new Date();

  const items = raw
    .map(p => {
      const start = parseMysqlDatetimeAsUtc(p.kanyaga_start_at);
      const end = parseMysqlDatetimeAsUtc(p.kanyaga_end_at);
      let kanyagaStatus;
      if (start && start > now) kanyagaStatus = 'scheduled';
      else if (end && end < now) kanyagaStatus = 'expired';
      else kanyagaStatus = 'active';

      const regularPrice = Number(p.price) || 0;
      const kanyagaPrice = Number(p.kanyaga_price) || 0;
      const savedAmount = Math.max(0, regularPrice - kanyagaPrice);
      const savedPercent = regularPrice > 0 ? Math.round((savedAmount / regularPrice) * 100) : 0;

      return {
        ...stripPricingForBuyer(p),
        kanyagaStatus,
        kanyagaPrice,
        regularPrice,
        savedAmount,
        savedPercent,
        kanyagaCampaign: p.kanyaga_campaign || 'kanyaga'
      };
    })
    .filter(p => p.kanyagaStatus === 'active');

  return sendSuccess(res, 200, 'Kanyaga products retrieved.', { products: items });
};

// GET /api/products/:id  (public)
exports.getOne = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return sendError(res, 404, 'Product not found.');
  const reviews = await Review.findByProduct(req.params.id);
  return sendSuccess(res, 200, 'Product retrieved.', { product: stripPricingForBuyer(product), reviews });
};

// POST /api/products/:id/reviews  (protected)
// Gated to an order that reached Delivered/Completed and contains this
// product, and only once per order+product pair - matches the website.
exports.addReview = async (req, res) => {
  const { order_id, rating, comment } = req.body;
  const numRating = Number(rating);
  if (!order_id || !numRating || numRating < 1 || numRating > 5) return sendError(res, 400, 'order_id and a rating between 1 and 5 are required.');

  const order = await Order.findById(order_id);
  if (!order) return sendError(res, 404, 'Order not found.');
  if (req.user && order.customer_user_id && order.customer_user_id !== req.user.id) {
    return sendError(res, 403, 'This order does not belong to you.');
  }
  if (!['Delivered', 'Completed'].includes(order.status)) {
    return sendError(res, 400, 'You can review a product once your order has been delivered.');
  }
  if (!order.items.some(i => String(i.product_id) === String(req.params.id))) {
    return sendError(res, 400, 'This product is not part of that order.');
  }
  if (await Review.alreadyReviewed(order_id, req.params.id)) {
    return sendError(res, 409, "You've already reviewed this product for this order.");
  }

  await Review.create({
    order_id, product_id: req.params.id, customer_user_id: req.user ? req.user.id : null,
    customer_name: order.customer_name, rating: numRating, comment
  });
  return sendSuccess(res, 201, 'Thank you for rating this product!');
};

// POST /api/products/admin  (admin) - creates a platform product with no
// seller attached (seller_id NULL), shown on the storefront alongside
// seller products. Accepts a JSON body (image as a base64 data URL or
// external URL string), matching how the admin dashboard's form works.
exports.adminCreate = async (req, res) => {
  const { name, seller_price } = req.body;
  if (!name || seller_price === undefined) return sendError(res, 400, 'name and seller_price are required.');
  if (Number(seller_price) <= 0) return sendError(res, 400, 'seller_price must be greater than 0.');

  const productId = await Product.create(null, { ...req.body, county: req.body.county || null });
  const product = await Product.findById(productId);
  return sendSuccess(res, 201, 'Product added.', { product });
};

// PUT /api/products/admin/:id  (admin) - edits any product, including
// ones owned by a seller, bypassing the seller-ownership check that the
// regular seller-facing update route enforces.
exports.adminUpdate = async (req, res) => {
  const updated = await Product.updateAsAdmin(req.params.id, req.body);
  if (!updated) return sendError(res, 404, 'Product not found or nothing to update.');
  const product = await Product.findById(req.params.id);
  return sendSuccess(res, 200, 'Product updated.', { product });
};

// GET /api/products/admin/all  (admin)
exports.adminGetAll = async (req, res) => {
  const products = await Product.findAllForAdmin(req.query);
  return sendSuccess(res, 200, 'Products retrieved.', { products });
};

// PUT /api/products/admin/:id/hide  (admin)
exports.adminHide = async (req, res) => {
  const pool = require('../db');
  await pool.query("UPDATE products SET status = 'inactive' WHERE id = ?", [req.params.id]);
  return sendSuccess(res, 200, 'Product hidden.');
};

// PUT /api/products/admin/:id/unhide
exports.adminUnhide = async (req, res) => {
  const pool = require('../db');
  await pool.query("UPDATE products SET status = 'active' WHERE id = ?", [req.params.id]);
  return sendSuccess(res, 200, 'Product unhidden.');
};

// DELETE /api/products/admin/:id  { reason? }  (admin)
// Permanently removes a product that violates platform standards - unlike
// adminHide/adminUnhide, this can't be undone by the seller re-listing it.
// Notifies the seller (if any) with the reason so they understand why.
exports.adminDelete = async (req, res) => {
  const { reason } = req.body;
  const product = await Product.findById(req.params.id);
  if (!product) return sendError(res, 404, 'Product not found.');

  const deleted = await Product.deleteAsAdmin(req.params.id);
  if (!deleted) return sendError(res, 404, 'Product not found.');

  if (product.seller_id) {
    const Notification = require('../models/notification');
    await Notification.create(product.seller_id, {
      title: 'A product was removed',
      message: reason
        ? `Your product "${product.name}" was removed by an admin: ${reason}`
        : `Your product "${product.name}" was removed by an admin for not meeting platform standards.`,
      type: 'product_removed'
    });
  }

  const { logActivity } = require('./adminController');
  await logActivity('admin', 'product_deleted', `product ${req.params.id} (${product.name})${reason ? ': ' + reason : ''}`);

  return sendSuccess(res, 200, 'Product permanently removed.');
};
