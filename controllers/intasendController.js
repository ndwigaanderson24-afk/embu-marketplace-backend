// controllers/intasendController.js
// Backup payment flow via IntaSend: initiate -> IntaSend sends a phone
// prompt via their own already-live M-Pesa integration -> customer
// approves -> IntaSend calls our webhook -> WE mark it paid. Same
// "only the webhook can mark paid" principle as paymentController.js -
// the frontend never gets to just declare something paid.
//
// Two purposes share this same flow:
//   'subscription' - a seller paying for Silver/Gold (see initiateSubscriptionPayment)
//   'order'        - a buyer paying for a cart at checkout (see initiateCheckoutPayment)
// For 'order', the order itself is only created once the webhook confirms
// payment - never before. Everything needed to create it later (customer
// details, delivery choice, cart owner) is stashed in payload_json on the
// intasend_payments row until then.

const { v4: uuidv4 } = require('uuid');
const { initiateStkPush } = require('../utils/intasend');
const IntasendPayment = require('../models/intasendPayment');
const User = require('../models/user');
const Cart = require('../models/cart');
const Order = require('../models/order');
const { sendSuccess, sendError, getSubscriptionPrice, getSubscriptionMonths, SUBSCRIPTION_PLANS, addMonths, todayStr } = require('../helpers');
const Product = require('../models/product');
const FeaturedRequest = require('../models/featuredRequest');
const FeaturedLiveRequest = require('../models/featuredLiveRequest');
const { LiveStream } = require('../models/liveStream');

function isValidPhoneNumber(phone) {
  return phone && phone.replace(/\D/g, '').length >= 10;
}

// POST /api/intasend/subscribe  { plan }  (protected, approved seller)
// plan is 'silver' or 'gold' - see helpers.js SUBSCRIPTION_PLANS.
exports.initiateSubscriptionPayment = async (req, res) => {
  const { plan } = req.body;
  const amount = getSubscriptionPrice(plan);
  const months = getSubscriptionMonths(plan);
  if (!amount) return sendError(res, 400, `Invalid plan. Choose one of: ${Object.keys(SUBSCRIPTION_PLANS).join(', ')}`);
  if (req.user.seller_status !== 'approved') return sendError(res, 403, 'Your seller application must be approved before subscribing.');
  if (!req.user.phone) return sendError(res, 400, 'Your account has no phone number on file.');

  const apiRef = `SUB-${req.user.id}-${uuidv4().slice(0, 8)}`;

  await IntasendPayment.create({
    api_ref: apiRef, phone: req.user.phone, amount, purpose: 'subscription',
    purpose_months: months, purpose_plan: plan, user_id: req.user.id
  });

  try {
    const stkResult = await initiateStkPush({
      phone: req.user.phone,
      amount,
      email: req.user.email,
      apiRef,
      narrative: `KenLynk Marketplace ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan subscription`
    });

    const invoiceId = stkResult && stkResult.invoice ? stkResult.invoice.invoice_id : null;
    if (invoiceId) await IntasendPayment.setInvoiceId(apiRef, invoiceId);

    return sendSuccess(res, 200, 'Payment prompt sent to your phone. Enter your M-Pesa PIN to complete.', {
      api_ref: apiRef,
      invoice_id: invoiceId
    });
  } catch (err) {
    await IntasendPayment.updateStatus(apiRef, 'FAILED', err.message);
    return sendError(res, 502, err.message || 'Could not reach IntaSend. Please try again.');
  }
};

// POST /api/intasend/checkout  (public - optionalAuth, works for guests via
// session_id or logged-in buyers)
// Body: { session_id?, name, phone, id_number, address,
//         delivery: { type, dest_county, dest_area?, address?, weight_override?, referral_code? },
//         pickup_date? }
// Mirrors the validation in orderRoutes.js POST / exactly, but instead of
// creating the order immediately, it charges the buyer first and only
// creates the order once the webhook confirms payment.
// POST /api/intasend/feature-product  { product_id, days }  (protected, seller)
// Real payment for "Feature My Product" - price is computed here, never
// trusted from the client. Once the webhook confirms payment, a real
// pending request is created for admin to review - the product does
// NOT become featured just from paying, matching the intended
// "pay then admin approves" flow.
exports.initiateFeatureProductPayment = async (req, res) => {
  const { product_id, days } = req.body;
  const daysNum = parseInt(days, 10);
  if (!product_id || ![1, 7].includes(daysNum)) {
    return sendError(res, 400, 'days must be 1 or 7.');
  }
  const product = await Product.findById(product_id);
  if (!product || product.seller_id !== req.user.id) {
    return sendError(res, 403, 'That product is not yours.');
  }
  if (!req.user.phone) return sendError(res, 400, 'Your account has no phone number on file.');

  const amount = daysNum === 1 ? 100 : 500;
  const apiRef = `FEAT-${req.user.id}-${uuidv4().slice(0, 8)}`;

  await IntasendPayment.create({
    api_ref: apiRef, phone: req.user.phone, amount, purpose: 'featured_product',
    payload_json: JSON.stringify({ product_id, days: daysNum, seller_id: req.user.id }),
    user_id: req.user.id
  });

  try {
    const stkResult = await initiateStkPush({
      phone: req.user.phone,
      amount,
      email: req.user.email,
      apiRef,
      narrative: `KenLynk Marketplace - Feature "${product.name}" for ${daysNum} day${daysNum === 1 ? '' : 's'}`
    });

    const invoiceId = stkResult && stkResult.invoice ? stkResult.invoice.invoice_id : null;
    if (invoiceId) await IntasendPayment.setInvoiceId(apiRef, invoiceId);

    return sendSuccess(res, 200, 'Payment prompt sent to your phone. Enter your M-Pesa PIN to complete.', {
      api_ref: apiRef,
      invoice_id: invoiceId
    });
  } catch (err) {
    await IntasendPayment.updateStatus(apiRef, 'FAILED', err.message);
    return sendError(res, 502, err.message || 'Could not reach IntaSend. Please try again.');
  }
};

