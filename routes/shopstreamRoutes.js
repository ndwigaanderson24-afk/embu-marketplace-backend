// routes/shopstreamRoutes.js
const express = require('express');
const router = express.Router();
const sc = require('../controllers/shopstreamController');
const { protect, optionalAuth, requireActiveSeller, requireAdmin } = require('../middleware/auth');
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// Public - anyone can see who's live, and join to watch, without an account.
router.get('/live', wrap(sc.getLiveStreams));
router.post('/:id/join', optionalAuth, wrap(sc.joinLive));

// Seller-only - starting/ending/updating their own broadcast.
router.post('/go-live', protect, requireActiveSeller, wrap(sc.goLive));
router.post('/:id/viewers', protect, requireActiveSeller, wrap(sc.updateViewerCount));
router.post('/:id/end', protect, requireActiveSeller, wrap(sc.endLive));

// Admin-only - moderation.
router.post('/admin/:id/end', protect, requireAdmin, wrap(sc.adminEndLive));

module.exports = router;
