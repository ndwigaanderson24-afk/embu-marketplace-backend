// routes/productRequestRoutes.js
// Mounted at /api/requests (buyer/seller) and /api/admin/requests (admin).
const express = require('express');
const router = express.Router();
const rc = require('../controllers/productRequestController');
const { protect, optionalAuth, requireActiveSeller, requireAdmin } = require('../middleware/auth');
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// Buyer + seller (public routes, mounted at /api/requests)
router.post('/', optionalAuth, wrap(rc.createRequest));
router.get('/mine', optionalAuth, wrap(rc.getMyRequests));
router.get('/shared', protect, requireActiveSeller, wrap(rc.getSharedRequests));
router.post('/:id/offers', protect, requireActiveSeller, wrap(rc.submitOffer));
router.post('/:id/decline', optionalAuth, wrap(rc.declineOffer));

// Admin (mounted at /api/admin/requests)
const adminRouter = express.Router();
adminRouter.use(protect, requireAdmin);
adminRouter.get('/', wrap(rc.adminGetAllRequests));
adminRouter.post('/:id/share', wrap(rc.adminShareWithSellers));
adminRouter.post('/:id/offers/:offerId/approve', wrap(rc.adminApproveOffer));
adminRouter.post('/:id/offers/:offerId/reject', wrap(rc.adminRejectOffer));
adminRouter.post('/:id/cancel', wrap(rc.adminCancelRequest));

module.exports = { requestRoutes: router, adminRequestRoutes: adminRouter };