// POST /api/intasend/feature-live  { stream_id }  (protected, seller)
// Real payment for "Promote Your Live" - the stream only actually gets
// promoted once the webhook confirms payment AND admin approves it,
// same two-step flow as Feature My Product.
exports.initiateFeatureLivePayment = async (req, res) => {
  const { stream_id } = req.body;
  if (!stream_id) return sendError(res, 400, 'stream_id is required.');

  const stream = await LiveStream.findById(stream_id);
  if (!stream || stream.seller_id !== req.user.id) {
    return sendError(res, 403, 'That stream is not yours.');
  }
  if (stream.status !== 'live') return sendError(res, 400, 'This stream is not live right now.');
  if (!req.user.phone) return sendError(res, 400, 'Your account has no phone number on file.');

  const amount = 200;
  const apiRef = `FLIVE-${req.user.id}-${uuidv4().slice(0, 8)}`;

  await IntasendPayment.create({
    api_ref: apiRef, phone: req.user.phone, amount, purpose: 'featured_live',
    payload_json: JSON.stringify({ stream_id, seller_id: req.user.id }),
    user_id: req.user.id
  });

  try {
    const stkResult = await initiateStkPush({
      phone: req.user.phone,
      amount,
      email: req.user.email,
      apiRef,
      narrative: `KenLynk Marketplace - Promote your live stream`
    });

    const invoiceId = stkResult && stkResult.invoice ? stkResult.invoice.invoice_id : null;
    if (invoiceId) await IntasendPayment.setInvoiceId(apiRef, invoiceId);

    return sendSuccess(res, 200, 'Payment prompt sent to your phone. Enter your M-Pesa PIN to complete.', {
      api_ref: apiRef,
      invoice_id: invoiceId
    });
  } catch (err) {
    await IntasendPayment.updateStatus(apiRef, 'FAILED', err.message);
    return sendError(res, 502, err.message || 'Could not reach IntaSend. Please try again.');
  }
};

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
  // Delivery is already baked into each product's price - never add a
  // fee here, or the buyer would be charged for delivery twice.
  const amount = Math.round(plan.groups.reduce((sum, g) => sum + g.subtotal, 0));
  if (!amount || amount <= 0) return sendError(res, 400, 'Could not calculate a valid order total.');

  const apiRef = `ORD-${owner.userId || 'guest'}-${uuidv4().slice(0, 8)}`;

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

  await IntasendPayment.create({
    api_ref: apiRef, phone, amount, purpose: 'order',
    payload_json: JSON.stringify(payload), user_id: req.user ? req.user.id : null
  });

  try {
    const stkResult = await initiateStkPush({
      phone, amount, email: req.user ? req.user.email : undefined, apiRef,
      narrative: 'KenLynk Marketplace order payment'
    });

    const invoiceId = stkResult && stkResult.invoice ? stkResult.invoice.invoice_id : null;
    if (invoiceId) await IntasendPayment.setInvoiceId(apiRef, invoiceId);

    return sendSuccess(res, 200, 'Payment prompt sent to your phone. Enter your M-Pesa PIN to complete.', {
      api_ref: apiRef,
      amount,
      invoice_id: invoiceId
    });
  } catch (err) {
    await IntasendPayment.updateStatus(apiRef, 'FAILED', err.message);
    return sendError(res, 502, err.message || 'Could not reach IntaSend. Please try again.');
  }
};

