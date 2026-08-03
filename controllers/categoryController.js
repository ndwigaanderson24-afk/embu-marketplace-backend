// controllers/categoryController.js

const Category = require('../models/category');
const { sendSuccess, sendError } = require('../helpers');

// ── Public ───────────────────────────────────────────────────────────────

// GET /api/categories/tree
// Full nested tree — used by buyer sidebar and shop filter
exports.getTree = async (req, res) => {
  const tree = await Category.getTree({ activeOnly: true });
  return sendSuccess(res, 200, 'Category tree retrieved.', { categories: tree });
};

// GET /api/categories
// Flat list — used by seller & admin dropdowns
exports.getFlat = async (req, res) => {
  const activeOnly = req.query.active !== 'false';
  const categories = await Category.findAll({ activeOnly });
  return sendSuccess(res, 200, 'Categories retrieved.', { categories });
};

// GET /api/categories/:id/children
// Direct children of a category — used for step-by-step seller picker
exports.getChildren = async (req, res) => {
  const parentId = req.params.id === 'root' ? null : Number(req.params.id);
  const children = await Category.findChildren(parentId, { activeOnly: true });
  return sendSuccess(res, 200, 'Children retrieved.', { categories: children });
};

// GET /api/categories/:id/breadcrumb
exports.getBreadcrumb = async (req, res) => {
  const cat = await Category.findById(req.params.id);
  if (!cat) return sendError(res, 404, 'Category not found.');
  const breadcrumb = await Category.breadcrumb(req.params.id);
  return sendSuccess(res, 200, 'Breadcrumb retrieved.', { breadcrumb });
};

// ── Admin ────────────────────────────────────────────────────────────────

// GET /api/admin/categories  (full flat list including inactive)
exports.adminGetAll = async (req, res) => {
  const categories = await Category.findAll({ activeOnly: false });
  return sendSuccess(res, 200, 'Categories retrieved.', { categories });
};

// GET /api/admin/categories/tree  (full tree including inactive)
exports.adminGetTree = async (req, res) => {
  const tree = await Category.getTree({ activeOnly: false });
  return sendSuccess(res, 200, 'Category tree retrieved.', { categories: tree });
};

// POST /api/admin/categories
exports.adminCreate = async (req, res) => {
  const { name, parent_id, description, icon, image_url, position } = req.body;
  if (!name || !name.trim()) return sendError(res, 400, 'name is required.');

  const id = await Category.create({ name: name.trim(), parent_id, description, icon, image_url, position });
  const category = await Category.findById(id);
  return sendSuccess(res, 201, 'Category created.', { category });
};

// PUT /api/admin/categories/:id
exports.adminUpdate = async (req, res) => {
  const cat = await Category.findById(req.params.id);
  if (!cat) return sendError(res, 404, 'Category not found.');

  // Prevent setting parent to itself or a descendant (would create a loop)
  if (req.body.parent_id) {
    if (Number(req.body.parent_id) === Number(req.params.id))
      return sendError(res, 400, 'A category cannot be its own parent.');
  }

  await Category.update(req.params.id, req.body);
  const updated = await Category.findById(req.params.id);
  return sendSuccess(res, 200, 'Category updated.', { category: updated });
};

// DELETE /api/admin/categories/:id
exports.adminDelete = async (req, res) => {
  const cat = await Category.findById(req.params.id);
  if (!cat) return sendError(res, 404, 'Category not found.');

  const count = await Category.productCount(req.params.id);
  if (count > 0 && req.query.force !== 'true') {
    return sendError(res, 409,
      `This category has ${count} product(s). Pass ?force=true to delete anyway (products will be unlinked).`
    );
  }

  await Category.delete(req.params.id);
  return sendSuccess(res, 200, 'Category deleted.');
};

// PUT /api/admin/categories/reorder
// body: { items: [{id, position}] }
exports.adminReorder = async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length)
    return sendError(res, 400, 'items must be a non-empty array of {id, position}.');
  await Category.reorder(items);
  return sendSuccess(res, 200, 'Order saved.');
};
