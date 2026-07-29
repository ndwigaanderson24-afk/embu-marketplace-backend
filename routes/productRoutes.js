// routes/productRoutes.js
// Mounted at /api/products in server.js. Public GET routes sit alongside
// protected seller routes and admin routes in one file, since the whole
// list was small enough to keep as one router.

const express = require('express');
const router = express.Router();
const product = require('../controllers/productController');
const { protect, optionalAuth, requireAdmin, requireActiveSeller } = require('../middleware/auth');
const { productImageUpload } = require('../middleware/upload');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Public storefront
router.get('/', wrap(product.getPublicList));

// Seller (must come before "/:id" so "/mine" isn't swallowed by the param route)
router.get('/mine', protect, requireActiveSeller, wrap(product.getMine));
router.post('/', protect, requireActiveSeller, productImageUpload.array('images', 8), wrap(product.create));
router.put('/:id', protect, requireActiveSeller, productImageUpload.array('images', 8), wrap(product.update));
router.delete('/:id', protect, requireActiveSeller, wrap(product.remove));

// Reviews (optionalAuth - guests who checked out without an account can still review via order_id)
router.post('/:id/reviews', optionalAuth, wrap(product.addReview));

// Admin
router.get('/admin/all', protect, requireAdmin, wrap(product.adminGetAll));
router.put('/admin/:id/hide', protect, requireAdmin, wrap(product.adminHide));
router.put('/admin/:id/unhide', protect, requireAdmin, wrap(product.adminUnhide));
router.delete('/admin/:id', protect, requireAdmin, wrap(product.adminDelete));

// Public single product (kept last so it doesn't shadow /mine or /admin/*)
router.get('/:id', wrap(product.getOne));

module.exports = router;
