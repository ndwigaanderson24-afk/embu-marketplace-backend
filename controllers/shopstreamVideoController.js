// controllers/shopstreamVideoController.js
const { ShopstreamVideo, ShopstreamVideoComment } = require('../models/shopstreamVideo');
const { sendSuccess, sendError } = require('../helpers');

// Keeps the base64 payload realistic for a database column and Render's
// request size limit - 25MB raw video becomes roughly 34MB once base64
// encoded (~33% overhead), so this cap plus a little headroom matches
// the frontend's 25MB file-size check and the raised server body limit.
const MAX_VIDEO_BASE64_CHARS = 36 * 1024 * 1024;

exports.createVideo = async (req, res) => {
  const { title, caption, category, hashtags, video_data, thumbnail, product_ids, status } = req.body;
  if (!title || !video_data) return sendError(res, 400, 'Title and video are required.');
  if (video_data.length > MAX_VIDEO_BASE64_CHARS) {
    return sendError(res, 400, 'Video is too large. Please keep clips short (under ~20-30 seconds) or compress before uploading.');
  }
  const id = await ShopstreamVideo.create({
    seller_id: req.user.id, title, caption, category, hashtags, video_data, thumbnail,
    product_ids: Array.isArray(product_ids) ? product_ids.join(',') : product_ids,
    status: status === 'draft' ? 'draft' : 'published'
  });
  return sendSuccess(res, 201, 'Video posted.', { id });
};

// Public buyer-facing feed - excludes the actual video bytes (too large
// for a list), the client fetches each video's data separately when it
// scrolls into view.
exports.getPublishedVideos = async (req, res) => {
  const videos = await ShopstreamVideo.findAllPublished();
  return sendSuccess(res, 200, 'Videos retrieved.', { videos });
};

// Returns one video's metadata as JSON (not the raw bytes - see
// getRawVideo below for that). Doesn't count a view itself, since the
// actual video being fetched for playback is the real signal of
// someone watching, not just requesting its details.
exports.getVideoById = async (req, res) => {
  const video = await ShopstreamVideo.findById(req.params.id);
  if (!video) return sendError(res, 404, 'Video not found.');
  return sendSuccess(res, 200, 'Video retrieved.', { video });
};

exports.getMyVideos = async (req, res) => {
  const videos = await ShopstreamVideo.findBySeller(req.user.id);
  return sendSuccess(res, 200, 'Videos retrieved.', { videos });
};

exports.deleteVideo = async (req, res) => {
  const video = await ShopstreamVideo.findById(req.params.id);
  if (!video) return sendError(res, 404, 'Video not found.');
  if (video.seller_id !== req.user.id) return sendError(res, 403, 'Not your video.');
  await ShopstreamVideo.delete(video.id);
  return sendSuccess(res, 200, 'Video deleted.', {});
};

// Lets a seller edit their own video's details, or publish a draft
// (send { status: 'published' }) - the underlying video file itself
// isn't replaceable here, just the metadata around it.
exports.updateVideo = async (req, res) => {
  const video = await ShopstreamVideo.findById(req.params.id);
  if (!video) return sendError(res, 404, 'Video not found.');
  if (video.seller_id !== req.user.id) return sendError(res, 403, 'Not your video.');
  const { title, caption, category, hashtags, product_ids, status } = req.body;
  await ShopstreamVideo.update(video.id, {
    title, caption, category, hashtags,
    product_ids: Array.isArray(product_ids) ? product_ids.join(',') : product_ids,
    status: status === 'draft' || status === 'published' ? status : undefined
  });
  return sendSuccess(res, 200, 'Video updated.', {});
};

exports.likeVideo = async (req, res) => {
  const video = await ShopstreamVideo.findById(req.params.id);
  if (!video) return sendError(res, 404, 'Video not found.');
  const likeCount = await ShopstreamVideo.incrementLike(video.id);
  return sendSuccess(res, 200, 'Liked.', { like_count: likeCount });
};

exports.saveVideo = async (req, res) => {
  const video = await ShopstreamVideo.findById(req.params.id);
  if (!video) return sendError(res, 404, 'Video not found.');
  const saveCount = await ShopstreamVideo.incrementSave(video.id);
  return sendSuccess(res, 200, 'Saved.', { save_count: saveCount });
};

