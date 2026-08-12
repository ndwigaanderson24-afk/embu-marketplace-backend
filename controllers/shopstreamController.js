// controllers/shopstreamController.js
// Handles going live for real: generates a unique channel + a secure
// Agora token so the seller's camera/mic actually get broadcast out to
// anyone watching, instead of just previewing locally on their own
// screen. Also the single source of truth for "who's live right now",
// read the same way by admin, buyers, and the seller themselves.

const { RtcTokenBuilder, RtcRole } = require('agora-token');
const LiveStream = require('../models/liveStream');
const Product = require('../models/product');
const { sendSuccess, sendError } = require('../helpers');

const APP_ID = process.env.AGORA_APP_ID;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;
const TOKEN_EXPIRY_SECONDS = 4 * 60 * 60; // 4 hours - generous for a single live session

function buildToken(channelName, uid, role) {
  if (!APP_ID || !APP_CERTIFICATE) {
    throw new Error('Live streaming is not configured on the server yet.');
  }
  return RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channelName, uid, role, TOKEN_EXPIRY_SECONDS, TOKEN_EXPIRY_SECONDS);
}

// Seller starts broadcasting for real - creates the live_streams row,
// closes out any stream they left open from a previous session, and
// hands back a genuine broadcaster token so their video actually goes
// out over Agora's network instead of just showing locally.
exports.goLive = async (req, res) => {
  const sellerId = req.user.id;
  const { product_id, title } = req.body;

  if (product_id) {
    const product = await Product.findById(product_id);
    if (!product || product.seller_id !== sellerId) {
      return sendError(res, 403, 'That product is not yours.');
    }
  }

  // A stray "still live" row from a closed tab or lost connection would
  // otherwise make this seller appear live twice, or block a fresh
  // channel name collision - clean that up first.
  await LiveStream.endAllForSeller(sellerId);

  const channelName = `seller_${sellerId}_${Date.now()}`;
  const streamId = await LiveStream.create({ sellerId, productId: product_id || null, channelName, title });

  let token;
  try {
    token = buildToken(channelName, sellerId, RtcRole.PUBLISHER);
  } catch (err) {
    await LiveStream.end(streamId);
    return sendError(res, 500, err.message);
  }

  return sendSuccess(res, 201, 'You are now live.', {
    stream_id: streamId,
    channel_name: channelName,
    app_id: APP_ID,
    token,
    uid: sellerId
  });
};

// Buyer (or anyone) joining to watch - gets an audience-role token for
// that specific stream's channel. Audience role means they can watch
// and listen but never accidentally start broadcasting themselves.
exports.joinLive = async (req, res) => {
  const stream = await LiveStream.findById(req.params.id);
  if (!stream || stream.status !== 'live') {
    return sendError(res, 404, 'This stream is not live right now.');
  }

  // Viewers don't need accounts to watch - give guests a random uid so
  // Agora can tell simultaneous viewers apart from each other.
  const uid = req.user ? req.user.id : Math.floor(100000 + Math.random() * 900000);

  let token;
  try {
    token = buildToken(stream.channel_name, uid, RtcRole.SUBSCRIBER);
  } catch (err) {
    return sendError(res, 500, err.message);
  }

  return sendSuccess(res, 200, 'Joined stream.', {
    stream_id: stream.id,
    channel_name: stream.channel_name,
    app_id: APP_ID,
    token,
    uid,
    seller_business_name: stream.seller_business_name,
    title: stream.title
  });
};

// Every currently-live stream - this is what admin, and a buyer-facing
// "browse live sellers" page, both read from. Same data, same source,
// regardless of who's asking or which device they're on.
exports.getLiveStreams = async (req, res) => {
  const streams = await LiveStream.findAllLive();
  return sendSuccess(res, 200, 'Live streams retrieved.', { streams });
};

// The seller's own broadcasting page calls this every ~15s with the
// real count Agora's SDK reports (client.remoteUsers.length) - this is
// what lets admin's dashboard show an accurate, current number instead
// of a locally-simulated one that only the seller could ever see.
exports.updateViewerCount = async (req, res) => {
  const stream = await LiveStream.findById(req.params.id);
  if (!stream || stream.seller_id !== req.user.id) {
    return sendError(res, 403, 'Not your stream.');
  }
  const count = Math.max(0, parseInt(req.body.count, 10) || 0);
  await LiveStream.updateViewerCount(stream.id, count);
  return sendSuccess(res, 200, 'Viewer count updated.', {});
};

exports.endLive = async (req, res) => {
  const stream = await LiveStream.findById(req.params.id);
  if (!stream || stream.seller_id !== req.user.id) {
    return sendError(res, 403, 'Not your stream.');
  }
  await LiveStream.end(stream.id);
  return sendSuccess(res, 200, 'Stream ended.', {});
};

// Admin-only: force-end any seller's stream regardless of ownership -
// for moderation, e.g. shutting down an inappropriate broadcast.
exports.adminEndLive = async (req, res) => {
  const stream = await LiveStream.findById(req.params.id);
  if (!stream) return sendError(res, 404, 'Stream not found.');
  await LiveStream.end(stream.id);
  return sendSuccess(res, 200, 'Stream ended by admin.', {});
};
