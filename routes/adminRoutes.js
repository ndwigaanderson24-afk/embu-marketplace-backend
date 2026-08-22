// routes/adminRoutes.js
// Mounted at /api/admin in server.js. Every route requires requireAdmin.

const express = require('express');
const router = express.Router();
const admin = require('../controllers/adminController');
const { protect, requireAdmin } = require('../middleware/auth');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.use(protect, requireAdmin);

router.get('/sellers', wrap(admin.getAllSellers));
router.get('/sellers/:id', wrap(admin.getSeller));
router.post('/sellers/:id/approve', wrap(admin.approveSeller));
router.post('/sellers/:id/reject', wrap(admin.rejectSeller));
router.post('/sellers/:id/reset', wrap(admin.resetSeller));
router.post('/sellers/:id/suspend', wrap(admin.suspendSeller));
router.post('/sellers/:id/activate', wrap(admin.activateSeller));

router.get('/sellers-earnings', wrap(admin.getSellerEarningsOverview));
router.get('/referrals', wrap(admin.getReferralOverview));
router.get('/notifications', wrap(admin.getAdminNotifications));
router.get('/featured-requests', wrap(admin.getFeaturedRequests));
router.post('/featured-requests/:id/approve', wrap(admin.approveFeaturedRequest));
router.post('/featured-requests/:id/reject', wrap(admin.rejectFeaturedRequest));
router.get('/featured-live-requests', wrap(admin.getFeaturedLiveRequests));
router.post('/featured-live-requests/:id/approve', wrap(admin.approveFeaturedLiveRequest));
router.post('/featured-live-requests/:id/reject', wrap(admin.rejectFeaturedLiveRequest));

router.get('/pricing/settings', wrap(admin.getPricingSettings));
router.put('/pricing/settings', wrap(admin.updatePricingSettings));
router.get('/pricing/rules', wrap(admin.getPricingRules));
router.post('/pricing/rules', wrap(admin.createPricingRule));
router.put('/pricing/rules/:id', wrap(admin.updatePricingRule));
router.delete('/pricing/rules/:id', wrap(admin.deletePricingRule));
router.post('/pricing/recalculate-all', wrap(admin.recalculateAllPrices));
router.post('/products/migrate-images-to-cloudinary', wrap(admin.migrateImagesToCloudinary));
router.post('/pricing/clear-variant-pricing', wrap(admin.clearVariantPricing));
router.get('/analytics', wrap(admin.getAnalytics));

router.post('/announcements', wrap(admin.sendAnnouncement));
router.get('/logs', wrap(admin.getLogs));

module.exports = router;
