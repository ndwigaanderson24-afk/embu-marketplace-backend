// routes/analyticsRoutes.js
// Mounted at /api/analytics in server.js.

const express = require('express');
const router = express.Router();
const analytics = require('../controllers/analyticsController');
const { optionalAuth } = require('../middleware/auth');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.post('/view', optionalAuth, wrap(analytics.trackView));
router.post('/click', optionalAuth, wrap(analytics.trackClick));

module.exports = router;
