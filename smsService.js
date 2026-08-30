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
// `phone` should already be in the same format the rest of the app
// stores customer phone numbers in; Africa's Talking expects E.164
// (+254...) - if your stored numbers are local format (07...), convert
// before calling this, the same way checkout/M-Pesa already do.
async function sendCustomerSms(phone, message) {
  const sms = getSmsClient();
  if (!sms || !phone) {
    console.log(`SMS skipped (AFRICASTALKING_API_KEY not set or no phone) to ${phone}:`, message);
    return;
  }
  try {
    await sms.send({ to: [phone], message });
  } catch (err) {
    console.error(`Failed to send customer SMS to ${phone}:`, err.message);
  }
}

module.exports = { sendAdminOrderSms, sendCustomerSms, ADMIN_SMS_NUMBERS };
