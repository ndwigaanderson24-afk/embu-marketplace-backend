// utils/mpesa.js
// Wraps Safaricom's Daraja API: getting an OAuth token, and triggering an
// STK Push (the "enter your M-Pesa PIN" prompt that appears on the
// customer's phone). Sandbox and production use the same code - only the
// base URL and credentials in .env differ.

const MPESA_BASE_URL = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

// Safaricom requires phone numbers as 2547XXXXXXXX (no +, no leading 0).
function formatPhoneForMpesa(phone) {
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '254' + digits.slice(1);
  if (digits.startsWith('7') || digits.startsWith('1')) digits = '254' + digits;
  return digits;
}

// Daraja timestamps are YYYYMMDDHHmmss, matched to the password encoding below.
function getTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function getAccessToken() {
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const res = await fetch(`${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  if (!res.ok) throw new Error('Could not authenticate with M-Pesa. Check MPESA_CONSUMER_KEY/SECRET in .env.');
  const data = await res.json();
  return data.access_token;
}

// Triggers the STK Push - the customer sees a prompt on their phone and
// enters their M-Pesa PIN to approve it. This call only STARTS the
// payment; the actual result comes later via the callback endpoint.
async function initiateSTKPush({ phone, amount, accountReference, transactionDesc, callbackUrl }) {
  const accessToken = await getAccessToken();
  const timestamp = getTimestamp();
  const password = Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
  ).toString('base64');

  const res = await fetch(`${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: formatPhoneForMpesa(phone),
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: formatPhoneForMpesa(phone),
      CallBackURL: callbackUrl,
      AccountReference: accountReference,
      TransactionDesc: transactionDesc
    })
  });

  const data = await res.json();
  console.log('📲 M-Pesa STK push response:', JSON.stringify(data, null, 2));
  if (!res.ok || data.errorCode) {
    throw new Error(data.errorMessage || 'M-Pesa rejected the payment request.');
  }
  // { MerchantRequestID, CheckoutRequestID, ResponseCode, ResponseDescription, CustomerMessage }
  return data;
}

module.exports = { initiateSTKPush, formatPhoneForMpesa };
