// controllers/productVariantController.js
// Handles the full Product Variants System for KenLynk:
//   - Seller:  define attributes, add/edit/delete variants, set stock
//   - Admin:   edit any variant, change stock, delete, view inventory
//   - Public:  get variants for product detail page
//
// Variants have no price of their own - every variant uses its parent
// product's price. This was removed deliberately (previously each
// variant had its own seller_price, computed independently through the
// pricing engine) because having a product-level price AND a separate
// per-variant price was confusing sellers about which one to fill in.

const Product        = require('../models/product');
const ProductVariant = require('../models/productVariant');
const { sendSuccess, sendError } = require('../helpers');

// ── Helpers ─────────────────────────────────────────────────────────────

async function ownsProduct(productId, userId) {
  const p = await Product.findById(productId);
  return p && String(p.seller_id) === String(userId);
}

// ── Public ───────────────────────────────────────────────────────────────

// GET /api/products/:id/variants
exports.getVariants = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return sendError(res, 404, 'Product not found.');
  const data = await ProductVariant.getProductWithVariants(req.params.id);
  return sendSuccess(res, 200, 'Variants retrieved.', data);
};

// ── Seller ───────────────────────────────────────────────────────────────

// PUT /api/products/:id/attributes
// body: { attributes: ['Colour','Size'] } (plain strings, all default to
// single-select) or { attributes: [{name:'Colour',selection_type:'single'},
// {name:'Size',selection_type:'multiple'}] } for mixed selection types.
// Replaces the full attribute list for this product and enables has_variants.
exports.setAttributes = async (req, res) => {
  const { attributes } = req.body;
  if (!Array.isArray(attributes) || !attributes.length)
    return sendError(res, 400, 'attributes must be a non-empty array.');

  const productId = req.params.id;
  if (!(await ownsProduct(productId, req.user.id)))
    return sendError(res, 403, 'Product not found or not yours.');

  await ProductVariant.setAttributes(productId, attributes);

  // Mark the product as variant-based
  await Product.updateAsAdmin(productId, { has_variants: 1 });

  const saved = await ProductVariant.getAttributes(productId);
  return sendSuccess(res, 200, 'Attributes saved.', { attributes: saved });
};

// POST /api/products/:id/variants
// Body: { sku?, stock, seller_price?, original_price?, images_json?, options: [{attribute_id, value}] }
exports.addVariant = async (req, res) => {
  const productId = req.params.id;
  if (!(await ownsProduct(productId, req.user.id)))
    return sendError(res, 403, 'Product not found or not yours.');

  if (req.body.stock === undefined)
    return sendError(res, 400, 'stock is required.');
  if (req.body.seller_price !== undefined && req.body.seller_price !== null && req.body.seller_price !== '' && Number(req.body.seller_price) <= 0)
    return sendError(res, 400, 'seller_price must be greater than 0.');

  const variantId = await ProductVariant.upsertVariant(productId, { ...req.body });
  const variant   = await ProductVariant.findVariantById(variantId);
  return sendSuccess(res, 201, 'Variant added.', { variant });
};

// PUT /api/products/:id/variants/:vid
exports.updateVariant = async (req, res) => {
  const { id: productId, vid } = req.params;
  if (!(await ownsProduct(productId, req.user.id)))
    return sendError(res, 403, 'Product not found or not yours.');
  if (req.body.seller_price !== undefined && req.body.seller_price !== null && req.body.seller_price !== '' && Number(req.body.seller_price) <= 0)
    return sendError(res, 400, 'seller_price must be greater than 0.');

  await ProductVariant.upsertVariant(productId, { ...req.body, id: vid });
  const variant = await ProductVariant.findVariantById(vid);
  return sendSuccess(res, 200, 'Variant updated.', { variant });
};

// DELETE /api/products/:id/variants/:vid
exports.deleteVariant = async (req, res) => {
  const { id: productId, vid } = req.params;
  if (!(await ownsProduct(productId, req.user.id)))
    return sendError(res, 403, 'Product not found or not yours.');

  const deleted = await ProductVariant.deleteVariant(vid, productId);
  if (!deleted) return sendError(res, 404, 'Variant not found.');
  return sendSuccess(res, 200, 'Variant deleted.');
};

// PATCH /api/products/:id/variants/:vid/stock  body: { stock }
exports.updateStock = async (req, res) => {
  const { id: productId, vid } = req.params;
  if (!(await ownsProduct(productId, req.user.id)))
    return sendError(res, 403, 'Product not found or not yours.');

  const stock = parseInt(req.body.stock, 10);
  if (isNaN(stock) || stock < 0) return sendError(res, 400, 'stock must be a non-negative integer.');
  await ProductVariant.updateStock(vid, stock);
  return sendSuccess(res, 200, 'Stock updated.', { stock });
};

