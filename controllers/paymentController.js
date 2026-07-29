// controllers/paymentController.js
// Real M-Pesa payment flow: initiate -> Safaricom sends a phone prompt ->
// customer approves -> Safaricom calls our callback -> WE mark it paid.
// The frontend never gets to just declare something paid - only this
// callback, driven by Safaricom's own confirmation, can do that.

const { initiateSTKPush } = require('../utils/mpesa');
const MpesaPayment = require('../models/mpesaPayment');
const User = require('../models/user');
const { sendSuccess, sendError, getSubscriptionPrice, addMonths, todayStr } = require('../helpers');
const pool = require('../db');

// POST /api/payments/mpesa/subscribe  { months }  (protected, approved seller)
exports.initiateSubscriptionPayment = async (req, res) => {
  const { months } = req.body;
  const amount = getSubscriptionPrice(Number(months));
  if (!amount) return sendError(res, 400, 'Invalid subscription plan.');
  if (req.user.seller_status !== 'approved') return sendError(res, 403, 'Your seller application must be approved before subscribing.');
  if (!req.user.phone) return sendError(res, 400, 'Your account has no phone number on file.');

  const paymentId = await MpesaPayment.create({
    phone: req.user.phone, amount, purpose: 'subscription', purpose_months: months, user_id: req.user.id
  });

  try {
    const callbackUrl = `${process.env.MPESA_CALLBACK_BASE_URL}/api/payments/mpesa/callback`;
    const stkResult = await initiateSTKPush({
      phone: req.user.phone,
      amount,
      accountReference: `SUB-${req.user.id}`,
      transactionDesc: `Embu Marketplace ${months}-month subscription`,
      callbackUrl
    });
    await MpesaPayment.setCheckoutIds(paymentId, {
      merchant_request_id: stkResult.MerchantRequestID,
      checkout_request_id: stkResult.CheckoutRequestID
    });
    return sendSuccess(res, 200, 'Payment prompt sent to your phone. Enter your M-Pesa PIN to complete.', {
      payment_id: paymentId,
      checkout_request_id: stkResult.CheckoutRequestID
    });
  } catch (err) {
    await pool.query("UPDATE mpesa_payments SET status = 'failed', result_desc = ? WHERE id = ?", [err.message, paymentId]);
    return sendError(res, 502, err.message || 'Could not reach M-Pesa. Please try again.');
  }
};

// POST /api/payments/mpesa/callback  (public - called by Safaricom's servers only)
// This is the ONLY place a payment is ever actually marked paid.
exports.mpesaCallback = async (req, res) => {
  try {
    const body = req.body?.Body?.stkCallback;
    // Logs the exact result Safaricom sent, so we can see the real
    // ResultCode/ResultDesc instead of guessing at it.
    console.log('📞 M-Pesa callback received:', JSON.stringify(req.body, null, 2));
    if (!body) return res.json({ ResultCode: 0, ResultDesc: 'Ignored - unexpected payload shape.' });

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = body;
    const payment = await MpesaPayment.findByCheckoutRequestId(CheckoutRequestID);
    if (!payment) return res.json({ ResultCode: 0, ResultDesc: 'Ignored - unknown checkout request.' });

    if (ResultCode !== 0) {
      // Customer cancelled, entered wrong PIN, insufficient funds, timed out, etc.
      await MpesaPayment.markFailed(CheckoutRequestID, ResultDesc);
      return res.json({ ResultCode: 0, ResultDesc: 'Received.' });
    }

    const items = CallbackMetadata?.Item || [];
    const receipt = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
    await MpesaPayment.markCompleted(CheckoutRequestID, { mpesa_receipt_number: receipt, result_desc: ResultDesc });

    // Payment genuinely confirmed by Safaricom - now actually apply it.
    if (payment.purpose === 'subscription' && payment.user_id) {
      const user = await User.findById(payment.user_id);
      const months = payment.purpose_months;
      const stillActive = user.subscription_end && new Date(user.subscription_end) >= new Date();
      const startBase = stillActive ? user.subscription_end : todayStr();
      const end = addMonths(startBase, months);
      await pool.query('INSERT INTO subscription_payments (seller_id, months, amount) VALUES (?,?,?)', [user.id, months, payment.amount]);
      await User.setSubscription(user.id, { status: 'active', start: todayStr(), end });
    }
    // purpose === 'order' would be applied here too, once checkout is wired to this same flow.

    return res.json({ ResultCode: 0, ResultDesc: 'Received.' });
  } catch (err) {
    console.error('M-Pesa callback error:', err.message);
    // Always acknowledge receipt to Safaricom even on our own internal
    // error, so they don't endlessly retry the same callback.
    return res.json({ ResultCode: 0, ResultDesc: 'Received.' });
  }
};

// GET /api/payments/mpesa/status/:checkoutRequestId  (protected - for the frontend to poll)
exports.checkPaymentStatus = async (req, res) => {
  const payment = await MpesaPayment.findByCheckoutRequestId(req.params.checkoutRequestId);
  if (!payment) return sendError(res, 404, 'Payment not found.');
  if (payment.user_id && payment.user_id !== req.user.id) return sendError(res, 403, 'Not your payment.');
  return sendSuccess(res, 200, 'Status retrieved.', {
    status: payment.status,
    mpesa_receipt_number: payment.mpesa_receipt_number,
    result_desc: payment.result_desc
  });
};