exports.addComment = async (req, res) => {
  const video = await ShopstreamVideo.findById(req.params.id);
  if (!video) return sendError(res, 404, 'Video not found.');
  const comment = (req.body.comment || '').trim().slice(0, 300);
  if (!comment) return sendError(res, 400, 'Comment cannot be empty.');
  const senderName = (req.body.sender_name || (req.user ? req.user.name : 'Guest') || 'Guest').slice(0, 100);
  const id = await ShopstreamVideoComment.create(video.id, senderName, comment);
  return sendSuccess(res, 201, 'Comment added.', { id });
};

exports.getComments = async (req, res) => {
  const comments = await ShopstreamVideoComment.findByVideoId(req.params.id);
  return sendSuccess(res, 200, 'Comments retrieved.', { comments });
};

// A comment isn't tied to a real account (ShopStream allows guest
// comments), so ownership is checked by matching the logged-in user's
// name against the comment's sender_name - the same trust level this
// feature already uses everywhere else (sender_name is client-supplied,
// not cryptographically verified).
exports.deleteComment = async (req, res) => {
  const comment = await ShopstreamVideoComment.findById(req.params.commentId);
  if (!comment) return sendError(res, 404, 'Comment not found.');
  const requesterName = req.user ? req.user.name : null;
  if (!requesterName || comment.sender_name !== requesterName) {
    return sendError(res, 403, 'You can only delete your own comments.');
  }
  await ShopstreamVideoComment.delete(comment.id);
  return sendSuccess(res, 200, 'Comment deleted.', {});
};

exports.adminDeleteComment = async (req, res) => {
  const comment = await ShopstreamVideoComment.findById(req.params.commentId);
  if (!comment) return sendError(res, 404, 'Comment not found.');
  await ShopstreamVideoComment.delete(comment.id);
  return sendSuccess(res, 200, 'Comment deleted.', {});
};

// ── Admin ────────────────────────────────────────────────────────────
exports.adminGetAllVideos = async (req, res) => {
  const videos = await ShopstreamVideo.findAllForAdmin();
  return sendSuccess(res, 200, 'Videos retrieved.', { videos });
};

exports.adminCreateVideo = async (req, res) => {
  const { title, caption, category, hashtags, video_data, thumbnail, product_ids, status } = req.body;
  if (!title || !video_data) return sendError(res, 400, 'Title and video are required.');
  if (video_data.length > MAX_VIDEO_BASE64_CHARS) {
    return sendError(res, 400, 'Video is too large. Please keep clips short (under ~20-30 seconds) or compress before uploading.');
  }
  const id = await ShopstreamVideo.create({
    seller_id: req.admin.id, title, caption, category, hashtags, video_data, thumbnail,
    product_ids: Array.isArray(product_ids) ? product_ids.join(',') : product_ids,
    status: status === 'draft' ? 'draft' : 'published'
  });
  return sendSuccess(res, 201, 'Video posted.', { id });
};

exports.adminDeleteVideo = async (req, res) => {
  const video = await ShopstreamVideo.findById(req.params.id);
  if (!video) return sendError(res, 404, 'Video not found.');
  await ShopstreamVideo.delete(video.id);
  return sendSuccess(res, 200, 'Video deleted.', {});
};

// Serves the actual video bytes directly (not wrapped in JSON), so a
// normal <video src="..."> tag can play it - the list/feed endpoint
// deliberately excludes this data since it's too large for a list
// response, and the JSON single-video endpoint is for detail views
// that need the metadata alongside it.
exports.getRawVideo = async (req, res) => {
  const video = await ShopstreamVideo.findById(req.params.id);
  if (!video || !video.video_data) return res.status(404).end();
  await ShopstreamVideo.incrementView(video.id);
  const base64 = video.video_data.replace(/^data:video\/\w+;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  res.set('Content-Type', 'video/mp4');
  res.set('Cache-Control', 'public, max-age=86400');
  // Every other piece of media in this app is embedded as a base64 data
  // URI, which has no cross-origin restrictions at all - this is the
  // first real cross-origin binary fetch (kenlynk.com loading video from
  // the onrender.com API), and Chrome blocks that by default for <video
  // src> unless the response explicitly opts in with this header.
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(buffer);
};
