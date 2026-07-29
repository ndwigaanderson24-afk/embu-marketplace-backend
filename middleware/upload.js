// middleware/upload.js
// Two configured multer instances: seller verification documents
// (PDF/JPG/PNG) and product images (JPG/PNG). Caps size at MAX_UPLOAD_MB
// (default 5MB), matching the website's own upload limits.

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const MAX_MB = Number(process.env.MAX_UPLOAD_MB) || 5;

function makeStorage(subfolder) {
  const dir = path.join(__dirname, '..', 'uploads', subfolder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    }
  });
}

function fileFilter(allowedTypes) {
  return (req, file, cb) => {
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: ${allowedTypes.join(', ')}`));
    }
    cb(null, true);
  };
}

const documentUpload = multer({
  storage: makeStorage('documents'),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: fileFilter(['image/jpeg', 'image/png', 'application/pdf'])
});

const productImageUpload = multer({
  storage: makeStorage('products'),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: fileFilter(['image/jpeg', 'image/png'])
});

module.exports = { documentUpload, productImageUpload };
