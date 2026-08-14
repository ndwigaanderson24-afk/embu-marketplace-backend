// controllers/productVariantController.js
// Handles the full Product Variants System for KenLynk:
//   - Seller:  define attributes, add/edit/delete variants, set stock
//   - Admin:   edit any variant, change stock, delete, view inventory
//   - Public:  get variants for product detail page

const Product        = require('../models/product');
const ProductVariant = require('../models/productVariant');
const { sendSuccess, sendError } = require('../helpers');

// Same pricing-privacy rules as products: a buyer never sees seller_price
// or the margin/delivery/risk breakdown for a variant, only its final
// price. A seller sees their own seller_price and the final price, but
// not the granular breakdown - that stays admin-only.
const PRICE_INTERNAL_FIELDS = ['seller_price', 'price_margin', 'price_delivery_allocation', 'price_risk_allocation'];
function stripPricingForBuyer(variant) {
  if (!variant) return variant;
  const clean = { ...variant };
  PRICE_INTERNAL_FIELDS.forEach(f => delete clean[f]);
  return clean;
}
function stripBreakdownForSeller(variant) {
  if (!variant) return variant;
  const clean = { ...variant };
  delete clean.price_margin;
  delete clean.price_delivery_allocation;
  delete clean.price_risk_allocation;
  return clean;
}

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
  return sendSuccess(res, 200, 'Variants retrieved.', { ...data, variants: data.variants.map(stripPricingForBuyer) });
};

// POST /api/products/:id/variants/preview-price  (protected, seller)
// Lets a seller see what a buyer will pay for a variant before saving it
// - runs the exact same calculation upsertVariant uses, against the
// parent product's category/fragile, without writing anything.
exports.previewVariantPrice = async (req, res) => {
  const { seller_price } = req.body;
  if (seller_price === undefined || Number(seller_price) <= 0) {
    return sendError(res, 400, 'seller_price must be greater than 0.');
  }
  if (!(await ownsProduct(req.params.id, req.user.id)))
    return sendError(res, 403, 'Product not found or not yours.');
  const priced = await ProductVariant.previewPrice(seller_price, req.params.id);
  return sendSuccess(res, 200, 'Price calculated.', { seller_price: priced.sellerPrice, price: priced.finalPrice });
};

// ── Seller ───────────────────────────────────────────────────────────────

// PUT /api/products/:id/attributes   body: { attributes: ['Colour','Size'] }
// Replaces the full attribute list for this product and enables has_variants.
exports.setAttributes = async (req, res) => {
  const { attributes } = req.body;
  if (!Array.isArray(attributes) || !attributes.length)
    return sendError(res, 400, 'attributes must be a non-empty array of strings.');

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
// Body: { sku?, seller_price, original_price?, stock, images_json?,
//          options: [{attribute_id, value}] }
exports.addVariant = async (req, res) => {
  const productId = req.params.id;
  if (!(await ownsProduct(productId, req.user.id)))
    return sendError(res, 403, 'Product not found or not yours.');

  const { seller_price, stock } = req.body;
  if (!seller_price || stock === undefined)
    return sendError(res, 400, 'seller_price and stock are required.');

  const variantId = await ProductVariant.upsertVariant(productId, { ...req.body });
  const variant   = await ProductVariant.findVariantById(variantId);
  return sendSuccess(res, 201, 'Variant added.', { variant: stripBreakdownForSeller(variant) });
};

// PUT /api/products/:id/variants/:vid
exports.updateVariant = async (req, res) => {
  const { id: productId, vid } = req.params;
  if (!(await ownsProduct(productId, req.user.id)))
    return sendError(res, 403, 'Product not found or not yours.');

  await ProductVariant.upsertVariant(productId, { ...req.body, id: vid });
  const variant = await ProductVariant.findVariantById(vid);
  return sendSuccess(res, 200, 'Variant updated.', { variant: stripBreakdownForSeller(variant) });
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
  const { seller_price, stock } = req.body;
  if (!seller_price || stock === undefined)
    return sendError(res, 400, 'seller_price and stock are required.');
  const variantId = await ProductVariant.upsertVariant(req.params.id, { ...req.body });
  const variant   = await ProductVariant.findVariantById(variantId);
  return sendSuccess(res, 201, 'Variant added.', { variant });
};
