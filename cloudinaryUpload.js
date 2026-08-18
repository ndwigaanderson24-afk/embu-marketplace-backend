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

module.exports = { uploadBufferToCloudinary };