// POST /api/intasend/webhook  (public - called only by IntaSend's servers)
// This is the ONLY place an IntaSend payment is ever actually marked paid.
exports.webhook = async (req, res) => {
  try {
    console.log('📞 IntaSend webhook received:', JSON.stringify(req.body, null, 2));

    // Validate the shared challenge so random requests can't fake a
    // completed payment - set the same string in the IntaSend dashboard's
    // webhook config and in INTASEND_WEBHOOK_CHALLENGE below.
    if (process.env.INTASEND_WEBHOOK_CHALLENGE && req.body.challenge !== process.env.INTASEND_WEBHOOK_CHALLENGE) {
      console.warn('IntaSend webhook challenge mismatch - ignoring.');
      return res.status(200).json({ received: true });
    }

    const { api_ref, state, invoice_id, failed_reason } = req.body;
    if (!api_ref) return res.status(200).json({ received: true });

    const payment = await IntasendPayment.findByApiRef(api_ref);
    if (!payment) return res.status(200).json({ received: true });

    if (invoice_id && !payment.invoice_id) await IntasendPayment.setInvoiceId(api_ref, invoice_id);

    if (state === 'FAILED') {
      await IntasendPayment.updateStatus(api_ref, 'FAILED', failed_reason);
      return res.status(200).json({ received: true });
    }

    if (state === 'PROCESSING') {
      await IntasendPayment.updateStatus(api_ref, 'PROCESSING');
      return res.status(200).json({ received: true });
    }

    if (state === 'COMPLETE') {
      // Guard against IntaSend retrying a webhook it already sent - never
      // apply the same confirmed payment twice (would double-create orders
      // or double-extend a subscription).
      if (payment.status === 'COMPLETE') return res.status(200).json({ received: true });

      await IntasendPayment.updateStatus(api_ref, 'COMPLETE');

      // Payment genuinely confirmed by IntaSend - now actually apply it.
      if (payment.purpose === 'subscription' && payment.user_id) {
        const user = await User.findById(payment.user_id);
        const months = payment.purpose_months;
        const stillActive = user.subscription_end && new Date(user.subscription_end) >= new Date();
        const startBase = stillActive ? user.subscription_end : todayStr();
        const end = addMonths(startBase, months);

        const pool = require('../db');
        await pool.query('INSERT INTO subscription_payments (seller_id, months, amount) VALUES (?,?,?)', [user.id, months, payment.amount]);
        await User.setSubscription(user.id, { status: 'active', start: todayStr(), end });
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
            await IntasendPayment.setResult(api_ref, JSON.stringify({ orders: createdOrders }));
          } else {
            // Cart was emptied some other way between payment and now
            // (shouldn't normally happen) - record that so support can
            // investigate and refund if needed, rather than silently
            // taking payment with no order.
            await IntasendPayment.setResult(api_ref, JSON.stringify({ error: 'Cart was empty when payment was confirmed - no order created.' }));
          }
        } catch (orderErr) {
          console.error('Failed to create order after confirmed payment:', orderErr.message);
          await IntasendPayment.setResult(api_ref, JSON.stringify({ error: orderErr.message }));
        }
      }

      // Payment confirmed for a "Feature My Product" request - creates a
      // real pending request for admin to review. The product does NOT
      // become featured yet; that only happens once admin approves it
      // (see adminController.approveFeaturedRequest).
      if (payment.purpose === 'featured_product' && payment.payload_json) {
        try {
          const payload = JSON.parse(payment.payload_json);
          const requestId = await FeaturedRequest.create({
            seller_id: payload.seller_id, product_id: payload.product_id,
            days: payload.days, price: payment.amount
          });
          await IntasendPayment.setResult(api_ref, JSON.stringify({ featured_request_id: requestId }));
        } catch (featErr) {
          console.error('Failed to create featured request after confirmed payment:', featErr.message);
          await IntasendPayment.setResult(api_ref, JSON.stringify({ error: featErr.message }));
        }
      }

      // Same pattern, for a real "Promote Your Live" payment.
      if (payment.purpose === 'featured_live' && payment.payload_json) {
        try {
          const payload = JSON.parse(payment.payload_json);
          const requestId = await FeaturedLiveRequest.create({
            seller_id: payload.seller_id, stream_id: payload.stream_id, price: payment.amount
          });
          await IntasendPayment.setResult(api_ref, JSON.stringify({ featured_live_request_id: requestId }));
        } catch (liveErr) {
          console.error('Failed to create featured live request after confirmed payment:', liveErr.message);
          await IntasendPayment.setResult(api_ref, JSON.stringify({ error: liveErr.message }));
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('IntaSend webhook error:', err.message);
    // Always acknowledge receipt even on our own internal error, so
    // IntaSend doesn't endlessly retry (and doesn't deactivate the
    // webhook after repeated failures - see their 20-failure limit).
    return res.status(200).json({ received: true });
  }
};

// GET /api/intasend/status/:apiRef  (public - optionalAuth, so guests can
// poll their own checkout payment; logged-in users are still checked
// against ownership when the payment has a user_id attached)
exports.checkPaymentStatus = async (req, res) => {
  const payment = await IntasendPayment.findByApiRef(req.params.apiRef);
  if (!payment) return sendError(res, 404, 'Payment not found.');
  if (payment.user_id && req.user && payment.user_id !== req.user.id) return sendError(res, 403, 'Not your payment.');

  let result = null;
  if (payment.result_json) {
    try { result = JSON.parse(payment.result_json); } catch (e) { /* ignore */ }
  }

  return sendSuccess(res, 200, 'Status retrieved.', {
    status: payment.status,
    failed_reason: payment.failed_reason,
    result
  });
};
