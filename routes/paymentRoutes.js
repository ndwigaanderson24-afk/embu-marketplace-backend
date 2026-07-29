// routes/paymentRoutes.js
// Mounted at /api/payments in server.js

const express = require('express');
const router = express.Router();
const payment = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.post('/mpesa/subscribe', protect, wrap(payment.initiateSubscriptionPayment));
router.get('/mpesa/status/:checkoutRequestId', protect, wrap(payment.checkPaymentStatus));

// Public - called only by Safaricom's servers, never by the frontend.
router.post('/mpesa/callback', wrap(payment.mpesaCallback));

module.exports = router;
