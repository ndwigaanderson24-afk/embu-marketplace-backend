// routes/productVariantRoutes.js
// Mounted at /api in server.js

const express  = require('express');
const router   = express.Router();
const vc       = require('../controllers/productVariantController');
const { protect, requireAdmin, requireActiveSeller } = require('../middleware/auth');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ── Public ──────────────────────────────────────────────────────────────
// Buyer-facing: get all variants + attribute matrix for a product
router.get('/products/:id/variants', wrap(vc.getVariants));

// ── Seller ──────────────────────────────────────────────────────────────
// Define attribute dimensions (Colour, Size, RAM …)
router.put('/products/:id/attributes', protect, requireActiveSeller, wrap(vc.setAttributes));
// Add / update / delete individual variants
router.post  ('/products/:id/variants',            protect, requireActiveSeller, wrap(vc.addVariant));
router.put   ('/products/:id/variants/:vid',       protect, requireActiveSeller, wrap(vc.updateVariant));
router.delete('/products/:id/variants/:vid',       protect, requireActiveSeller, wrap(vc.deleteVariant));
router.patch ('/products/:id/variants/:vid/stock', protect, requireActiveSeller, wrap(vc.updateStock));
router.patch ('/products/:id/variants/:vid/price', protect, requireActiveSeller, wrap(vc.updatePrice));

// ── Admin ────────────────────────────────────────────────────────────────
// Inventory overview
router.get('/admin/variants/low-stock',             protect, requireAdmin, wrap(vc.adminLowStock));
// Per-product admin variant management
router.get   ('/admin/products/:id/variants',       protect, requireAdmin, wrap(vc.adminGetProductVariants));
router.put   ('/admin/products/:id/attributes',     protect, requireAdmin, wrap(vc.adminSetAttributes));
router.post  ('/admin/products/:id/variants',       protect, requireAdmin, wrap(vc.adminAddVariant));
// Per-variant admin operations
router.get   ('/admin/variants/:vid',               protect, requireAdmin, wrap(vc.adminGetVariant));
router.put   ('/admin/variants/:vid',               protect, requireAdmin, wrap(vc.adminUpdateVariant));
router.delete('/admin/variants/:vid',               protect, requireAdmin, wrap(vc.adminDeleteVariant));
router.patch ('/admin/variants/:vid/stock',         protect, requireAdmin, wrap(vc.adminUpdateStock));
router.patch ('/admin/variants/:vid/price',         protect, requireAdmin, wrap(vc.adminUpdatePrice));

module.exports = router;
