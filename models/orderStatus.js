// models/orderStatus.js
// The single source of truth for the order lifecycle: which statuses
// exist, who's allowed to move an order from one to the next, and the
// full audit trail of every change. Nothing anywhere else in the app
// should update orders.status directly - always through here, so the
// "can't skip straight to Completed" rule can never be bypassed.

const pool = require('../db');

const STATUSES = [
  'Pending Payment', 'Paid', 'Processing', 'Ready for Delivery',
  'Out for Delivery', 'Delivered', 'Completed', 'Cancelled', 'Refunded'
];

// Maps each status to the statuses it's allowed to move to next, and
// which actor types are allowed to make that specific move.
//   system   - the payment webhook, automatic only
//   seller   - the order's own seller
//   admin    - any admin account
//   customer - the order's own customer
//
// Cancelled/Refunded are reachable from several points (a seller or
// admin may need to cancel before shipping; only admin can refund,
// since that's a real financial action). Completed is ONLY reachable
// from Delivered, and only the customer can make that specific move -
// this is what makes "can't complete before delivered" actually
// enforced, not just documented.
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
    'Delivered': ['seller', 'admin'],
    'Refunded': ['admin']
  },
  'Delivered': {
    'Completed': ['customer', 'admin'], // admin can also confirm on a customer's behalf if they call in
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
  // paid_at so those timestamps are always trustworthy without having
  // to trust the status string alone.
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
