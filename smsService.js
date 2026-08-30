// smsService.js
// Sends SMS via Africa's Talking. Two use cases:
//   1. "New order" alerts to the 3 admin phones (sendAdminOrderSms),
//      alongside (never instead of) the existing in-app
//      AdminNotification.
//   2. Delivery OTP codes to a customer's own phone (sendCustomerSms) -
//      the code the rider needs read back to them to mark an order
//      Delivered (see order.js's generateDeliveryOtp/verifyDeliveryOtp).
// If AFRICASTALKING_API_KEY isn't set (e.g. local dev, or before the
// account is fully live), both quietly no-op instead of throwing - SMS
// is a nice-to-have layered on top of the in-app notifications and the
// admin's own OTP-entry UI, never a required step order creation or
// delivery verification strictly depends on. (The admin/seller marking
// a delivery Delivered can still ask the customer to read out the code
// over a phone call if the SMS never arrives - the OTP itself is stored
// either way.)

const AT_USERNAME = process.env.AFRICASTALKING_USERNAME || 'sandbox';
const AT_API_KEY = process.env.AFRICASTALKING_API_KEY || '';

// The 3 admin numbers that should get order SMS - same numbers already
// shown on the site's own Contact page. Kept here rather than in the
// database since there's no admin-phone column anywhere yet; if that
// ever changes, this is the one place to update.
const ADMIN_SMS_NUMBERS = ['+254713721775', '+254793072299', '+254112396258'];

// Converts whatever format a Kenyan phone number is stored in elsewhere
// in the app (local "07XXXXXXXX"/"01XXXXXXXX", or already-international
// "254XXXXXXXXX"/"+254XXXXXXXXX") into the strict E.164 format Africa's
// Talking requires ("+254XXXXXXXXX"). Every phone number in this
// codebase (orders.customer_phone, users.phone, etc.) is stored in
// local format - nothing converts it before this point, which is why
// the very first OTP send silently failed even with a valid API key
// and a verified Sandbox number: Africa's Talking rejected the raw
// "0757413427" as an invalid recipient. Returns null (rather than
// guessing) for anything that doesn't look like a real Kenyan number,
// so a bad number fails loudly in the logs instead of silently trying
// to send to something meaningless.
function toE164Kenya(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+254${digits.slice(1)}`;
  if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) return `+254${digits}`;
  return null;
}

let atSms = null;
function getSmsClient() {
  if (!AT_API_KEY) return null;
  if (atSms) return atSms;
  const AfricasTalking = require('africastalking')({ apiKey: AT_API_KEY, username: AT_USERNAME });
  atSms = AfricasTalking.SMS;
  return atSms;
}

// Fire-and-forget: failures are logged, never thrown, so a flaky SMS
// provider can never block or roll back an order.
async function sendAdminOrderSms(message) {
  const sms = getSmsClient();
  if (!sms) {
    console.log('SMS skipped (AFRICASTALKING_API_KEY not set):', message);
    return;
  }
  try {
    await sms.send({ to: ADMIN_SMS_NUMBERS, message });
  } catch (err) {
    console.error('Failed to send admin order SMS:', err.message);
  }
}

// Generic single-recipient send - used for the delivery OTP, and
// reusable for any future customer-facing SMS (status updates, etc).
// `phone` can be in whatever format the rest of the app already stores
// it in (local "07..." is the norm here) - toE164Kenya() above converts
// it before this ever reaches Africa's Talking, which requires strict
// E.164. A number that doesn't convert cleanly is logged and skipped
// rather than sent malformed and silently swallowed by the provider.
async function sendCustomerSms(phone, message) {
  const sms = getSmsClient();
  const e164Phone = toE164Kenya(phone);
  if (!sms || !e164Phone) {
    console.log(`SMS skipped (no API key, or "${phone}" isn't a recognizable Kenyan number) - message was:`, message);
    return;
  }
  try {
    await sms.send({ to: [e164Phone], message });
  } catch (err) {
    console.error(`Failed to send customer SMS to ${e164Phone}:`, err.message);
  }
}

module.exports = { sendAdminOrderSms, sendCustomerSms, ADMIN_SMS_NUMBERS };
