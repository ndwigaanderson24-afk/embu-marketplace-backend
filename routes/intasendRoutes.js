// routes/intasendRoutes.js
// Mounted at /api/intasend in server.js

const express = require('express');
const router = express.Router();
const intasend = require('../controllers/intasendController');
const { protect } = require('../middleware/auth');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.post('/subscribe', protect, wrap(intasend.initiateSubscriptionPayment));
router.get('/status/:apiRef', protect, wrap(intasend.checkPaymentStatus));

// Public - called only by IntaSend's servers, never by the frontend.
router.post('/webhook', wrap(intasend.webhook));

module.exports = router;
