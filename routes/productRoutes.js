// routes/productRoutes.js
// Mounted at /api/products in server.js. Public GET routes sit alongside
// protected seller routes and admin routes in one file, since the whole
// list was small enough to keep as one router.

const express = require('express');
const router = express.Router();
const product = require('../controllers/productController');
const { protect, optionalAuth, requireAdmin, requireActiveSeller } = require('../middleware/auth');
const { productImageUpload } = require('../middleware/upload');
const multer = require('multer');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// A product video needs its own multer config, separate from the photo
// one - a 5-minute video is far larger than any product photo, and this
// only ever needs a single file field ("video"), not an array like
// images does.
const productVideoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 }, // 150MB - generous headroom for 5 minutes of real video
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) return cb(new Error('Only video files are allowed.'));
    cb(null, true);
  }
});

// Public storefront
router.get('/', wrap(product.getPublicList));
router.get('/wholesale', wrap(product.getWholesale));
router.get('/kanyaga', wrap(product.getKanyaga));

// Product video upload - shared by both the seller and admin Add
// Product forms, protected to any logged-in user (seller or admin);
// there's no product to check ownership against yet at this point,
// since the video is uploaded before the product it'll attach to even
// exists.
router.post('/upload-video', protect, productVideoUpload.single('video'), wrap(product.uploadVideo));

// Admin uses a separate adminToken, not the regular user session
// `protect` checks - mirrors the same seller-route/admin-route split
// already used elsewhere (e.g. wholesale quotes) rather than assuming
// one middleware covers both.
router.post('/admin/upload-video', protect, requireAdmin, productVideoUpload.single('video'), wrap(product.uploadVideo));

// Seller (must come before "/:id" so "/mine" isn't swallowed by the param route)
router.get('/mine', protect, requireActiveSeller, wrap(product.getMine));
router.post('/preview-price', protect, requireActiveSeller, wrap(product.previewPrice));
router.post('/', protect, requireActiveSeller, productImageUpload.array('images', 8), wrap(product.create));
router.put('/:id', protect, requireActiveSeller, productImageUpload.array('images', 8), wrap(product.update));
router.delete('/:id', protect, requireActiveSeller, wrap(product.remove));

// Reviews (optionalAuth - guests who checked out without an account can still review via order_id)
router.post('/:id/reviews', optionalAuth, wrap(product.addReview));

// Admin
router.post('/admin', protect, requireAdmin, wrap(product.adminCreate));
router.post('/admin/preview-price', protect, requireAdmin, wrap(product.previewPrice));
router.get('/admin/all', protect, requireAdmin, wrap(product.adminGetAll));
router.put('/admin/:id', protect, requireAdmin, wrap(product.adminUpdate));
router.put('/admin/:id/hide', protect, requireAdmin, wrap(product.adminHide));
router.put('/admin/:id/unhide', protect, requireAdmin, wrap(product.adminUnhide));
router.delete('/admin/:id', protect, requireAdmin, wrap(product.adminDelete));

// Public single product (kept last so it doesn't shadow /mine or /admin/*)
router.get('/:id', wrap(product.getOne));

module.exports = router;
