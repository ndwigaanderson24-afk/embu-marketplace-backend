// models/review.js

const pool = require('../db');
const Product = require('./product');

const Review = {
  // A customer can review a product only from an order that reached
  // Delivered or Completed, and only once per order+product pair.
  async create({ order_id, product_id, customer_user_id, customer_name, rating, comment }) {
    const [result] = await pool.query(
      `INSERT INTO reviews (order_id, product_id, customer_user_id, customer_name, rating, comment, verified)
       VALUES (?,?,?,?,?,?,TRUE)`,
      [order_id, product_id, customer_user_id || null, customer_name, rating, comment || null]
    );
    await Product.addReview(product_id, rating);
    return result.insertId;
  },

  async findByProduct(productId) {
    const [rows] = await pool.query('SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC', [productId]);
    return rows;
  },

  async alreadyReviewed(orderId, productId) {
    const [rows] = await pool.query('SELECT id FROM reviews WHERE order_id = ? AND product_id = ?', [orderId, productId]);
    return rows.length > 0;
  },

  async findBySeller(sellerId) {
    const [rows] = await pool.query(
      `SELECT r.*, p.name AS product_name FROM reviews r
       JOIN products p ON p.id = r.product_id
       WHERE p.seller_id = ? ORDER BY r.created_at DESC`,
      [sellerId]
    );
    return rows;
  }
};

module.exports = Review;
