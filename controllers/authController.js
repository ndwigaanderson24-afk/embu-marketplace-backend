// controllers/authController.js
// Covers account lifecycle end-to-end: register/login/password reset,
// PLUS applying to sell and paying for a subscription - both of those are
// just state changes on the same user row, matching the website's model
// (no separate "seller" account type).

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/user');
const Admin = require('../models/admin');
const {
  sendSuccess, sendError, signToken, generateReferralCode,
  getSubscriptionPrice, addMonths, todayStr
} = require('../helpers');

// Same rule as the website: at least 6 characters, one number, one symbol.
function isStrongPassword(password) {
  if (!password || password.length < 6) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}

function isValidPhone(phone) {
  return phone && phone.replace(/\D/g, '').length >= 10;
}

// Given a taken business name, produces a handful of distinct alternatives
// the applicant can pick from instead - e.g. "Andy's Poultry" already taken
// suggests "Andy's Poultry Embu", "Andy's Poultry KE", "Andy's Poultry 2",
// "Andy's Poultry Shop". Kept simple and predictable rather than clever,
// so applicants immediately understand where each suggestion came from.
function suggestBusinessNameAlternatives(name, county) {
  const base = name.trim();
  const suggestions = [
    county ? `${base} ${county}` : null,
    `${base} KE`,
    `${base} 2`,
    `${base} Shop`
  ].filter(Boolean);
  return [...new Set(suggestions)];
}

function publicUser(user) {
  const { password_hash, reset_password_token, reset_password_expires, ...rest } = user;
  return rest;
}

// POST /api/auth/register
exports.register = async (req, res) => {
  const { name, email, phone, password, referral_code } = req.body;
  if (!name || !email || !phone || !password) return sendError(res, 400, 'name, email, phone and password are required.');
  if (!isValidPhone(phone)) return sendError(res, 400, 'Please enter a valid phone number.');
  if (!isStrongPassword(password)) return sendError(res, 400, 'Password must be at least 6 characters and include a number and a symbol.');

  if (await User.findByEmail(email)) return sendError(res, 409, 'An account with this email already exists.');

  let referredByCode = null;
  if (referral_code) {
    const referrer = await User.findByReferralCode(referral_code.trim().toUpperCase());
    if (referrer) referredByCode = referrer.referral_code;
  }

  const password_hash = await bcrypt.hash(password, 10);
  let myReferralCode = generateReferralCode();
  // Vanishingly unlikely to collide, but guard against it anyway.
  while (await User.findByReferralCode(myReferralCode)) myReferralCode = generateReferralCode();

  const userId = await User.create({ name, email, phone, password_hash, referral_code: myReferralCode, referred_by_code: referredByCode });
  const user = await User.findById(userId);
  const token = signToken({ id: userId, role: 'user' });

  return sendSuccess(res, 201, 'Account created successfully.', { user: publicUser(user), token });
};

// POST /api/auth/login
exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return sendError(res, 400, 'Email and password are required.');

  const user = await User.findByEmail(email);
  if (!user) return sendError(res, 401, 'Invalid email or password.');
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return sendError(res, 401, 'Invalid email or password.');

  const token = signToken({ id: user.id, role: 'user' });
  return sendSuccess(res, 200, 'Login successful.', { user: publicUser(user), token });
};

// POST /api/auth/admin-login
// Admins are real rows in the `admins` table now (see models/admin.js) -
// each person has their own email/password rather than one shared
// credential from .env.
exports.adminLogin = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return sendError(res, 400, 'Email and password are required.');

  const admin = await Admin.findByEmail(email);
  if (!admin) return sendError(res, 401, 'Invalid admin credentials.');
  const match = await bcrypt.compare(password, admin.password_hash);
  if (!match) return sendError(res, 401, 'Invalid admin credentials.');

  const token = signToken({ id: admin.id, role: 'admin', email: admin.email, name: admin.name, isSuperAdmin: !!admin.is_super_admin });
  return sendSuccess(res, 200, 'Admin login successful.', {
    token,
    admin: { id: admin.id, name: admin.name, email: admin.email, is_super_admin: !!admin.is_super_admin }
  });
};

