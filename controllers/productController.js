// controllers/productController.js

const Product = require('../models/product');
const Review = require('../models/review');
const Order = require('../models/order');
const Category = require('../models/category');
const { sendSuccess, sendError } = require('../helpers');

// Confirms a submitted category_id actually exists before it's ever
// written to a product - sellers pick from the real category dropdown,
// they don't type it, and the backend never just trusts the id it's
// handed. Returns null (valid, no category chosen) or the confirmed
// numeric id, or throws a 400-shaped error the caller sends back.
async function resolveCategoryId(category_id) {
  if (category_id === undefined || category_id === null || category_id === '') return null;
  const cat = await Category.findById(category_id);
  if (!cat) { const err = new Error('Selected category does not exist.'); err.statusCode = 400; throw err; }
  return cat.id;
}

// POST /api/products  (protected, requireActiveSeller, multipart/form-data field "images")
exports.create = async (req, res) => {
  const { name, price, category_id } = req.body;
  if (!name || price === undefined) return sendError(res, 400, 'name and price are required.');
  if (Number(price) <= 0) return sendError(res, 400, 'price must be greater than 0.');

  let resolvedCategoryId;
  try { resolvedCategoryId = await resolveCategoryId(category_id); }
  catch (err) { return sendError(res, err.statusCode || 400, err.message); }

  // County always comes from the seller's own account, never the request
  // body - this is what makes delivery-fee calculation trustworthy.
  const image = req.files && req.files.length ? `/uploads/products/${req.files[0].filename}` : (req.body.image || null);
  const productId = await Product.create(req.user.id, { ...req.body, category_id: resolvedCategoryId, county: req.user.county, image });
  const product = await Product.findById(productId);
  return sendSuccess(res, 201, 'Product added.', { product });
};

// GET /api/products/mine  (protected)
exports.getMine = async (req, res) => {
  const products = await Product.findBySeller(req.user.id, req.query);
  return sendSuccess(res, 200, 'Products retrieved.', { products });
};

// PUT /api/products/:id  (protected, multipart/form-data field "images" optional)
exports.update = async (req, res) => {
  let resolvedCategoryId;
  if (req.body.category_id !== undefined) {
    try { resolvedCategoryId = await resolveCategoryId(req.body.category_id); }
    catch (err) { return sendError(res, err.statusCode || 400, err.message); }
  }
  const image = req.files && req.files.length ? `/uploads/products/${req.files[0].filename}` : undefined;
  const updated = await Product.update(req.params.id, req.user.id, {
    ...req.body,
    ...(resolvedCategoryId !== undefined ? { category_id: resolvedCategoryId } : {}),
    ...(image ? { image } : {})
  });
  if (!updated) return sendError(res, 404, 'Product not found or nothing to update.');
  const product = await Product.findById(req.params.id);
  return sendSuccess(res, 200, 'Product updated.', { product });
};

// DELETE /api/products/:id  (protected)
exports.remove = async (req, res) => {
  const deleted = await Product.delete(req.params.id, req.user.id);
  if (!deleted) return sendError(res, 404, 'Product not found.');
  return sendSuccess(res, 200, 'Product deleted.');
};

// GET /api/products  (public storefront)
// ?category_id=<id> filters by that category AND all of its subcategories
// (e.g. category_id for "Phones" also returns products filed under
// "Smartphones", "Phone Cases", etc). ?category=<string> still works as
// a plain string match for anything not yet migrated to category_id.
exports.getPublicList = async (req, res) => {
  const { category_id } = req.query;
  let category_ids;
  if (category_id) category_ids = await Category.getDescendantIds(category_id);

  const products = await Product.findPublic({ ...req.query, category_ids });
  return sendSuccess(res, 200, 'Products retrieved.', { products });
};

// GET /api/products/:id  (public)
exports.getOne = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return sendError(res, 404, 'Product not found.');
  const reviews = await Review.findByProduct(req.params.id);
  return sendSuccess(res, 200, 'Product retrieved.', { product, reviews });
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
  const { name, price, category_id } = req.body;
  if (!name || price === undefined) return sendError(res, 400, 'name and price are required.');
  if (Number(price) <= 0) return sendError(res, 400, 'price must be greater than 0.');

  let resolvedCategoryId;
  try { resolvedCategoryId = await resolveCategoryId(category_id); }
  catch (err) { return sendError(res, err.statusCode || 400, err.message); }

  const productId = await Product.create(null, { ...req.body, category_id: resolvedCategoryId, county: req.body.county || null });
  const product = await Product.findById(productId);
  return sendSuccess(res, 201, 'Product added.', { product });
};

// PUT /api/products/admin/:id  (admin) - edits any product, including
// ones owned by a seller, bypassing the seller-ownership check that the
// regular seller-facing update route enforces.
exports.adminUpdate = async (req, res) => {
  let resolvedCategoryId;
  if (req.body.category_id !== undefined) {
    try { resolvedCategoryId = await resolveCategoryId(req.body.category_id); }
    catch (err) { return sendError(res, err.statusCode || 400, err.message); }
  }
  const updated = await Product.updateAsAdmin(req.params.id, {
    ...req.body,
    ...(resolvedCategoryId !== undefined ? { category_id: resolvedCategoryId } : {})
  });
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
