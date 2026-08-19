// cloudinaryUpload.js
// Product images (and documents) used to be saved straight onto
// Render's own disk, then served from there - every single view of a
// product photo counted against Render's bandwidth quota. This moves
// that storage to Cloudinary instead: Render only ever holds the file
// in memory for the split second it takes to forward it to Cloudinary,
// then the actual image lives there and gets served from Cloudinary's
// own bandwidth from that point on.
//
// Requires three environment variables already set in Render:
// CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Uploads a single in-memory file (from multer's memoryStorage - see
// upload.js) to Cloudinary and returns its public URL. `folder` keeps
// KenLynk's uploads organized inside Cloudinary's own media library
// (e.g. 'kenlynk/products', 'kenlynk/documents') rather than dumping
// everything in one place.
function uploadBufferToCloudinary(fileBuffer, folder, resourceType = 'image') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (err, result) => {
        if (err) return reject(err);
        resolve(result.secure_url);
      }
    );
    stream.end(fileBuffer);
  });
}

// The Admin "Add Product" form sends a photo as a base64 data URL
// embedded directly in the JSON body (e.g. "data:image/jpeg;base64,...")
// rather than as a multipart file - that's a separate code path from
// the seller form's upload.js/multer flow above, and was still storing
// that giant base64 string straight into the products table, never
// touching Cloudinary at all. Cloudinary's own upload() accepts a data
// URL directly as the source, so this needs no multer/buffer step -
// just hand the string straight to Cloudinary and store the real URL
// it returns instead.
async function uploadBase64ToCloudinary(dataUrl, folder) {
  const result = await cloudinary.uploader.upload(dataUrl, { folder });
  return result.secure_url;
}

// True only for an actual base64 data URL - an already-external image
// URL (http/https, e.g. a seller who pasted a link) should pass through
// untouched rather than being re-uploaded.
function isBase64DataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image');
}

// For the one-time migration of existing products: Cloudinary's upload()
// happily accepts either a base64 data URL OR a plain http(s) URL as its
// source - meaning an old image still sitting on Render's own disk
// (e.g. "https://embu-marketplace-backend.onrender.com/uploads/products/xyz.jpg")
// can be handed to Cloudinary directly, no need to download it into
// memory first. Used for both cases so the migration doesn't need to
// tell them apart itself.
async function uploadAnyToCloudinary(source, folder) {
  const result = await cloudinary.uploader.upload(source, { folder });
  return result.secure_url;
}

// True for anything that's neither already a Cloudinary URL nor empty -
// i.e. still needs migrating (raw base64, or an old Render /uploads/ path).
function needsMigration(value) {
  if (!value || typeof value !== 'string') return false;
  return !value.includes('res.cloudinary.com');
}

module.exports = { uploadBufferToCloudinary, uploadBase64ToCloudinary, uploadAnyToCloudinary, isBase64DataUrl, needsMigration };
