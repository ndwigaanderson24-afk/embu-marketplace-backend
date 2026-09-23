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
// ---------- Seller plan product limits ----------
// How many products a seller can have listed at once, keyed by their
// EFFECTIVE plan - "effective" meaning a paid plan only counts while
// subscription_status is genuinely 'active' and subscription_end
// hasn't passed; a seller whose Silver/Gold subscription lapsed is
// treated as free again for this check, same as the visibility rule
// already used elsewhere (findPublic etc.) so the two can never
// disagree about what plan a seller is actually on right now.
const SELLER_PLAN_PRODUCT_LIMITS = { free: 20, silver: 100, gold: Infinity };
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
// ---------- All-inclusive pricing engine ----------
// Turns a seller's asking price into the final, all-inclusive price the
// buyer sees - margin, delivery allocation, and (if fragile) a risk
// allocation are all baked in here, never shown as separate line items
// anywhere downstream. This is the single source of truth: product
// creation and order creation both call this, so the number can never
// drift between what a buyer was shown and what actually gets charged.
//
// `rules` is the full active pricing_rules list (admin-configurable);
// `settings` is the single pricing_settings row (defaults + fragile
// surcharge). Both are passed in rather than fetched here, so this
// stays a pure, easily-testable function.
// ══════════════════════════════════════════════════════════════════
// PRICING MODEL — replaces the old rules-based engine (per-category
// margin/delivery-allocation/risk-allocation/commission-%, configurable
// via the old Pricing Engine admin panel) with fixed commission and
// delivery-fee brackets. This is now the ONLY pricing calculation used
// anywhere on KenLynk - the old pricing_rules/pricing_settings tables
// are no longer read by this function at all.
//
// Final Customer Price = Product Price + Commission + Delivery Fee
//
// Commission is a flat KES amount looked up from the product's own
// price, not a percentage - below KES 500 the commission equals the
// product price itself (a deliberate, explicit rule, not a rounding
// artifact). Delivery fee is looked up from the product's weight, with
// a per-2kg-block charge above 70kg (any partial block still costs a
// full block, e.g. 71kg = one full extra block).
// ---------- All-inclusive pricing engine ----------
// Turns a seller's asking price into the final, all-inclusive price the
// buyer sees. This is the single source of truth: product creation and
// order creation both call this, so the number can never drift between
// what a buyer was shown and what actually gets charged.
//
// PRICING MODEL — fixed commission and delivery-fee brackets. This is
// the ONLY pricing calculation used anywhere on KenLynk - the old
// pricing_rules/pricing_settings tables are not read here at all.
//
// Final Customer Price = Product Price + Commission + Delivery Fee
//
// Commission is a flat KES amount looked up from the product's own
// price, not a percentage - below KES 500 the commission equals the
// product price itself (a deliberate, explicit rule, not a rounding
// artifact). Delivery fee is looked up from the product's weight, with
// a per-2kg-block charge above 70kg (any partial block still costs a
// full block, e.g. 71kg = one full extra block).
//
// `override` is optional, per-product admin-set config:
//   override.commissionType:  'default' | 'percentage' | 'flat'
//   override.commissionValue: the % (e.g. 15 = 15%) or flat KES amount
//     - takes priority over the fixed brackets below; when absent (the
//     'default' type, or no override object at all), behaviour is
//     byte-for-byte identical to the plain bracket-only calculation.
//   override.deliveryFeeOverride: a flat KES amount replacing the
//     weight-bracket delivery fee entirely, or null/undefined to keep
//     using the weight brackets.
//   override.fragile: when true, adds a flat 5% fragile-handling
//     surcharge (5% of the product's own price) ON TOP of whichever
//     commission just got computed above - stacks with either the
//     default brackets or a custom commission override, it's never a
//     replacement for either.
const FRAGILE_SURCHARGE_RATE = 0.05; // 5% of the product's own price
function computeCommission(productPrice, override) {
  const p = Number(productPrice) || 0;
  let commission;
  if (override && override.commissionType === 'percentage' && override.commissionValue != null && override.commissionValue !== '') {
    commission = Math.round(p * (Number(override.commissionValue) / 100) * 100) / 100;
  } else if (override && override.commissionType === 'flat' && override.commissionValue != null && override.commissionValue !== '') {
    commission = Number(override.commissionValue);
  } else if (p < 500) {
    commission = p;
  } else if (p <= 999) {
    commission = 400;
  } else if (p <= 2499) {
    commission = 800;
  } else if (p <= 4999) {
    commission = 1500;
  } else if (p <= 9999) {
    commission = 2500;
  } else if (p <= 19999) {
    commission = 3500;
  } else if (p <= 29999) {
    commission = 4500;
  } else if (p <= 49999) {
    commission = 5000;
  } else if (p <= 64999) {
    commission = 6000;
  } else {
    commission = 7000; // >= 65000
  }
  if (override && override.fragile) {
    commission = Math.round((commission + p * FRAGILE_SURCHARGE_RATE) * 100) / 100;
  }
  return commission;
}

function computeDeliveryFee(weight, override) {
  if (override && override.deliveryFeeOverride != null && override.deliveryFeeOverride !== '') {
    return Number(override.deliveryFeeOverride);
  }
  const w = Number(weight) || 0;
  if (w <= 20) return 250;
  if (w <= 40) return 400;
  if (w <= 70) return 450;
  const extraBlocks = Math.ceil((w - 70) / 2);
  return 450 + extraBlocks * 50;
}

// Returns { finalPrice, sellerPrice, commission, deliveryFee }.
function computeFinalPrice(sellerPrice, { weight, commissionType, commissionValue, deliveryFeeOverride, fragile } = {}) {
  sellerPrice = Number(sellerPrice) || 0;
  const commission = computeCommission(sellerPrice, { commissionType, commissionValue, fragile });
  const deliveryFee = computeDeliveryFee(weight, { deliveryFeeOverride });
  const finalPrice = Math.round((sellerPrice + commission + deliveryFee) * 100) / 100;
  return { finalPrice, sellerPrice, commission, deliveryFee };
}

module.exports = {
  sendSuccess, sendError, signToken,
  generateReferralCode, generateTrackingNumber, generateOrderNumber,
  calculateDeliveryBaseFee, calculateHomeDeliveryFee, calculateDeliveryFee,
  PLATFORM_DEFAULT_COUNTY,
  SUBSCRIPTION_PLANS, getSubscriptionPrice, getSubscriptionMonths,
  SELLER_PLAN_PRODUCT_LIMITS,
  REFERRAL_COMMISSION_RATE, REFERRAL_MIN_ORDER_TOTAL,
  addMonths, todayStr,
  computeFinalPrice, computeCommission, computeDeliveryFee
};
