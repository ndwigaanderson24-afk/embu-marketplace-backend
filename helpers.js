// helpers.js
// Shared utilities, including the delivery/subscription pricing logic
// re-implemented server-side to EXACTLY match embu-marketplace.html so
// the frontend and backend never disagree on a price.
const jwt = require('jsonwebtoken');
function sendSuccess(res, statusCode, message, data = null) {
  return res.status(statusCode).json({ success: true, message, data });
}
function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}
function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });
}
// REF-XXXXXX, matching the website's format.
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `REF-${code}`;
}
function generateTrackingNumber() {
  return 'EMB' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
}
function generateOrderNumber() {
  return 'EMB-' + Date.now().toString().slice(-8) + '-' + Math.floor(10 + Math.random() * 90);
}
// ---------- Delivery pricing (must match embu-marketplace.html exactly) ----------
const SAME_COUNTY_BASE_FEE = 100;
const SAME_COUNTY_FREE_THRESHOLD_KG = 20;
const CROSS_COUNTY_MIN_FEE = 200;
const CROSS_COUNTY_FREE_THRESHOLD_KG = 10;
const DELIVERY_PER_TEN_KG_RATE = 50;
const HOME_DELIVERY_PREMIUM_MULTIPLIER = 1.5;
const PLATFORM_DEFAULT_COUNTY = 'embu';
function calculateDeliveryBaseFee(weightKg, originCounty, destCounty) {
  const sameCounty = originCounty === destCounty;
  const threshold = sameCounty ? SAME_COUNTY_FREE_THRESHOLD_KG : CROSS_COUNTY_FREE_THRESHOLD_KG;
  const base = sameCounty ? SAME_COUNTY_BASE_FEE : CROSS_COUNTY_MIN_FEE;
  const extraTens = weightKg > threshold ? Math.ceil((weightKg - threshold) / 10) : 0;
  return base + extraTens * DELIVERY_PER_TEN_KG_RATE;
}
function calculateHomeDeliveryFee(weightKg, originCounty, destCounty) {
  return Math.round(calculateDeliveryBaseFee(weightKg, originCounty, destCounty) * HOME_DELIVERY_PREMIUM_MULTIPLIER);
}
function calculateDeliveryFee(weightKg, originCounty, destCounty, deliveryType) {
  return deliveryType === 'delivery'
    ? calculateHomeDeliveryFee(weightKg, originCounty, destCounty)
    : calculateDeliveryBaseFee(weightKg, originCounty, destCounty);
}
// ---------- Subscription pricing ----------
// Plan-based (not months-based) — matches the live Free / Silver / Gold
// seller plans shown in the app. Each paid plan bills for exactly one
// month at a time; the seller re-subscribes (or we could add
// auto-renewal later) when subscription_end passes.
//
// NOTE: this replaces an older months-keyed sliding-scale table (6-12
// months at KES 150-260) left over from a previous pricing model that
// no longer matches what the app actually shows sellers.
const SUBSCRIPTION_PLANS = {
  silver: { label: 'Silver', amount: 580,  months: 1 },
  gold:   { label: 'Gold',   amount: 1200, months: 1 }
};
function getSubscriptionPrice(planKey) {
  const plan = SUBSCRIPTION_PLANS[planKey];
  return plan ? plan.amount : null;
}
function getSubscriptionMonths(planKey) {
  const plan = SUBSCRIPTION_PLANS[planKey];
  return plan ? plan.months : null;
}
// ---------- Referral commission ----------
const REFERRAL_COMMISSION_RATE = Number(process.env.REFERRAL_COMMISSION_RATE) || 0.10;
const REFERRAL_MIN_ORDER_TOTAL = Number(process.env.REFERRAL_MIN_ORDER_TOTAL) || 10000;
function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
module.exports = {
  sendSuccess, sendError, signToken,
  generateReferralCode, generateTrackingNumber, generateOrderNumber,
  calculateDeliveryBaseFee, calculateHomeDeliveryFee, calculateDeliveryFee,
  PLATFORM_DEFAULT_COUNTY,
  SUBSCRIPTION_PLANS, getSubscriptionPrice, getSubscriptionMonths,
  REFERRAL_COMMISSION_RATE, REFERRAL_MIN_ORDER_TOTAL,
  addMonths, todayStr
};
