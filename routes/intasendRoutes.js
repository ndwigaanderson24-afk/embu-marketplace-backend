// routes/intasendRoutes.js
// Mounted at /api/intasend in server.js

const express = require('express');
const router = express.Router();
const intasend = require('../controllers/intasendController');
const { protect, optionalAuth } = require('../middleware/auth');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.post('/subscribe', protect, wrap(intasend.initiateSubscriptionPayment));

router.post('/feature-product', protect, wrap(intasend.initiateFeatureProductPayment));

// Buyer checkout payment - public/optionalAuth so guests (session_id) can
// pay too, matching how POST /api/orders itself works.
router.post('/checkout', optionalAuth, wrap(intasend.initiateCheckoutPayment));

// optionalAuth (not protect) so guests can poll their own order payment;
// logged-in-only payments (subscriptions) are still ownership-checked
// inside the controller.
router.get('/status/:apiRef', optionalAuth, wrap(intasend.checkPaymentStatus));

// Public - called only by IntaSend's servers, never by the frontend.
router.post('/webhook', wrap(intasend.webhook));

module.exports = router;
