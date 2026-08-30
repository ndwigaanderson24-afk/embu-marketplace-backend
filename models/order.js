// models/order.js
// Mirrors embu-marketplace.html's checkout logic: a cart spanning several
// sellers is split into one order row PER SELLER, each with its own
// delivery fee computed from THAT seller's county.

const pool = require('../db');
const Notification = require('./notification');
const AdminNotification = require('./adminNotification');
const { sendAdminOrderSms, sendCustomerSms } = require('../smsService');
const {
  generateOrderNumber, generateTrackingNumber, calculateDeliveryFee,
  PLATFORM_DEFAULT_COUNTY, REFERRAL_COMMISSION_RATE, REFERRAL_MIN_ORDER_TOTAL,
  computeCommission, computeDeliveryFee
} = require('../helpers');

// Mirrors window.getUnitPriceForQty() in index.html exactly, so the cart
// page's displayed wholesale price and what checkout actually charges
// can never disagree. Was previously only applied on the frontend for
// display - the buyer saw a bulk discount in their cart, but got charged
// the regular per-unit price when the order was placed. tiers come from
// products.wholesale_tiers_json, joined onto each cart item already.
function getUnitPriceForQty(item) {
  const base = Number(item.price) || 0;
  let tiers = [];
  try { tiers = item.wholesale_tiers_json ? JSON.parse(item.wholesale_tiers_json) : []; } catch (e) { tiers = []; }
  if (!Array.isArray(tiers) || !tiers.length) return base;
  let unit = base;
  for (const t of tiers) {
    const max = (t.max !== null && t.max !== undefined && Number(t.max) > 0) ? Number(t.max) : Infinity;
    if (item.qty >= Number(t.min) && item.qty <= max) { unit = Number(t.price); break; }
  }
  return unit;
}

// Mirrors window.isKanyagaActive() in index.html exactly - a Kanyaga
// deal is live right now if a kanyaga_price is set and the current
// time falls inside its optional start/end window. Was previously
// only shown on the product detail page for display - the buyer saw
// "KANYAGA PRICE KES 11,999" but checkout still charged the regular
// price. cart.js's getItems() already selects p.* so these columns
// are already present on every cart item.
// Turns a MySQL datetime into something new Date() can only read one
// way - unambiguously UTC. mysql2 can hand this back either as a plain
// space-separated string ("2026-08-22 10:00:00") or as an already-
// parsed JS Date object depending on driver config, so this handles
// both rather than assuming one. For the string case: without this, V8
// falls back to interpreting a space-separated datetime as LOCAL
// server time, so "is this Kanyaga deal active right now" could
// silently disagree with what was actually set - a genuinely active
// deal could be missed and checkout would fall back to charging the
// regular price instead. Mirrors the identical fix in
// productController.js's getKanyaga endpoint.
function parseMysqlDatetimeAsUtc(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  return new Date(String(value).replace(' ', 'T') + 'Z');
}

function isKanyagaActiveNow(item) {
  if (!item.kanyaga_price) return false;
  const now = new Date();
  const start = parseMysqlDatetimeAsUtc(item.kanyaga_start_at);
  const end = parseMysqlDatetimeAsUtc(item.kanyaga_end_at);
  if (start && start > now) return false;
  if (end && end < now) return false;
  return true;
}

// The real price a cart line is actually charged at - whichever of the
// wholesale-tier price or an active Kanyaga price is lower for the
// buyer, since both exist to represent "the deal price" and the more
// generous one should win rather than one silently overriding the
// other. Falls back to the regular per-unit price when neither applies.
function getFinalUnitPrice(item) {
  const wholesalePrice = getUnitPriceForQty(item);
  if (!isKanyagaActiveNow(item)) return wholesalePrice;
  return Math.min(wholesalePrice, Number(item.kanyaga_price));
}

