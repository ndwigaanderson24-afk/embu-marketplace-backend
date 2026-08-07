// controllers/intasendController.js
// Backup payment flow via IntaSend: initiate -> IntaSend sends a phone
// prompt via their own already-live M-Pesa integration -> customer
// approves -> IntaSend calls our webhook -> WE mark it paid. Same
// "only the webhook can mark paid" principle as paymentController.js -
// the frontend never gets to just declare something paid.

const { v4: uuidv4 } = require('uuid');
const { initiateStkPush } = require('../utils/intasend');
const IntasendPayment = require('../models/intasendPayment');
const User = require('../models/user');
const { sendSuccess, sendError, getSubscriptionPrice, getSubscriptionMonths, addMonths, todayStr } = require('../helpers');

// POST /api/intasend/subscribe  { plan }  (protected, approved seller)
// plan is 'silver' or 'gold' - see helpers.js SUBSCRIPTION_PLANS.
exports.initiateSubscriptionPayment = async (req, res) => {
  const { plan } = req.body;
  const amount = getSubscriptionPrice(plan);
  const months = getSubscriptionMonths(plan);
  if (!amount) return sendError(res, 400, `Invalid plan. Choose one of: ${Object.keys(require('../helpers').SUBSCRIPTION_PLANS).join(', ')}`);
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
      // purpose === 'order' would be applied here too, once checkout is wired to this same flow.
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

// GET /api/intasend/status/:apiRef  (protected - for the frontend to poll)
exports.checkPaymentStatus = async (req, res) => {
  const payment = await IntasendPayment.findByApiRef(req.params.apiRef);
  if (!payment) return sendError(res, 404, 'Payment not found.');
  if (payment.user_id && payment.user_id !== req.user.id) return sendError(res, 403, 'Not your payment.');
  return sendSuccess(res, 200, 'Status retrieved.', {
    status: payment.status,
    failed_reason: payment.failed_reason
  });
};
