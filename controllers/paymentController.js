// controllers/paymentController.js
// Real M-Pesa payment flow: initiate -> Safaricom sends a phone prompt ->
// customer approves -> Safaricom calls our callback -> WE mark it paid.
// The frontend never gets to just declare something paid - only this
// callback, driven by Safaricom's own confirmation, can do that.
//
// Two purposes share this same flow, mirroring the same "charge first,
// then apply" principle intasendController.js used before this replaced
// it:
//   'subscription' - a seller paying for Silver/Gold (see initiateSubscriptionPayment)
//   'order'        - a buyer paying for a cart at checkout (see initiateCheckoutPayment)
// For 'order', the order itself is only created once the callback confirms
// payment - never before. Everything needed to create it later (customer
// details, delivery choice, cart owner) is stashed in payload_json on the
// mpesa_payments row until then.

const { initiateSTKPush } = require('../utils/mpesa');
const MpesaPayment = require('../models/mpesaPayment');
const User = require('../models/user');
const Cart = require('../models/cart');
const Order = require('../models/order');
const { sendSuccess, sendError, getSubscriptionPrice, addMonths, todayStr } = require('../helpers');
const pool = require('../db');

function isValidPhoneNumber(phone) {
  return phone && phone.replace(/\D/g, '').length >= 10;
}

// POST /api/payments/mpesa/subscribe  { months }  (protected, approved seller)
//
// NOT YET SWITCHED OVER - left exactly as it was before this session's
// work, deliberately unfixed. The frontend's real subscription pricing
// (a 6-12 month sliding scale, base KES 3,100 for 6 months up to KES
// 5,800 for 12 - see index.html's getSubscriptionPlan/
// subscriptionExtraMonthsCost) has nothing to do with the silver/gold
// SUBSCRIPTION_PLANS this function calls into, so getSubscriptionPrice
// (Number(months)) always returns null and this endpoint has never
// actually worked under the current pricing model. Fixing it needs the
// real, current intasendController.js first, to see how /intasend/
// subscribe actually turns `months` into the correct price today -
// guessing at it here risked charging a seller the wrong amount, so it
// was deliberately left alone rather than "fixed" with an unverified
// guess. Checkout (initiateCheckoutPayment below) had no such ambiguity
// and is fully switched over.
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

