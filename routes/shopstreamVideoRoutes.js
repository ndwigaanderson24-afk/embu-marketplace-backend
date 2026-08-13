// routes/shopstreamVideoRoutes.js
// Mounted at /api/shopstream/videos (public/seller) and
// /api/admin/shopstream/videos (admin).
const express = require('express');
const router = express.Router();
const vc = require('../controllers/shopstreamVideoController');
const { protect, optionalAuth, requireActiveSeller, requireAdmin } = require('../middleware/auth');
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// Public - anyone can browse, watch, like, save, and comment, without an account.
router.get('/', wrap(vc.getPublishedVideos));

// Seller-only. Registered BEFORE the generic /:id route below, since
// Express matches in registration order and /:id would otherwise
// swallow "mine" as if it were a video id.
router.get('/mine/list', protect, requireActiveSeller, wrap(vc.getMyVideos));
router.post('/', protect, requireActiveSeller, wrap(vc.createVideo));

router.get('/:id', wrap(vc.getVideoById));
router.get('/:id/raw', wrap(vc.getRawVideo));
router.post('/:id/like', wrap(vc.likeVideo));
router.post('/:id/save', wrap(vc.saveVideo));
router.post('/:id/comments', optionalAuth, wrap(vc.addComment));
router.get('/:id/comments', wrap(vc.getComments));
router.delete('/:id', protect, requireActiveSeller, wrap(vc.deleteVideo));
router.put('/:id', protect, requireActiveSeller, wrap(vc.updateVideo));
router.delete('/:id/comments/:commentId', protect, wrap(vc.deleteComment));

// Admin (mounted separately at /api/admin/shopstream/videos).
const adminRouter = express.Router();
adminRouter.use(protect, requireAdmin);
adminRouter.get('/', wrap(vc.adminGetAllVideos));
adminRouter.post('/', wrap(vc.adminCreateVideo));
adminRouter.delete('/:id', wrap(vc.adminDeleteVideo));
adminRouter.delete('/comments/:commentId', wrap(vc.adminDeleteComment));

module.exports = { videoRoutes: router, adminVideoRoutes: adminRouter };