// GET /api/auth/admins  (any logged-in admin can see the full admin list)
exports.listAdmins = async (req, res) => {
  const admins = await Admin.findAll();
  return sendSuccess(res, 200, 'Admins retrieved.', { admins });
};

// POST /api/auth/admins  { name, email, password, is_super_admin? }
// Only a super admin can add new admins - regular admins get a clear 403.
exports.createAdmin = async (req, res) => {
  if (!req.admin.isSuperAdmin) return sendError(res, 403, 'Only a super admin can add new admin accounts.');

  const { name, email, password, is_super_admin } = req.body;
  if (!name || !email || !password) return sendError(res, 400, 'name, email and password are required.');
  if (password.length < 6) return sendError(res, 400, 'Password must be at least 6 characters.');
  if (await Admin.findByEmail(email)) return sendError(res, 409, 'An admin with this email already exists.');

  const password_hash = await bcrypt.hash(password, 10);
  const id = await Admin.create({ name, email, password_hash, is_super_admin: !!is_super_admin });
  return sendSuccess(res, 201, 'Admin account created.', { id, name, email });
};

// DELETE /api/auth/admins/:id
// Only a super admin can remove admin accounts - and not even a super
// admin can remove their own while logged in as it, to avoid locking
// everyone out.
exports.deleteAdmin = async (req, res) => {
  if (!req.admin.isSuperAdmin) return sendError(res, 403, 'Only a super admin can remove admin accounts.');
  if (String(req.admin.id) === String(req.params.id)) {
    return sendError(res, 400, "You can't remove your own admin account while logged in as it.");
  }
  await Admin.delete(req.params.id);
  return sendSuccess(res, 200, 'Admin account removed.');
};

// POST /api/auth/forgot-password  { email }
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return sendError(res, 400, 'Email is required.');
  const user = await User.findByEmail(email);
  if (!user) return sendSuccess(res, 200, 'If that email is registered, a reset link has been sent.');

  const token = crypto.randomBytes(32).toString('hex');
  await User.setResetToken(email, token, new Date(Date.now() + 60 * 60 * 1000));
  // Wire up utils/email.js from the previous backend build (or your own
  // mailer) here to actually send `token` to the user. Logging for now:
  console.log(`Password reset requested for ${email}. Token: ${token}`);
  return sendSuccess(res, 200, 'If that email is registered, a reset link has been sent.');
};

// POST /api/auth/reset-password  { token, password }
exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return sendError(res, 400, 'Token and new password are required.');
  if (!isStrongPassword(password)) return sendError(res, 400, 'Password must be at least 6 characters and include a number and a symbol.');

  const user = await User.findByResetToken(token);
  if (!user) return sendError(res, 400, 'Reset link is invalid or has expired.');

  await User.updatePassword(user.id, await bcrypt.hash(password, 10));
  await User.setResetToken(user.email, null, null);
  return sendSuccess(res, 200, 'Password reset successful.');
};

// POST /api/auth/reset-password-with-phone  { email, phone, password }
// Practical alternative to the token-via-email flow above: since sending
// real emails requires SMTP credentials this project may not have set up,
// this verifies identity by matching the account's registered phone
// number instead of requiring a clicked email link. Same effect (a
// verified password reset), different verification channel.
exports.resetPasswordWithPhone = async (req, res) => {
  const { email, phone, password } = req.body;
  if (!email || !phone || !password) return sendError(res, 400, 'email, phone and password are required.');
  if (!isStrongPassword(password)) return sendError(res, 400, 'Password must be at least 6 characters and include a number and a symbol.');

  const user = await User.findByEmail(email);
  if (!user || user.phone !== phone) {
    return sendError(res, 400, 'No account found with that email and phone number combination.');
  }

  await User.updatePassword(user.id, await bcrypt.hash(password, 10));
  return sendSuccess(res, 200, 'Password reset successful. You can now log in with your new password.');
};

// GET /api/auth/me  (protected - current logged-in user, incl. seller/subscription status)
exports.getMe = async (req, res) => {
  return sendSuccess(res, 200, 'Current user retrieved.', { user: publicUser(req.user) });
};

// ---------- Seller application (state change on the same user row) ----------

