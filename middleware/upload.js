// middleware/upload.js
// Two configured multer instances: seller verification documents
// (PDF/JPG/PNG) and product images (JPG/PNG). Caps size at MAX_UPLOAD_MB
// (default 5MB), matching the website's own upload limits.
//
// Uses memoryStorage rather than the old diskStorage - files are no
// longer saved onto Render's own disk at all. Instead req.files[x].buffer
// holds the raw file in memory just long enough for the controller to
// hand it to Cloudinary (see cloudinaryUpload.js), which is what
// actually stores and serves it from here on. This is what stops every
// product photo view from eating into Render's bandwidth quota.

const multer = require('multer');

const MAX_MB = Number(process.env.MAX_UPLOAD_MB) || 5;

const storage = multer.memoryStorage();

function fileFilter(allowedTypes) {
  return (req, file, cb) => {
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: ${allowedTypes.join(', ')}`));
    }
    cb(null, true);
  };
}

const documentUpload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: fileFilter(['image/jpeg', 'image/png', 'application/pdf'])
});

const productImageUpload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: fileFilter(['image/jpeg', 'image/png'])
});

module.exports = { documentUpload, productImageUpload };
