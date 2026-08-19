// routes/sellerRoutes.js
// Mounted at /api/sellers in server.js.

const express = require('express');
const router = express.Router();
const seller = require('../controllers/sellerController');
const { protect, optionalAuth } = require('../middleware/auth');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Public - anyone viewing a seller's shop page can see their profile card.
router.get('/:email/profile', optionalAuth, wrap(seller.getProfile));

// Requires login - only a real account can follow a shop.
router.post('/:email/follow', protect, wrap(seller.followSeller));
router.delete('/:email/follow', protect, wrap(seller.unfollowSeller));

// Requires login - a seller's own analytics are private to them.
router.get('/:email/analytics', protect, wrap(seller.getSellerAnalytics));

module.exports = router;