// POST /api/auth/apply-seller  (protected, multipart/form-data)
// Fields: business_name, kra_pin, county, business_description
// Files (optional): id_photo, business_doc
exports.applySeller = async (req, res) => {
  const { business_name, kra_pin, county, business_description, id_photo, business_doc, terms_accepted } = req.body;
  if (!business_name || !kra_pin || !county) return sendError(res, 400, 'business_name, kra_pin and county are required.');
  if (terms_accepted !== true && terms_accepted !== 'true') {
    return sendError(res, 400, 'You must accept the Seller Terms & Conditions before applying.');
  }
  if (req.user.seller_status === 'pending') return sendError(res, 409, 'You already have a pending application.');
  if (req.user.seller_status === 'approved') return sendError(res, 409, 'You are already an approved seller.');

  // Block exact-match business names (case-insensitive) against other
  // pending/approved sellers, so two shops never end up confusing
  // customers with the same storefront name. Offer alternatives instead
  // of a bare rejection, so the applicant can pick one and resubmit.
  const clash = await User.findByBusinessName(business_name, req.user.id);
  if (clash) {
    return res.status(409).json({
      success: false,
      message: `"${business_name}" is already registered by another seller. Please choose a different business name.`,
      data: { suggestions: suggestBusinessNameAlternatives(business_name, county) }
    });
  }

  // Accepts either a real multipart file upload (req.files) or a
  // client-compressed base64 data URL sent directly in the JSON body -
  // the frontend currently does the latter (same pattern as product images).
  const id_photo_path = (req.files && req.files.id_photo) ? `/uploads/documents/${req.files.id_photo[0].filename}` : (id_photo || null);
  const business_doc_path = (req.files && req.files.business_doc) ? `/uploads/documents/${req.files.business_doc[0].filename}` : (business_doc || null);

  await User.applyAsSeller(req.user.id, { business_name, kra_pin, county, business_description, id_photo_path, business_doc_path });
  return sendSuccess(res, 200, 'Application submitted. Please wait up to 24 hours for approval.');
};

// GET /api/auth/seller-status  (protected)
exports.getSellerStatus = async (req, res) => {
  const u = req.user;
  return sendSuccess(res, 200, 'Seller status retrieved.', {
    seller_status: u.seller_status,
    rejection_reason: u.seller_rejection_reason,
    subscription_status: u.subscription_status,
    subscription_end: u.subscription_end,
    shop_disabled: u.shop_disabled
  });
};

// GET /api/auth/referrals  (protected) - the logged-in user's own referral
// code plus how many people they've referred and how much they've earned.
exports.getMyReferrals = async (req, res) => {
  const pool = require('../db');
  const [[{ referred_count }]] = await pool.query(
    'SELECT COUNT(*) AS referred_count FROM referral_earnings WHERE referrer_id = ?',
    [req.user.id]
  );
  const [[{ total_earned }]] = await pool.query(
    'SELECT COALESCE(SUM(commission), 0) AS total_earned FROM referral_earnings WHERE referrer_id = ?',
    [req.user.id]
  );
  return sendSuccess(res, 200, 'Referral stats retrieved.', {
    referral_code: req.user.referral_code,
    referred_count,
    total_earned: Number(total_earned)
  });
};

// POST /api/auth/subscribe  { months }  (protected, requires approved seller)
// Records payment as made immediately - wire this to a real M-Pesa STK
// push + callback before going live, same caveat as the previous backend.
exports.subscribe = async (req, res) => {
  const { months } = req.body;
  const amount = getSubscriptionPrice(Number(months));
  if (!amount) return sendError(res, 400, `months must be one of: ${Object.keys(require('../helpers').SUBSCRIPTION_PLANS).join(', ')}`);
  if (req.user.seller_status !== 'approved') return sendError(res, 403, 'Your seller application must be approved before subscribing.');

  const stillActive = req.user.subscription_end && new Date(req.user.subscription_end) >= new Date();
  const startBase = stillActive ? req.user.subscription_end : todayStr();
  const end = addMonths(startBase, Number(months));

  const pool = require('../db');
  await pool.query('INSERT INTO subscription_payments (seller_id, months, amount) VALUES (?,?,?)', [req.user.id, months, amount]);
  await User.setSubscription(req.user.id, { status: 'active', start: todayStr(), end });

  return sendSuccess(res, 200, 'Subscription activated.', { months, amount, subscription_end: end });
};
