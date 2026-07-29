// seed.js
// Populates a fresh database with an admin-visible demo catalog (matching
// embu-marketplace.html's built-in products, seller_id = NULL = platform
// catalog) plus one approved+subscribed test seller so you have something
// to click through immediately after setup.
//
// Run with: npm run db:seed   (after sql/schema.sql has been applied)

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { generateReferralCode } = require('./helpers');

const DEMO_PRODUCTS = [
  { name: 'Avocado Basket (5kg)', category: 'produce', price: 500, weight: 5, emoji: '🥑', county: 'embu', stock: 40, hot: true },
  { name: 'Embu Coffee Beans (1kg)', category: 'produce', price: 900, weight: 1, emoji: '☕', county: 'embu', stock: 30, hot: true },
  { name: 'Fresh Mangoes (Crate)', category: 'produce', price: 1200, weight: 15, emoji: '🥭', county: 'embu', stock: 20 },
  { name: "Men's Ankara Shirt", category: 'fashion', price: 1500, weight: 0.5, emoji: '👔', county: 'nairobi', stock: 25 },
  { name: "Women's Kitenge Dress", category: 'fashion', price: 2200, weight: 0.6, emoji: '👗', county: 'nairobi', stock: 18 },
  { name: 'Leather Sandals', category: 'fashion', price: 1800, weight: 0.8, emoji: '👡', county: 'embu', stock: 15 },
  { name: 'Solar Lamp', category: 'electronics', price: 1200, weight: 0.4, emoji: '🔦', county: 'nairobi', stock: 22 },
  { name: 'Bluetooth Speaker', category: 'electronics', price: 2500, weight: 0.9, emoji: '🔊', county: 'nairobi', stock: 12, hot: true },
  { name: 'Woven Sisal Basket', category: 'home', price: 800, weight: 1.2, emoji: '🧺', county: 'embu', stock: 30 },
  { name: 'Handmade Clay Pot', category: 'home', price: 1100, weight: 2.5, emoji: '🏺', county: 'embu', stock: 10, fragile: true },
];

async function seed() {
  console.log('Seeding database...');

  // Demo/platform products (no seller attached)
  for (const p of DEMO_PRODUCTS) {
    await pool.query(
      `INSERT INTO products (seller_id, name, category, price, weight, emoji, county, stock, hot, fragile, status)
       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [p.name, p.category, p.price, p.weight, p.emoji, p.county, p.stock, !!p.hot, !!p.fragile]
    );
  }
  console.log(`  ✅ ${DEMO_PRODUCTS.length} demo products inserted.`);

  // One approved, subscribed test seller so there's something to log in as.
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', ['seller@example.com']);
  if (!existing.length) {
    const password_hash = await bcrypt.hash('Seller123!', 10);
    const [result] = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, referral_code, business_name, kra_pin, county,
         seller_status, subscription_status, subscription_start, subscription_end)
       VALUES (?,?,?,?,?,?,?,?, 'approved', 'active', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 6 MONTH))`,
      ['Demo Seller', 'seller@example.com', '0712345678', password_hash, generateReferralCode(),
       'Demo Seller Shop', 'A123456789B', 'embu']
    );
    console.log(`  ✅ Test seller created: seller@example.com / Seller123! (id ${result.insertId})`);
  } else {
    console.log('  ℹ️  Test seller already exists, skipping.');
  }

  // One plain customer for testing checkout/referrals.
  const [existingCustomer] = await pool.query('SELECT id FROM users WHERE email = ?', ['customer@example.com']);
  if (!existingCustomer.length) {
    const password_hash = await bcrypt.hash('Customer123!', 10);
    await pool.query(
      'INSERT INTO users (name, email, phone, password_hash, referral_code) VALUES (?,?,?,?,?)',
      ['Demo Customer', 'customer@example.com', '0722345678', password_hash, generateReferralCode()]
    );
    console.log('  ✅ Test customer created: customer@example.com / Customer123!');
  } else {
    console.log('  ℹ️  Test customer already exists, skipping.');
  }

  console.log('Seeding complete.');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
