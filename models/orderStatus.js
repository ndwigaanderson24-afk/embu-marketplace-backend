// models/orderStatus.js
// The single source of truth for the order lifecycle: which statuses
// exist, who's allowed to move an order from one to the next, and the
// full audit trail of every change. Nothing anywhere else in the app
// should update orders.status directly - always through here, so the
// "can't skip straight to Completed" rule can never be bypassed.

const pool = require('../db');

const STATUSES = [
  'Pending Payment', 'Paid',
  'Availability Confirmed', 'Processing / Sourcing', 'Product Purchased', 'Product Unavailable',
  'Seller Confirmed', 'Seller Preparing',
  'Processing', // legacy - no longer reachable from Paid, kept valid for any pre-existing order
  'Ready for Delivery', 'Out for Delivery', 'Delivery Failed', 'Delivered', 'Awaiting Admin Confirmation',
  'Completed', 'Return Requested', 'Return Approved', 'Returned', 'Refund Processing',
  'Cancelled', 'Refunded'
];

// The path from Paid to Ready for Delivery forks in two, chosen
// AUTOMATICALLY from the order's own seller_id - never picked manually
// by an admin (see buildTransitionsForOrder below):
//
//   Platform/admin-owned products (seller_id IS NULL) - KenLynk itself
//   has to actually go source the item from an external supplier:
//     Paid -> Availability Confirmed -> Processing / Sourcing ->
//     Product Purchased -> Ready for Delivery
//   (or -> Product Unavailable -> Cancelled/Refunded if the supplier
//   doesn't have it)
//
//   Third-party seller-owned products (seller_id IS NOT NULL) - the
//   seller already has the stock, no sourcing step needed:
//     Paid -> Seller Confirmed -> Seller Preparing -> Ready for Delivery
//
// Everything before Paid and everything from Ready for Delivery onward
// is identical for both branches and lives in COMMON_TRANSITIONS.

const PLATFORM_SOURCING_TRANSITIONS = {
  'Paid': {
    'Availability Confirmed': ['admin'],
    'Cancelled': ['admin'],
    'Refunded': ['admin']
  },
  'Availability Confirmed': {
    'Processing / Sourcing': ['admin'],
    'Product Unavailable': ['admin'],
    'Refunded': ['admin']
  },
  'Processing / Sourcing': {
    // Product Purchased is always reached via order.js's
    // recordProductPurchase(), which stamps the supplier_* columns in
    // the same call - never a bare status flip with no purchase record.
    'Product Purchased': ['admin'],
    'Product Unavailable': ['admin'],
    'Refunded': ['admin']
  },
  'Product Purchased': {
    'Ready for Delivery': ['admin'],
    'Refunded': ['admin']
  },
  'Product Unavailable': {
    // The customer already paid before this point - Cancelled here is
    // a bare status change (e.g. handled as store credit offline);
    // Refunded goes through the normal process-refund flow with an
    // actual amount recorded.
    'Cancelled': ['admin'],
    'Refunded': ['admin']
  }
};

const SELLER_OWNED_TRANSITIONS = {
  'Paid': {
    'Seller Confirmed': ['seller', 'admin'],
    'Cancelled': ['seller', 'admin'],
    'Refunded': ['admin']
  },
  'Seller Confirmed': {
    'Seller Preparing': ['seller', 'admin'],
    'Refunded': ['admin']
  },
  'Seller Preparing': {
    'Ready for Delivery': ['seller', 'admin'],
    'Refunded': ['admin']
  }
};

