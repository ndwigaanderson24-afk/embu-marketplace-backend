// routes/withdrawalRoutes.js
// Mounted at /api/withdrawals in server.js

const express = require('express');
const router = express.Router();
const withdrawal = require('../controllers/withdrawalController');
const { protect, requireAdmin, requireActiveSeller } = require('../middleware/auth');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.get('/balance', protect, requireActiveSeller, wrap(withdrawal.getBalance));
router.post('/', protect, requireActiveSeller, wrap(withdrawal.request));
router.get('/mine', protect, requireActiveSeller, wrap(withdrawal.getMine));

router.get('/admin/all', protect, requireAdmin, wrap(withdrawal.adminGetAll));
router.put('/admin/:id/status', protect, requireAdmin, wrap(withdrawal.adminUpdateStatus));

module.exports = router;