// POST /api/payments/mpesa/checkout  (public - optionalAuth, works for
// guests via session_id or logged-in buyers)
// Body: { session_id?, name, phone, id_number, address,
//         delivery: { type, dest_county, dest_area?, address?, weight_override?, referral_code? },
//         pickup_date? }
// Mirrors intasendController.js's initiateCheckoutPayment exactly - charges
// the buyer first, and only creates the order once mpesaCallback confirms
// payment, never before.
exports.initiateCheckoutPayment = async (req, res) => {
  const { session_id, name, phone, id_number, address, delivery, pickup_date } = req.body;
  if (!name || !phone || !id_number) return sendError(res, 400, 'name, phone and id_number are required.');
  if (!isValidPhoneNumber(phone)) return sendError(res, 400, 'Please enter a valid phone number.');
  if (!delivery || !delivery.type || !delivery.dest_county) return sendError(res, 400, 'delivery.type and delivery.dest_county are required.');
  if (delivery.type === 'delivery' && !delivery.address) return sendError(res, 400, 'delivery.address is required for home delivery.');

  const owner = req.user ? { userId: req.user.id } : { sessionId: session_id };
  if (!owner.userId && !owner.sessionId) return sendError(res, 400, 'session_id is required for guest checkout.');

  const cartItems = await Cart.getItems(owner);
  if (!cartItems.length) return sendError(res, 400, 'Your cart is empty.');

  for (const item of cartItems) {
    if (item.qty > item.stock) return sendError(res, 400, `Insufficient stock for "${item.name}" (${item.stock} left).`);
  }

  // Same math the real order will use - see Order.groupCartBySeller. This
  // is what we charge, so it MUST match what createFromCart bills later.
  const plan = Order.computeDeliveryPlan(cartItems, delivery.dest_county, delivery.type, delivery.weight_override);
  const amount = Math.round(plan.groups.reduce((sum, g) => sum + g.subtotal + g.fee, 0));
  if (!amount || amount <= 0) return sendError(res, 400, 'Could not calculate a valid order total.');

  const payload = {
    owner,
    name, phone, id_number, address,
    delivery: {
      type: delivery.type,
      dest_county: delivery.dest_county,
      dest_area: delivery.dest_area,
      address: delivery.address,
      weight_override: delivery.weight_override,
      referral_code: delivery.referral_code
    },
    pickup_date: pickup_date || null
  };

  const paymentId = await MpesaPayment.create({
    phone, amount, purpose: 'order',
    payload_json: JSON.stringify(payload), user_id: req.user ? req.user.id : null
  });

  try {
    const callbackUrl = `${process.env.MPESA_CALLBACK_BASE_URL}/api/payments/mpesa/callback`;
    const stkResult = await initiateSTKPush({
      phone, amount,
      accountReference: `ORD-${owner.userId || 'guest'}`,
      transactionDesc: 'KenLynk Marketplace order payment',
      callbackUrl
    });
    await MpesaPayment.setCheckoutIds(paymentId, {
      merchant_request_id: stkResult.MerchantRequestID,
      checkout_request_id: stkResult.CheckoutRequestID
    });
    return sendSuccess(res, 200, 'Payment prompt sent to your phone. Enter your M-Pesa PIN to complete.', {
      payment_id: paymentId,
      amount,
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

    // Guard against Safaricom retrying a callback it already sent - never
    // apply the same confirmed payment twice (would double-create orders
    // or double-extend a subscription).
    if (payment.status === 'completed') return res.json({ ResultCode: 0, ResultDesc: 'Received.' });

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
      // This call was missing entirely before - a seller who paid via
      // direct M-Pesa had their subscription_end extended but their
      // actual plan (Silver/Gold) never set, silently breaking every
      // plan-gated feature (e.g. the product-limit check) even though
      // the payment itself succeeded.
      if (payment.purpose_plan) await User.setSellerPlan(user.id, payment.purpose_plan);
    }

    if (payment.purpose === 'order' && payment.payload_json) {
      try {
        const payload = JSON.parse(payment.payload_json);
        const owner = payload.owner;

        const cartItems = await Cart.getItems(owner);
        if (cartItems.length) {
          const createdOrders = await Order.createFromCart(cartItems, {
            userId: owner.userId || null, name: payload.name, phone: payload.phone,
            idNumber: payload.id_number, address: payload.address
          }, {
            type: payload.delivery.type,
            destCounty: payload.delivery.dest_county,
            destArea: payload.delivery.dest_area,
            address: payload.delivery.address,
            weightOverride: payload.delivery.weight_override,
            referralCode: payload.delivery.referral_code,
            pickupDate: payload.pickup_date
          });
          await Cart.clear(owner);
          await MpesaPayment.setResult(payment.id, JSON.stringify({ orders: createdOrders }));
        } else {
          // Cart was emptied some other way between payment and now
          // (shouldn't normally happen) - record that so support can
          // investigate and refund if needed, rather than silently
          // taking payment with no order.
          await MpesaPayment.setResult(payment.id, JSON.stringify({ error: 'Cart was empty when payment was confirmed - no order created.' }));
        }
      } catch (orderErr) {
        console.error('Failed to create order after confirmed M-Pesa payment:', orderErr.message);
        await MpesaPayment.setResult(payment.id, JSON.stringify({ error: orderErr.message }));
      }
    }

    return res.json({ ResultCode: 0, ResultDesc: 'Received.' });
  } catch (err) {
    console.error('M-Pesa callback error:', err.message);
    // Always acknowledge receipt to Safaricom even on our own internal
    // error, so they don't endlessly retry the same callback.
    return res.json({ ResultCode: 0, ResultDesc: 'Received.' });
  }
};

// GET /api/payments/mpesa/status/:checkoutRequestId  (optionalAuth - so
// guests can poll their own order payment; a subscription payment is
// still ownership-checked against the logged-in user here)
exports.checkPaymentStatus = async (req, res) => {
  const payment = await MpesaPayment.findByCheckoutRequestId(req.params.checkoutRequestId);
  if (!payment) return sendError(res, 404, 'Payment not found.');
  if (payment.user_id && req.user && payment.user_id !== req.user.id) return sendError(res, 403, 'Not your payment.');

  let result = null;
  if (payment.result_json) {
    try { result = JSON.parse(payment.result_json); } catch (e) { /* ignore */ }
  }

  return sendSuccess(res, 200, 'Status retrieved.', {
    status: payment.status,
    mpesa_receipt_number: payment.mpesa_receipt_number,
    result_desc: payment.result_desc,
    result
  });
};