// Maps each status to the statuses it's allowed to move to next, and
// which actor types are allowed to make that specific move.
//   system   - the payment webhook, or an automatic follow-on move
//              (e.g. Delivered -> Awaiting Admin Confirmation once OTP
//              verification passes), never a person acting directly
//   seller   - the order's own seller
//   admin    - any admin account
//   customer - the order's own customer
//
// Everything shared by both sourcing branches - the part of the
// lifecycle before Paid and from Ready for Delivery onward, plus the
// legacy 'Processing' status kept valid for backward compatibility.
// Completed is ONLY reachable from Awaiting Admin Confirmation, and
// ONLY admin can make that specific move - this is the "admin has
// final say" rule: a customer confirming receipt, or a seller/admin
// verifying the delivery OTP, moves the order forward but never
// completes it by itself. See order.js's verifyDeliveryOtp() for how
// Delivered -> Awaiting Admin Confirmation actually gets triggered
// (chained automatically once the OTP check passes).
const COMMON_TRANSITIONS = {
  'Pending Payment': {
    'Paid': ['system'],
    'Cancelled': ['system', 'admin', 'customer'] // customer abandoning checkout, or payment timeout
  },
  'Processing': { // legacy path - see STATUSES comment above
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
    // The rider tried and couldn't complete the delivery - customer
    // unreachable, refused it, wrong address, etc. The specific reason
    // is captured as free text in the transition's notes (see
    // order.js's markDeliveryFailed) rather than as separate statuses
    // for every possible reason, since order_status_history already
    // records notes per transition and a dozen near-duplicate statuses
    // would add real state-machine complexity for no functional gain
    // over a single "Delivery Failed" status with a clear note.
    'Delivery Failed': ['seller', 'admin'],
    'Refunded': ['admin']
  },
  'Delivery Failed': {
    // Retry - seller/admin sends the rider out again (or a different
    // one). Doesn't require a fresh OTP send here specifically; that's
    // a separate action via the existing send-delivery-otp endpoint,
    // since the previous code may still be valid/unexpired.
    'Out for Delivery': ['seller', 'admin'],
    'Cancelled': ['admin'],
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
    // A customer can request a return after the fact - admin decides
    // whether to approve or decline it (declining sends it straight
    // back to Completed). 'Refunded' is kept here too as a direct
    // admin fast-path for cases that don't need the full return
    // workflow (e.g. a goodwill refund with nothing physically
    // returned).
    'Return Requested': ['customer', 'admin'],
    'Refunded': ['admin']
  },
  'Return Requested': {
    'Return Approved': ['admin'],
    'Completed': ['admin'], // declined - back to normal completed state
    'Refunded': ['admin']
  },
  'Return Approved': {
    // Admin marks it once the physical item is actually back in hand -
    // this is a real receiving step, not automatic on approval.
    'Returned': ['admin'],
    'Refunded': ['admin']
  },
  'Returned': {
    'Refund Processing': ['admin'],
    'Refunded': ['admin']
  },
  'Refund Processing': {
    'Refunded': ['admin']
  },
  'Cancelled': {},
  'Refunded': {}
};

// Merges the shared transitions with whichever sourcing branch this
// specific order belongs to - determined purely from order.seller_id,
// never from anything the caller passes in. A platform order (seller_id
// NULL) can never be routed through the seller-owned branch and vice
// versa, since the branch choice is derived here, not supplied.
function buildTransitionsForOrder(order) {
  const branch = (order && order.seller_id) ? SELLER_OWNED_TRANSITIONS : PLATFORM_SOURCING_TRANSITIONS;
  return { ...COMMON_TRANSITIONS, ...branch };
}

function canTransition(fromStatus, toStatus, actorType, order) {
  const transitions = buildTransitionsForOrder(order);
  const allowedActors = transitions[fromStatus] && transitions[fromStatus][toStatus];
  return !!(allowedActors && allowedActors.includes(actorType));
}

const OrderStatus = {
  STATUSES,
  COMMON_TRANSITIONS,
  PLATFORM_SOURCING_TRANSITIONS,
  SELLER_OWNED_TRANSITIONS,
  buildTransitionsForOrder,
  canTransition,

  // The one place orders.status ever gets written. Validates the move
  // is actually legal for this actor AND this order's sourcing branch
  // before touching anything, records it in order_status_history either
  // way (rejected attempts are NOT recorded - only real changes), and
  // stamps delivered_at/completed_at/paid_at/awaiting_confirmation_at/
  // refunded_at/product_purchased_at so those timestamps are always
  // trustworthy without having to trust the status string alone.
  async transition(orderId, toStatus, { actorType, actorId = null, notes = null } = {}) {
    if (!STATUSES.includes(toStatus)) {
      throw new Error(`"${toStatus}" is not a real order status.`);
    }
    const [rows] = await pool.query('SELECT status, seller_id FROM orders WHERE id = ?', [orderId]);
    if (!rows.length) throw new Error('Order not found.');
    const order = rows[0];
    const fromStatus = order.status;

    if (fromStatus === toStatus) return { fromStatus, toStatus, changed: false };

    if (!canTransition(fromStatus, toStatus, actorType, order)) {
      throw new Error(`Cannot move an order from "${fromStatus}" to "${toStatus}".`);
    }

    const extraSets = [];
    const extraParams = [];
    if (toStatus === 'Delivered') { extraSets.push('delivered_at = NOW()'); }
    if (toStatus === 'Awaiting Admin Confirmation') { extraSets.push('awaiting_confirmation_at = NOW()'); }
    if (toStatus === 'Completed') { extraSets.push('completed_at = NOW()'); }
    if (toStatus === 'Paid') { extraSets.push('paid_at = NOW()'); }
    if (toStatus === 'Refunded') { extraSets.push('refunded_at = NOW()'); }
    if (toStatus === 'Product Purchased') { extraSets.push('product_purchased_at = NOW()'); }

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