const Order = {
  // Groups cart rows (each already joined to its product) by seller,
  // computing each group's own weight/subtotal - the shared foundation
  // for both a price preview and the actual order-splitting below.
  //
  // subtotal is what the buyer pays (product.price is already
  // all-inclusive). sellerSubtotal is what sellers are actually owed
  // (product.seller_price, or the variant's own seller_price when one is
  // selected) - the gap between the two is exactly KenLynk's commission +
  // delivery fee combined, already baked into each item's displayed
  // price, never charged as a separate line item. Commission and
  // delivery fee are computed live here via the new fixed-bracket
  // formula (computeCommission/computeDeliveryFee) rather than read from
  // a stored column, since a cart line's price/weight are already known
  // and the old per-row price_margin/price_delivery_allocation columns
  // no longer exist.
  groupCartBySeller(cartItems) {
    const groups = {};
    cartItems.forEach(item => {
      const sellerKey = item.seller_id || 'platform';
      const county = item.county || PLATFORM_DEFAULT_COUNTY;
      if (!groups[sellerKey]) {
        groups[sellerKey] = {
          sellerId: item.seller_id || null, county, items: [], weight: 0,
          subtotal: 0, sellerSubtotal: 0, commissionTotal: 0, deliveryFeeTotal: 0
        };
      }
      const g = groups[sellerKey];
      g.items.push(item);
      g.weight += Number(item.weight || 1) * item.qty;

      // Wholesale/quantity pricing: if this product has bulk-price tiers
      // and qty crosses a threshold, the buyer pays that tier's price
      // instead of the regular unit price. The discount ratio is also
      // applied to the seller's earnings and KenLynk's commission/
      // delivery-fee components, so a 20% bulk discount reduces
      // everyone's cut by that same 20% rather than landing entirely on
      // one side without being asked to - the revenue split stays the
      // same as a regular-price order, just scaled down together.
      const regularUnitPrice = Number(item.price) || 0;
      const unitPrice = getFinalUnitPrice(item);
      const ratio = regularUnitPrice > 0 ? unitPrice / regularUnitPrice : 1;
      const commission = computeCommission(Number(item.seller_price != null ? item.seller_price : item.price));
      const deliveryFee = computeDeliveryFee(item.weight);

      g.subtotal += unitPrice * item.qty;
      g.sellerSubtotal += Number(item.seller_price != null ? item.seller_price : item.price) * ratio * item.qty;
      g.commissionTotal += commission * ratio * item.qty;
      g.deliveryFeeTotal += deliveryFee * ratio * item.qty;
    });
    return Object.values(groups);
  },

  // Full pricing preview for the cart page - same math as checkout, but
  // without writing anything, so the frontend can show a live total.
  //
  // logisticsFee is an ESTIMATE of actual shipping cost (weight + route
  // based) purely for admin/internal reference - it is never added to
  // what the buyer pays. Delivery is already funded by each product's
  // baked-in delivery fee (deliveryFeeTotal per group).
  computeDeliveryPlan(cartItems, destCounty, deliveryType, weightOverride) {
    const groups = this.groupCartBySeller(cartItems);
    const autoTotalWeight = groups.reduce((s, g) => s + g.weight, 0);
    const useOverride = typeof weightOverride === 'number' && weightOverride > 0;
    const scale = useOverride && autoTotalWeight > 0 ? weightOverride / autoTotalWeight : 1;

    let totalLogisticsFee = 0;
    const planGroups = groups.map(g => {
      const weight = useOverride ? (autoTotalWeight > 0 ? g.weight * scale : weightOverride / groups.length) : g.weight;
      const logisticsFee = calculateDeliveryFee(weight, g.county, destCounty, deliveryType);
      totalLogisticsFee += logisticsFee;
      return { ...g, weight, logisticsFee };
    });

    return { totalLogisticsFee, totalWeight: useOverride ? weightOverride : autoTotalWeight, groups: planGroups };
  },

  // Creates one order row per seller group, decrements stock (of the
  // specific variant when one was selected, otherwise the base product),
  // and awards referral commission per sub-order. Runs in a single
  // transaction so a partial multi-seller checkout can never be left
  // half-written.
  async createFromCart(cartItems, customer, delivery) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const plan = this.computeDeliveryPlan(cartItems, delivery.destCounty, delivery.type, delivery.weightOverride);
      const createdOrders = [];

      for (const group of plan.groups) {
        const orderNumber = generateOrderNumber();
        const trackingNumber = generateTrackingNumber();
        // Delivery is already paid for via each product's baked-in price -
        // the buyer is never charged group.logisticsFee on top. total is
        // simply the sum of already-inclusive product prices.
        const total = group.subtotal;
        const sellerEarnings = group.sellerSubtotal;
        const commission = group.subtotal - sellerEarnings; // KenLynk's actual take: commission + delivery fee, combined

        const [result] = await conn.query(
          `INSERT INTO orders
            (order_number, tracking_number, seller_id, customer_user_id, customer_name, customer_phone,
             customer_id_number, customer_address, status, delivery_type, delivery_address,
             origin_county, dest_county, dest_area, weight_kg, delivery_fee, subtotal, total,
             commission, commission_total, seller_earnings, referral_code, pickup_date)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [orderNumber, trackingNumber, group.sellerId, customer.userId || null, customer.name, customer.phone,
           customer.idNumber, customer.address || null, 'Pending Payment',
           delivery.type, delivery.type === 'delivery' ? delivery.address : null,
           group.county, delivery.destCounty, delivery.destArea || null, group.weight, group.deliveryFeeTotal,
           group.subtotal, total, commission, group.commissionTotal, sellerEarnings,
           delivery.referralCode || null, delivery.pickupDate || null]
        );
        const orderId = result.insertId;

        // Starts the audit trail from the very beginning - from_status
        // NULL specifically marks "this is when the order was created",
        // distinct from a real transition between two statuses. Orders
        // now genuinely stay in Pending Payment from here - createFromCart
        // is called at checkout initiation (before payment), and only the
        // payment webhook (via OrderStatus.transition) moves an order to
        // Paid once M-Pesa actually confirms.
        await conn.query(
          'INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_type, notes) VALUES (?,?,?,?,?)',
          [orderId, null, 'Pending Payment', 'system', 'Order created at checkout']
        );

        for (const item of group.items) {
          // Same wholesale-tier price used for the group's subtotal above -
          // recorded here too, so order history shows what was actually
          // charged per unit, not the regular price the buyer didn't pay.
          const chargedUnitPrice = getFinalUnitPrice(item);
          const regularUnitPrice = Number(item.price) || 0;
          const ratio = regularUnitPrice > 0 ? chargedUnitPrice / regularUnitPrice : 1;
          const chargedSellerPrice = Number(item.seller_price != null ? item.seller_price : item.price) * ratio;

          // variant_id/variant_name/variant_sku restore which exact
          // option (colour, size, etc) was ordered - this was dropped in
          // an earlier revision of this file and is fixed here.
          await conn.query(
            `INSERT INTO order_items
              (order_id, product_id, product_name, qty, price, seller_price, variant_id, variant_name, variant_sku)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [orderId, item.id, item.name, item.qty, chargedUnitPrice,
             chargedSellerPrice,
             item.variant_id || null, item.variant_name || null, item.variant_sku || null]
          );
          // Decrement the specific variant's stock when one was ordered,
          // otherwise the base product's stock - matches how cart.js
          // already reads stock (COALESCE(v.stock, p.stock)).
          if (item.variant_id) {
            await conn.query('UPDATE product_variants SET stock = GREATEST(0, stock - ?) WHERE id = ?', [item.qty, item.variant_id]);
          } else {
            await conn.query('UPDATE products SET stock = GREATEST(0, stock - ?) WHERE id = ?', [item.qty, item.id]);
          }
        }

        // Referral commission, evaluated per sub-order (matches the website:
        // each seller's order is checked against the threshold independently).
        if (delivery.referralCode && total > REFERRAL_MIN_ORDER_TOTAL) {
          const [[referrer]] = await conn.query('SELECT id FROM users WHERE referral_code = ?', [delivery.referralCode]);
          if (referrer && referrer.id !== customer.userId) {
            const commissionAmt = Math.round(total * REFERRAL_COMMISSION_RATE);
            await conn.query(
              'INSERT INTO referral_earnings (referrer_id, referred_user_id, order_id, order_total, commission) VALUES (?,?,?,?,?)',
              [referrer.id, customer.userId || null, orderId, total, commissionAmt]
            );
          }
        }

        createdOrders.push({
          id: orderId, order_number: orderNumber, tracking_number: trackingNumber,
          seller_id: group.sellerId, total,
          itemsSummary: group.items.map(i => `${i.name}${i.variant_name ? ' (' + i.variant_name + ')' : ''} x${i.qty}`).join(', '),
          deliveryType: delivery.type, destCounty: delivery.destCounty, destArea: delivery.destArea
        });
      }

      await conn.commit();

      // Notify each seller AND admin now that the order is genuinely
      // committed - done after commit, not inside the transaction, so a
      // rollback can never leave a "ghost" notification for an order
      // that doesn't actually exist. Both messages carry the full
      // details (order number, buyer, items, delivery) alongside the
      // order number itself, so either party can follow up on anything
      // using just that one reference code - no need to dig through the
      // dashboard to find the details behind it.
      for (const created of createdOrders) {
        const deliveryLine = created.deliveryType === 'delivery'
          ? `Delivery to ${created.destArea ? created.destArea + ', ' : ''}${created.destCounty}`
          : 'Customer pickup';
        const detailMessage = `Order #${created.order_number} - ${customer.name} (${customer.phone}). ` +
          `Items: ${created.itemsSummary}. ${deliveryLine}. Total: KES ${Number(created.total).toLocaleString()}.`;

        if (created.seller_id) {
          try {
            await Notification.create(created.seller_id, {
              title: '🛒 New Order!',
              message: detailMessage,
              type: 'new_order'
            });
          } catch (notifyErr) {
            console.error('Failed to notify seller of new order:', notifyErr.message);
          }
        }

        try {
          await AdminNotification.create({
            title: `🛒 New Order #${created.order_number}`,
            message: detailMessage,
            type: 'new_order',
            orderId: created.id
          });
        } catch (notifyErr) {
          console.error('Failed to notify admin of new order:', notifyErr.message);
        }

        // SMS is layered on top of the in-app notification above, never
        // a replacement for it - a failed/unconfigured SMS provider
        // never blocks or affects order creation (see smsService.js).
        await sendAdminOrderSms(
          `KenLynk: New order #${created.order_number}. ${customer.name} (${customer.phone}). Total KES ${Number(created.total).toLocaleString()}.`
        );
      }

      return createdOrders;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
    if (!rows.length) return null;
    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [id]);
    return { ...rows[0], items };
  },

  async findByTrackingNumber(trackingNumber) {
    const [rows] = await pool.query('SELECT * FROM orders WHERE tracking_number = ?', [trackingNumber]);
    if (!rows.length) return null;
    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [rows[0].id]);
    return { ...rows[0], items };
  },

  async findBySeller(sellerId, { status, limit = 50, offset = 0 } = {}) {
    let sql = 'SELECT * FROM orders WHERE seller_id = ?';
    const params = [sellerId];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY placed_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const [rows] = await pool.query(sql, params);
    return rows;
  },

  async findByCustomerPhone(phone) {
    const [rows] = await pool.query('SELECT * FROM orders WHERE customer_phone = ? ORDER BY placed_at DESC', [phone]);
    return rows;
  },

  // A logged-in customer's full order history across every seller, each
  // with its own line items - used by GET /api/orders/customer/mine.
  async findByCustomerUserId(userId) {
    const [orderRows] = await pool.query('SELECT * FROM orders WHERE customer_user_id = ? ORDER BY placed_at DESC', [userId]);
    for (const order of orderRows) {
      const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
      order.items = items;
    }
    return orderRows;
  },

  async findAllForAdmin({ status, sellerId, limit = 50, offset = 0 } = {}) {
    let sql = `SELECT o.*, u.business_name AS seller_business_name, u.email AS seller_email FROM orders o
               LEFT JOIN users u ON u.id = o.seller_id WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND o.status = ?'; params.push(status); }
    if (sellerId) { sql += ' AND o.seller_id = ?'; params.push(sellerId); }
    sql += ' ORDER BY o.placed_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const [rows] = await pool.query(sql, params);
    for (const order of rows) {
      const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
      order.items = items;
    }
    return rows;
  },

  async countSince(sinceTimestamp) {
    const [rows] = await pool.query('SELECT COUNT(*) AS count FROM orders WHERE placed_at > ?', [sinceTimestamp]);
    return rows[0].count;
  },

  // Every status change goes through OrderStatus.transition(), which
  // validates the move is legal for this actor and records it in
  // order_status_history - this function is kept as a thin, actor-aware
  // wrapper so existing callers only need to add who's making the change.
  async updateStatus(id, status, actor = { actorType: 'admin' }) {
    const OrderStatus = require('./orderStatus');
    return OrderStatus.transition(id, status, actor);
  },

  // Assigning a rider means the order is now actually moving - this maps
  // to the "Out for Delivery" transition rather than setting status
  // directly, so it goes through the same validation/history as every
  // other status change (only legal from "Ready for Delivery").
  async assignRider(id, { name, phone, photo }, actor = { actorType: 'admin' }) {
    await pool.query(
      `UPDATE orders SET rider_name = ?, rider_phone = ?, rider_photo = ?, rider_assigned_at = NOW() WHERE id = ?`,
      [name, phone, photo || null, id]
    );
    const OrderStatus = require('./orderStatus');
    try {
      await OrderStatus.transition(id, 'Out for Delivery', { ...actor, notes: `Rider assigned: ${name}` });
    } catch (err) {
      // Rider info is still saved even if the order wasn't in a state
      // that allows moving to "Out for Delivery" yet (e.g. already
      // further along) - don't let that block assigning the rider.
    }
  },

  // Generates a fresh 6-digit delivery OTP, texts it to the customer,
  // and stores it against the order - called when a seller/admin marks
  // an order "Out for Delivery" (or any time before, e.g. re-sending a
  // code the customer says they never got). Does NOT transition status
  // itself; it's independent of where the order currently sits, so a
  // seller can regenerate/resend without accidentally forcing a status
  // change. Overwrites any previous code - only the latest one sent is
  // ever valid, so an old SMS lying around can't be replayed.
  async generateDeliveryOtp(id) {
    const order = await this.findById(id);
    if (!order) throw new Error('Order not found.');

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await pool.query(
      'UPDATE orders SET delivery_otp = ?, otp_generated_at = NOW(), otp_verified_at = NULL WHERE id = ?',
      [code, id]
    );

    await sendCustomerSms(
      order.customer_phone,
      `Your KenLynk delivery verification code for order #${order.order_number} is ${code}. Give this to your rider only once you've received your order.`
    );

    return { sent: true };
  },

  // Called by the seller/admin app when the rider reports the code the
  // customer read out to them. On a match: stamps otp_verified_at,
  // transitions Out for Delivery -> Delivered, then immediately chains
  // Delivered -> Awaiting Admin Confirmation (actorType 'system', since
  // this second hop isn't really a new decision by the person entering
  // the code - it's the automatic consequence of a verified delivery,
  // per orderStatus.js's TRANSITIONS). Throws on a wrong/missing code
  // without touching status at all, so a mistyped code never silently
  // half-completes a delivery.
  async verifyDeliveryOtp(id, code, actor = { actorType: 'admin' }) {
    const order = await this.findById(id);
    if (!order) throw new Error('Order not found.');
    if (!order.delivery_otp) throw new Error('No delivery code has been generated for this order yet.');
    if (String(code).trim() !== String(order.delivery_otp)) throw new Error('That code does not match. Please check with the customer and try again.');

    await pool.query('UPDATE orders SET otp_verified_at = NOW() WHERE id = ?', [id]);

    const OrderStatus = require('./orderStatus');
    const toDelivered = await OrderStatus.transition(id, 'Delivered', { ...actor, notes: 'Delivery OTP verified' });
    const toAwaiting = await OrderStatus.transition(id, 'Awaiting Admin Confirmation', { actorType: 'system', notes: 'Auto-advanced after OTP verification' });

    return { deliveredResult: toDelivered, awaitingResult: toAwaiting };
  },

  // Customer confirming they received their order - this does NOT
  // complete the order (only admin can do that, from Awaiting Admin
  // Confirmation - see orderStatus.js). It only stamps a timestamp the
  // admin sees in their review panel alongside "rider marked delivered"
  // and "OTP verified", as one more signal supporting the admin's own
  // final decision.
  async markCustomerConfirmed(id, userId) {
    const order = await this.findById(id);
    if (!order || order.customer_user_id !== userId) return null;
    await pool.query('UPDATE orders SET customer_confirmed_at = NOW() WHERE id = ?', [id]);
    return { confirmed: true };
  },

  // Called by seller/admin when a rider couldn't complete the delivery -
  // captures the reason as a plain note on the transition itself
  // (order_status_history.notes), rather than as a separate status per
  // reason. Doesn't touch the delivery_otp - a subsequent retry (see
  // the Delivery Failed -> Out for Delivery transition in
  // orderStatus.js) can reuse the existing code if it hasn't expired,
  // or the seller/admin can call generateDeliveryOtp again for a fresh one.
  async markDeliveryFailed(id, reason, actor) {
    const OrderStatus = require('./orderStatus');
    return OrderStatus.transition(id, 'Delivery Failed', { ...actor, notes: reason || 'Delivery attempt failed' });
  },

  // Customer requesting a return on a Completed order - stores the
  // reason on the order itself (not just in history) so it's easy for
  // admin's return-review UI to show without joining back to the
  // history table.
  async requestReturn(id, userId, reason) {
    const order = await this.findById(id);
    if (!order || order.customer_user_id !== userId) return null;
    await pool.query('UPDATE orders SET return_reason = ? WHERE id = ?', [reason || null, id]);
    const OrderStatus = require('./orderStatus');
    return OrderStatus.transition(id, 'Return Requested', { actorType: 'customer', actorId: userId, notes: reason });
  },

  // Admin finalizing a refund - records the actual amount refunded
  // (which may be less than the full order total, e.g. a partial
  // refund) alongside the status transition. amount is required and
  // validated against the order's own total so a typo can't refund
  // more than the customer ever paid.
  async processRefund(id, amount, actor, notes) {
    const order = await this.findById(id);
    if (!order) throw new Error('Order not found.');
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) throw new Error('A valid refund amount is required.');
    if (numAmount > Number(order.total)) throw new Error(`Refund amount cannot exceed the order total (KES ${order.total}).`);

    await pool.query('UPDATE orders SET refund_amount = ? WHERE id = ?', [numAmount, id]);
    const OrderStatus = require('./orderStatus');
    return OrderStatus.transition(id, 'Refunded', { ...actor, notes: notes || `Refunded KES ${numAmount}` });
  },

  // Delivery rating is intentionally independent of whether a rider was
  // ever assigned - a Pickup order has none, but still had an experience
  // worth rating (product condition, speed, how the order was handled).
  async rateDelivery(id, rating, remarks) {
    await pool.query(
      'UPDATE orders SET delivery_rating = ?, delivery_remarks = ?, delivery_rated_at = NOW() WHERE id = ?',
      [rating, remarks || null, id]
    );
  },

  // Only Completed orders count toward a seller's payable balance.
  // Cancels a Pending Payment order and releases whatever stock it had
  // reserved back to the product/variant - used when a payment fails
  // outright, or when a Pending Payment order has sat unpaid too long
  // (see releaseStalePendingOrders below). Only ever touches orders
  // still in Pending Payment - once paid, cancelling goes through the
  // normal seller/admin transition instead, which does NOT restock
  // automatically (a paid, cancelled order needs a human decision about
  // whether stock should return).
  async cancelUnpaidOrder(orderId, notes = 'Payment failed or was never completed') {
    const OrderStatus = require('./orderStatus');
    const order = await this.findById(orderId);
    if (!order || order.status !== 'Pending Payment') return null;

    for (const item of order.items) {
      if (item.variant_id) {
        await pool.query('UPDATE product_variants SET stock = stock + ? WHERE id = ?', [item.qty, item.variant_id]);
      } else {
        await pool.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.qty, item.product_id]);
      }
    }

    return OrderStatus.transition(orderId, 'Cancelled', { actorType: 'system', notes });
  },

  // Safety net for abandoned checkouts - an order sitting in Pending
  // Payment for longer than maxAgeMinutes almost certainly means the
  // customer closed the tab or the STK push was never completed. Called
  // periodically (see server.js) rather than relying only on IntaSend's
  // webhook, since a webhook can be missed or never arrive.
  async releaseStalePendingOrders(maxAgeMinutes = 30) {
    const [rows] = await pool.query(
      `SELECT id FROM orders WHERE status = 'Pending Payment' AND placed_at < NOW() - INTERVAL ? MINUTE`,
      [maxAgeMinutes]
    );
    let released = 0;
    for (const row of rows) {
      try {
        await this.cancelUnpaidOrder(row.id, `Auto-cancelled - unpaid for over ${maxAgeMinutes} minutes`);
        released++;
      } catch (err) {
        console.error(`Could not auto-cancel stale order ${row.id}:`, err.message);
      }
    }
    return { checked: rows.length, released };
  },

  async sumPayableEarnings(sellerId) {
    const [rows] = await pool.query(
      `SELECT COALESCE(SUM(seller_earnings), 0) AS total FROM orders WHERE seller_id = ? AND status = 'Completed'`,
      [sellerId]
    );
    return Number(rows[0].total);
  },

  async sumPendingEarnings(sellerId) {
    const [rows] = await pool.query(
      `SELECT COALESCE(SUM(seller_earnings), 0) AS total FROM orders WHERE seller_id = ? AND status NOT IN ('Completed','Cancelled')`,
      [sellerId]
    );
    return Number(rows[0].total);
  }
};

module.exports = Order;
