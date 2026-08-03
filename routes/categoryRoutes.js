// routes/categoryRoutes.js
// Mounted at /api in server.js

const express = require('express');
const router  = express.Router();
const cc      = require('../controllers/categoryController');
const { protect, requireAdmin } = require('../middleware/auth');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ── Public ──────────────────────────────────────────────────────────────
router.get('/categories/tree',              wrap(cc.getTree));
router.get('/categories',                   wrap(cc.getFlat));
router.get('/categories/:id/children',      wrap(cc.getChildren));
router.get('/categories/:id/breadcrumb',    wrap(cc.getBreadcrumb));

// ── Admin ────────────────────────────────────────────────────────────────
router.get   ('/admin/categories',          protect, requireAdmin, wrap(cc.adminGetAll));
router.get   ('/admin/categories/tree',     protect, requireAdmin, wrap(cc.adminGetTree));
router.post  ('/admin/categories',          protect, requireAdmin, wrap(cc.adminCreate));
router.put   ('/admin/categories/reorder',  protect, requireAdmin, wrap(cc.adminReorder));
router.put   ('/admin/categories/:id',      protect, requireAdmin, wrap(cc.adminUpdate));
router.delete('/admin/categories/:id',      protect, requireAdmin, wrap(cc.adminDelete));

module.exports = router;
