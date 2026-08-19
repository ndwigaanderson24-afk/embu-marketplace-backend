// smsService.js
// Sends SMS via Africa's Talking - currently only used for "new order"
// alerts to the 3 admin phones, alongside (never instead of) the
// existing in-app AdminNotification. If AFRICASTALKING_API_KEY isn't
// set (e.g. local dev, or before the account is fully live), this
// quietly no-ops instead of throwing - SMS is a nice-to-have layered on
// top of the in-app notifications, never a required step order
// creation depends on.

const AT_USERNAME = process.env.AFRICASTALKING_USERNAME || 'sandbox';
const AT_API_KEY = process.env.AFRICASTALKING_API_KEY || '';

// The 3 admin numbers that should get order SMS - same numbers already
// shown on the site's own Contact page. Kept here rather than in the
// database since there's no admin-phone column anywhere yet; if that
// ever changes, this is the one place to update.
const ADMIN_SMS_NUMBERS = ['+254713721775', '+254793072299', '+254112396258'];

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

module.exports = { sendAdminOrderSms, ADMIN_SMS_NUMBERS };
