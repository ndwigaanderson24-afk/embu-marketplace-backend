// routes/orderHistoryRoutes.js
// One endpoint, kept in its own tiny route file rather than edited into
// whatever your existing order routes file is called, so it drops in
// with a single line in server.js regardless of that file's name or
// structure.
//
// Mount in server.js alongside your other route registrations:
//   app.use('/api/orders', require('./routes/orderHistoryRoutes'));
//
// Express allows multiple router files to share the same base path as
// long as their own sub-paths don't collide - this only ever handles
// GET /api/orders/:id/history, so it can't conflict with whatever your
// existing order routes already handle.

const express = require('express');
const router = express.Router();
const orderHistory = require('../controllers/orderHistoryController');
const { protect } = require('../middleware/auth');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.get('/:id/history', protect, wrap(orderHistory.getHistory));

module.exports = router;
