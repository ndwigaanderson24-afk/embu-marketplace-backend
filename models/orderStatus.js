// models/orderStatus.js
// The single source of truth for the order lifecycle: which statuses
// exist, who's allowed to move an order from one to the next, and the
// full audit trail of every change. Nothing anywhere else in the app
// should update orders.status directly - always through here, so the
// "can't skip straight to Completed" rule can never be bypassed.

const pool = require('../db');

const STATUSES = [
  'Pending Payment', 'Paid', 'Processing', 'Ready for Delivery',
  'Out for Delivery', 'Delivered', 'Awaiting Admin Confirmation',
  'Completed', 'Cancelled', 'Refunded'
];

// Maps each status to the statuses it's allowed to move to next, and
// which actor types are allowed to make that specific move.
//   system   - the payment webhook, or an automatic follow-on move
//              (e.g. Delivered -> Awaiting Admin Confirmation once OTP
//              verification succeeds), never a person acting directly
//   seller   - the order's own seller
//   admin    - any admin account
//   customer - the order's own customer
//
// Completed is ONLY reachable from Awaiting Admin Confirmation, and
// ONLY admin can make that specific move - this is the "admin has
// final say" rule: a customer confirming receipt, or a seller/admin
// verifying the delivery OTP, moves the order forward but never
// completes it by itself. See order.js's verifyDeliveryOtp() for how
// Delivered -> Awaiting Admin Confirmation actually gets triggered
// (chained automatically once the OTP check passes).
const TRANSITIONS = {
  'Pending Payment': {
    'Paid': ['system'],
    'Cancelled': ['system', 'admin', 'customer'] // customer abandoning checkout, or payment timeout
  },
  'Paid': {
    'Processing': ['seller', 'admin'],
    'Cancelled': ['seller', 'admin'],
    'Refunded': ['admin']
  },
  'Processing': {
    'Ready for Delivery': ['seller', 'admin'],
    'Cancelled': ['admin'],
    'Refunded': ['admin']
  },
  'Ready for Delivery': {
    'Out for Delivery': ['seller', 'admin'],
    'Refunded': ['admin']
  },
  'Out for Delivery': {
    // Reachable directly by seller/admin (manual override, e.g. no SMS
    // delivery in the area) as well as by the system once OTP
    // verification passes - see order.js's verifyDeliveryOtp().
    'Delivered': ['seller', 'admin', 'system'],
    'Refunded': ['admin']
  },
  'Delivered': {
    // Normally chained automatically (actorType 'system') the instant
    // OTP verification succeeds - see order.js's verifyDeliveryOtp().
    // seller/admin can still push it through manually as a fallback.
    'Awaiting Admin Confirmation': ['system', 'seller', 'admin'],
    'Refunded': ['admin']
  },
  'Awaiting Admin Confirmation': {
    // The one and only path to Completed - admin only. A customer
    // confirming receipt (order.js's markCustomerConfirmed) does NOT
    // transition status at all; it only stamps customer_confirmed_at
    // for admin to see in their review panel.
    'Completed': ['admin'],
    'Refunded': ['admin']
  },
  'Completed': {
    'Refunded': ['admin'] // a completed order can still be refunded later (returns, disputes)
  },
  'Cancelled': {},
  'Refunded': {}
};

function canTransition(fromStatus, toStatus, actorType) {
  const allowedActors = TRANSITIONS[fromStatus] && TRANSITIONS[fromStatus][toStatus];
  return !!(allowedActors && allowedActors.includes(actorType));
}

const OrderStatus = {
  STATUSES,
  TRANSITIONS,
  canTransition,

  // The one place orders.status ever gets written. Validates the move
  // is actually legal for this actor before touching anything, records
  // it in order_status_history either way (rejected attempts are NOT
  // recorded - only real changes), and stamps delivered_at/completed_at/
  // paid_at/awaiting_confirmation_at so those timestamps are always
  // trustworthy without having to trust the status string alone.
  async transition(orderId, toStatus, { actorType, actorId = null, notes = null } = {}) {
    if (!STATUSES.includes(toStatus)) {
      throw new Error(`"${toStatus}" is not a real order status.`);
    }
    const [rows] = await pool.query('SELECT status FROM orders WHERE id = ?', [orderId]);
    if (!rows.length) throw new Error('Order not found.');
    const fromStatus = rows[0].status;

    if (fromStatus === toStatus) return { fromStatus, toStatus, changed: false };

    if (!canTransition(fromStatus, toStatus, actorType)) {
      throw new Error(`Cannot move an order from "${fromStatus}" to "${toStatus}".`);
    }

    const extraSets = [];
    const extraParams = [];
    if (toStatus === 'Delivered') { extraSets.push('delivered_at = NOW()'); }
    if (toStatus === 'Awaiting Admin Confirmation') { extraSets.push('awaiting_confirmation_at = NOW()'); }
    if (toStatus === 'Completed') { extraSets.push('completed_at = NOW()'); }
    if (toStatus === 'Paid') { extraSets.push('paid_at = NOW()'); }

    await pool.query(
      `UPDATE orders SET status = ?${extraSets.length ? ', ' + extraSets.join(', ') : ''} WHERE id = ?`,
      [toStatus, ...extraParams, orderId]
    );

    await pool.query(
      'INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_type, changed_by_id, notes) VALUES (?,?,?,?,?,?)',
      [orderId, fromStatus, toStatus, actorType, actorId, notes]
    );

    // Live update, best-effort - a WebSocket hiccup should never break
    // the actual status change, which is why this is wrapped separately
    // and never thrown from.
    try {
      const [orderRows] = await pool.query('SELECT id, order_number, customer_user_id, seller_id FROM orders WHERE id = ?', [orderId]);
      if (orderRows[0]) {
        const { broadcastOrderUpdate } = require('../utils/websocket');
        broadcastOrderUpdate(orderRows[0], { fromStatus, toStatus });
      }
    } catch (wsErr) {
      console.error('WebSocket broadcast failed (non-fatal):', wsErr.message);
    }

    return { fromStatus, toStatus, changed: true };
  },

  async getHistory(orderId) {
    const [rows] = await pool.query(
      'SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC',
      [orderId]
    );
    return rows;
  }
};

module.exports = OrderStatus;
