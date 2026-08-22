// routes/wholesaleQuoteRoutes.js
// Mounted at /api/wholesale-quotes in server.js.

const express = require('express');
const router = express.Router();
const wq = require('../controllers/wholesaleQuoteController');
const { protect, optionalAuth } = require('../middleware/auth');

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

module.exports = router;
