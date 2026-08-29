// routes/wholesaleQuoteRoutes.js
// Mounted at /api/wholesale-quotes in server.js.

const express = require('express');
const router = express.Router();
const wq = require('../controllers/wholesaleQuoteController');
const { protect, optionalAuth, requireAdmin } = require('../middleware/auth');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// A buyer requesting a bulk quote - guests allowed, matching the rest
// of checkout, but if they're logged in we still record who they are.
router.post('/', optionalAuth, wrap(wq.create));

// A seller's own incoming requests - requires login (must come before
// /:id/status so it isn't swallowed by the param route).
router.get('/mine', protect, wrap(wq.getMine));

router.put('/:id/status', protect, wrap(wq.updateStatus));

// Admin equivalents - for quotes on products added directly by admin
// (seller_id IS NULL on those rows, so the seller-facing routes above
// can never surface them). Mounted separately so they don't collide
// with the seller's own /mine and /:id/status paths above.
router.get('/admin/mine', protect, requireAdmin, wrap(wq.adminGetMine));
router.put('/admin/:id/status', protect, requireAdmin, wrap(wq.adminUpdateStatus));

module.exports = router;
