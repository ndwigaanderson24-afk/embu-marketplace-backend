// utils/intasend.js
// Wraps IntaSend's official Node SDK to trigger an M-Pesa STK Push.
// This is a BACKUP payment path: it uses IntaSend's own, already-live
// M-Pesa integration - so it works today, without waiting on the
// platform's own Safaricom Daraja Go-Live approval. Money lands in the
// IntaSend wallet first; withdraw it to your bank/M-Pesa from the
// IntaSend dashboard whenever you like. Switch back to the platform's
// own mpesa.js (utils/mpesa.js) once Daraja Go-Live is approved, if you
// prefer collecting directly instead.

const IntaSend = require('intasend-node');

function getClient() {
  return new IntaSend(
    process.env.INTASEND_PUBLISHABLE_KEY,
    process.env.INTASEND_SECRET_KEY,
    process.env.INTASEND_TEST === 'true' // true = sandbox, false = live
  );
}

// Kenyan numbers need the 2547XXXXXXXX format for IntaSend, same as Daraja.
function formatPhoneForIntasend(phone) {
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '254' + digits.slice(1);
  if (digits.startsWith('7') || digits.startsWith('1')) digits = '254' + digits;
  return digits;
}

// Triggers the STK Push - the customer sees a prompt on their phone and
// enters their M-Pesa PIN to approve it. This call only STARTS the
// payment; the actual result comes later via the webhook.
async function initiateStkPush({ phone, amount, email, apiRef, narrative }) {
  const intasend = getClient();
  const collection = intasend.collection();

  const response = await collection.mpesaStkPush({
    amount,
    phone_number: formatPhoneForIntasend(phone),
    email: email || 'no-reply@kenlynk.com', // IntaSend requires an email field even though this flow is phone-driven
    api_ref: apiRef,
    narrative: narrative || 'KenLynk Marketplace payment'
  });

  return response; // includes invoice.invoice_id among other fields
}

module.exports = { initiateStkPush, formatPhoneForIntasend };