// PATCH /api/products/:id/variants/:vid/price  body: { seller_price?, original_price? }
// Deliberately separate from updateVariant (PUT), which replaces the
// variant's full option set from the request body - this only ever
// touches price columns, so it can't accidentally wipe out a variant's
// Colour/Size options.
exports.updatePrice = async (req, res) => {
  const { id: productId, vid } = req.params;
  if (!(await ownsProduct(productId, req.user.id)))
    return sendError(res, 403, 'Product not found or not yours.');

  const { seller_price, original_price } = req.body;
  if (seller_price !== undefined && seller_price !== null && seller_price !== '' && Number(seller_price) <= 0)
    return sendError(res, 400, 'seller_price must be greater than 0.');
  await ProductVariant.updatePrice(vid, productId, seller_price, original_price);
  const variant = await ProductVariant.findVariantById(vid);
  return sendSuccess(res, 200, 'Price updated.', { variant });
};

// ── Admin ────────────────────────────────────────────────────────────────

// GET /api/admin/variants/:vid
exports.adminGetVariant = async (req, res) => {
  const variant = await ProductVariant.findVariantById(req.params.vid);
  if (!variant) return sendError(res, 404, 'Variant not found.');
  return sendSuccess(res, 200, 'Variant retrieved.', { variant });
};

// PUT /api/admin/variants/:vid
exports.adminUpdateVariant = async (req, res) => {
  const variant = await ProductVariant.findVariantById(req.params.vid);
  if (!variant) return sendError(res, 404, 'Variant not found.');
  if (req.body.seller_price !== undefined && req.body.seller_price !== null && req.body.seller_price !== '' && Number(req.body.seller_price) <= 0)
    return sendError(res, 400, 'seller_price must be greater than 0.');
  await ProductVariant.upsertVariant(variant.product_id, { ...req.body, id: req.params.vid });
  const updated = await ProductVariant.findVariantById(req.params.vid);
  return sendSuccess(res, 200, 'Variant updated.', { variant: updated });
};

// DELETE /api/admin/variants/:vid
exports.adminDeleteVariant = async (req, res) => {
  const deleted = await ProductVariant.deleteVariantAsAdmin(req.params.vid);
  if (!deleted) return sendError(res, 404, 'Variant not found.');
  return sendSuccess(res, 200, 'Variant deleted.');
};

// PATCH /api/admin/variants/:vid/stock  body: { stock }
exports.adminUpdateStock = async (req, res) => {
  const stock = parseInt(req.body.stock, 10);
  if (isNaN(stock) || stock < 0) return sendError(res, 400, 'stock must be a non-negative integer.');
  const variant = await ProductVariant.findVariantById(req.params.vid);
  if (!variant) return sendError(res, 404, 'Variant not found.');
  await ProductVariant.updateStock(req.params.vid, stock);
  return sendSuccess(res, 200, 'Stock updated.', { stock });
};

// PATCH /api/admin/variants/:vid/price  body: { seller_price?, original_price? }
exports.adminUpdatePrice = async (req, res) => {
  const variant = await ProductVariant.findVariantById(req.params.vid);
  if (!variant) return sendError(res, 404, 'Variant not found.');
  const { seller_price, original_price } = req.body;
  if (seller_price !== undefined && seller_price !== null && seller_price !== '' && Number(seller_price) <= 0)
    return sendError(res, 400, 'seller_price must be greater than 0.');
  await ProductVariant.updatePrice(req.params.vid, variant.product_id, seller_price, original_price);
  const updated = await ProductVariant.findVariantById(req.params.vid);
  return sendSuccess(res, 200, 'Price updated.', { variant: updated });
};

// GET /api/admin/variants/low-stock?threshold=5
exports.adminLowStock = async (req, res) => {
  const threshold = parseInt(req.query.threshold, 10) || 5;
  const variants = await ProductVariant.getLowStockVariants(threshold);
  return sendSuccess(res, 200, 'Low-stock variants retrieved.', { variants });
};

// GET /api/admin/products/:id/variants
exports.adminGetProductVariants = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return sendError(res, 404, 'Product not found.');
  const data = await ProductVariant.getProductWithVariants(req.params.id);
  return sendSuccess(res, 200, 'Variants retrieved.', data);
};

// PUT /api/admin/products/:id/attributes
exports.adminSetAttributes = async (req, res) => {
  const { attributes } = req.body;
  if (!Array.isArray(attributes) || !attributes.length)
    return sendError(res, 400, 'attributes must be a non-empty array of strings.');
  await ProductVariant.setAttributes(req.params.id, attributes);
  await Product.updateAsAdmin(req.params.id, { has_variants: 1 });
  const saved = await ProductVariant.getAttributes(req.params.id);
  return sendSuccess(res, 200, 'Attributes saved.', { attributes: saved });
};

// POST /api/admin/products/:id/variants
exports.adminAddVariant = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return sendError(res, 404, 'Product not found.');
  if (req.body.stock === undefined)
    return sendError(res, 400, 'stock is required.');
  if (req.body.seller_price !== undefined && req.body.seller_price !== null && req.body.seller_price !== '' && Number(req.body.seller_price) <= 0)
    return sendError(res, 400, 'seller_price must be greater than 0.');
  const variantId = await ProductVariant.upsertVariant(req.params.id, { ...req.body });
  const variant   = await ProductVariant.findVariantById(variantId);
  return sendSuccess(res, 201, 'Variant added.', { variant });
};
