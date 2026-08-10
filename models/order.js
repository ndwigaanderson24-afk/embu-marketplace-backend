// models/order.js
// Mirrors embu-marketplace.html's checkout logic: a cart spanning several
// sellers is split into one order row PER SELLER, each with its own
// delivery fee computed from THAT seller's county.

const pool = require('../db');
const {
  generateOrderNumber, generateTrackingNumber, calculateDeliveryFee,
  PLATFORM_DEFAULT_COUNTY, REFERRAL_COMMISSION_RATE, REFERRAL_MIN_ORDER_TOTAL
} = require('../helpers');

const Order = {
  // Groups cart rows (each already joined to its product) by seller,
  // computing each group's own weight/subtotal - the shared foundation
  // for both a price preview and the actual order-splitting below.
  groupCartBySeller(cartItems) {
    const groups = {};
    cartItems.forEach(item => {
      const sellerKey = item.seller_id || 'platform';
      const county = item.county || PLATFORM_DEFAULT_COUNTY;
      if (!groups[sellerKey]) {
        groups[sellerKey] = { sellerId: item.seller_id || null, county, items: [], weight: 0, subtotal: 0 };
      }
      groups[sellerKey].items.push(item);
      groups[sellerKey].weight += Number(item.weight || 1) * item.qty;
      groups[sellerKey].subtotal += Number(item.price) * item.qty;
    });
    return Object.values(groups);
  },

  // Full pricing preview for the cart page - same math as checkout, but
  // without writing anything, so the frontend can show a live total.
  computeDeliveryPlan(cartItems, destCounty, deliveryType, weightOverride) {
    const groups = this.groupCartBySeller(cartItems);
    const autoTotalWeight = groups.reduce((s, g) => s + g.weight, 0);
    const useOverride = typeof weightOverride === 'number' && weightOverride > 0;
    const scale = useOverride && autoTotalWeight > 0 ? weightOverride / autoTotalWeight : 1;

    let totalFee = 0;
    const planGroups = groups.map(g => {
      const weight = useOverride ? (autoTotalWeight > 0 ? g.weight * scale : weightOverride / groups.length) : g.weight;
      const fee = calculateDeliveryFee(weight, g.county, destCounty, deliveryType);
      totalFee += fee;
      return { ...g, weight, fee };
    });

    return { totalFee, totalWeight: useOverride ? weightOverride : autoTotalWeight, groups: planGroups };
  },

  // Creates one order row per seller group, decrements stock, and awards
  // referral commission per sub-order. Runs in a single transaction so a
  // partial multi-seller checkout can never be left half-written.
  async createFromCart(cartItems, customer, delivery) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const plan = this.computeDeliveryPlan(cartItems, delivery.destCounty, delivery.type, delivery.weightOverride);
      const createdOrders = [];

      for (const group of plan.groups) {
        const orderNumber = generateOrderNumber();
        const trackingNumber = generateTrackingNumber();
        const commissionRate = delivery.type === 'pickup' ? 0.05 : 0.08;
        const commission = group.subtotal * commissionRate;
        const sellerEarnings = group.subtotal - commission;
        const total = group.subtotal + group.fee;

        const [result] = await conn.query(
          `INSERT INTO orders
            (order_number, tracking_number, seller_id, customer_user_id, customer_name, customer_phone,
             customer_id_number, customer_address, status, delivery_type, delivery_address,
             origin_county, dest_county, dest_area, weight_kg, delivery_fee, subtotal, total,
             commission, seller_earnings, referral_code, pickup_date)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [orderNumber, trackingNumber, group.sellerId, customer.userId || null, customer.name, customer.phone,
           customer.idNumber, customer.address || null, delivery.pickupDate ? 'Booked' : 'Pending',
           delivery.type, delivery.type === 'delivery' ? delivery.address : null,
           group.county, delivery.destCounty, delivery.destArea || null, group.weight, group.fee,
           group.subtotal, total, commission, sellerEarnings, delivery.referralCode || null, delivery.pickupDate || null]
        );
        const orderId = result.insertId;

        for (const item of group.items) {
          await conn.query(
            'INSERT INTO order_items (order_id, product_id, variant_id, variant_name, variant_sku, product_name, qty, price) VALUES (?,?,?,?,?,?,?,?)',
            [orderId, item.id, item.variant_id || null, item.variant_name || null, item.variant_sku || null, item.name, item.qty, item.price]
          );
          // A variant (e.g. a specific colour) has its own stock, tracked
          // separately from the base product's - decrement whichever one
          // actually applies to what was bought.
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

        createdOrders.push({ id: orderId, order_number: orderNumber, tracking_number: trackingNumber, seller_id: group.sellerId, total });
      }

      await conn.commit();
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

  // The 6-stage lifecycle: Pending -> Accepted -> Packed -> In Transit ->
  // Delivered -> Completed. Sellers are only paid once Completed (see
  // Order.sumPayableEarnings).
  async updateStatus(id, status) {
    const valid = ['Booked', 'Pending', 'Accepted', 'Packed', 'In Transit', 'Delivered', 'Completed', 'Cancelled'];
    if (!valid.includes(status)) throw new Error(`Invalid status: ${status}`);
    await pool.query('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
  },

  async assignRider(id, { name, phone, photo }) {
    await pool.query(
      `UPDATE orders SET rider_name = ?, rider_phone = ?, rider_photo = ?, rider_assigned_at = NOW(), status = 'Accepted' WHERE id = ?`,
      [name, phone, photo || null, id]
    );
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
