// routes/authRoutes.js
// Mounted at /api/auth in server.js

const express = require('express');
const router = express.Router();
const auth = require('../controllers/authController');
const { protect, requireAdmin } = require('../middleware/auth');
const { documentUpload } = require('../middleware/upload');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.post('/register', wrap(auth.register));
router.post('/login', wrap(auth.login));
router.post('/admin-login', wrap(auth.adminLogin));
router.post('/forgot-password', wrap(auth.forgotPassword));
router.post('/reset-password', wrap(auth.resetPassword));
router.post('/reset-password-with-phone', wrap(auth.resetPasswordWithPhone));

// Protected
router.get('/me', protect, wrap(auth.getMe));
router.post('/apply-seller', protect,
  documentUpload.fields([{ name: 'id_photo', maxCount: 1 }, { name: 'business_doc', maxCount: 1 }]),
  wrap(auth.applySeller));
router.get('/seller-status', protect, wrap(auth.getSellerStatus));
router.get('/referrals', protect, wrap(auth.getMyReferrals));
router.post('/subscribe', protect, wrap(auth.subscribe));

// Admin account management - any logged-in admin can view/add/remove others.
router.get('/admins', protect, requireAdmin, wrap(auth.listAdmins));
router.post('/admins', protect, requireAdmin, wrap(auth.createAdmin));
router.delete('/admins/:id', protect, requireAdmin, wrap(auth.deleteAdmin));

router.get('/notifications', protect, wrap(async (req, res) => {
  const Notification = require('../models/notification');
  const { sendSuccess } = require('../helpers');
  const notifications = await Notification.findForUser(req.user.id, { unreadOnly: req.query.unread === 'true' });
  return sendSuccess(res, 200, 'Notifications retrieved.', { notifications });
}));
router.put('/notifications/:id/read', protect, wrap(async (req, res) => {
  const Notification = require('../models/notification');
  const { sendSuccess } = require('../helpers');
  await Notification.markRead(req.params.id, req.user.id);
  return sendSuccess(res, 200, 'Marked as read.');
}));

module.exports = router;
