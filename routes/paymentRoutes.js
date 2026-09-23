// routes/paymentRoutes.js
// Mounted at /api/payments in server.js

const express = require('express');
const router = express.Router();
const payment = require('../controllers/paymentController');
const { protect, optionalAuth } = require('../middleware/auth');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.post('/mpesa/subscribe', protect, wrap(payment.initiateSubscriptionPayment));

// Buyer checkout payment - public/optionalAuth so guests (session_id) can
// pay too, matching how POST /api/orders and /api/intasend/checkout work.
router.post('/mpesa/checkout', optionalAuth, wrap(payment.initiateCheckoutPayment));

// optionalAuth (not protect) so guests can poll their own order payment;
// a subscription payment is still ownership-checked inside the controller.
router.get('/mpesa/status/:checkoutRequestId', optionalAuth, wrap(payment.checkPaymentStatus));

// Public - called only by Safaricom's servers, never by the frontend.
router.post('/mpesa/callback', wrap(payment.mpesaCallback));

module.exports = router;
