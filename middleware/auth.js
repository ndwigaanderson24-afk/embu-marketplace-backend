// middleware/auth.js

const jwt = require('jsonwebtoken');
const User = require('../models/user');
const { sendError } = require('../helpers');

// Verifies the JWT and attaches the user row (minus password) to req.user.
// Works for any logged-in user - the seller-specific checks below layer
// on top of this, since a "seller" here is just a user with an approved
// application, not a different account type.
async function protect(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return sendError(res, 401, 'Not authenticated. Please log in.');
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role === 'admin') { req.isAdmin = true; req.admin = decoded; return next(); }
    const user = await User.findById(decoded.id);
    if (!user) return sendError(res, 401, 'Account no longer exists.');
    delete user.password_hash;
    req.user = user;
    next();
  } catch (err) {
    return sendError(res, 401, 'Invalid or expired token.');
  }
}

// Optional auth: attaches req.user if a valid token is present, but never
// blocks the request - used on routes that behave differently for guests
// vs logged-in users (e.g. cart, checkout) without requiring login.
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      const user = await User.findById(decoded.id);
      if (user) { delete user.password_hash; req.user = user; }
    }
  } catch (err) { /* invalid/expired token on an optional route - just proceed as guest */ }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) return sendError(res, 403, 'Admin access only.');
  next();
}

// Use after `protect` on routes that only an approved, currently-active
// seller should reach (adding products, managing orders, etc).
//
// NOTE: this used to require EVERY seller - even Free plan - to have a
// paid, non-expired subscription. That made it impossible for a Free-plan
// seller to ever pass this check, since Free never creates a
// subscription_status/subscription_end at all. Free plan requires no
// payment (see helpers.js SUBSCRIPTION_PLANS - it only lists silver/gold),
// so being an approved seller is enough on its own for that tier. Paid
// tiers (silver/gold) still need an active, non-expired subscription.
function requireActiveSeller(req, res, next) {
  if (!req.user) return sendError(res, 401, 'Not authenticated.');
  const u = req.user;

  if (u.seller_status !== 'approved') {
    return sendError(res, 403, 'Your seller account is not active - check your application and subscription status.');
  }

  const plan = u.seller_plan || 'free';
  if (plan === 'free') return next();

  const notExpired = u.subscription_end && new Date(u.subscription_end) >= new Date();
  if (u.subscription_status !== 'active' || !notExpired) {
    return sendError(res, 403, 'Your seller account is not active - check your application and subscription status.');
  }
  next();
}

// Same protection as requireActiveSeller, but also lets a genuine admin
// session straight through untouched - matches the platform's own rule
// that admin should have free, no-friction access to ShopStream
// (including going live) without ever being blocked by seller-approval
// gates. requireActiveSeller itself is left completely unchanged; this
// only adds an admin bypass in front of it, for the handful of routes
// (starting/ending a broadcast) that admin also needs to reach.
function requireActiveSellerOrAdmin(req, res, next) {
  if (req.isAdmin) return next();
  return requireActiveSeller(req, res, next);
}

module.exports = { protect, optionalAuth, requireAdmin, requireActiveSeller, requireActiveSellerOrAdmin };
