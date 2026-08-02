// server.js
// Entry point. Run with `npm start` (or `npm run dev` for auto-reload).

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const pool = require('./db');

const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const cartRoutes = require('./routes/cartRoutes');
const adminRoutes = require('./routes/adminRoutes');
const withdrawalRoutes = require('./routes/withdrawalRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

const app = express();

app.use(helmet());
// Accepts requests from local dev addresses (localhost, 127.0.0.1, LAN IPs)
// AND from the live Netlify frontend. Add any future custom domain to
// allowedOrigins below if you attach one to Netlify later.
const allowedOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/;
const allowedOrigins = [
  'https://comfy-pudding-4cf9eb.netlify.app',
  'https://kenlynk.com',
  'https://www.kenlynk.com'
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOriginPattern.test(origin) || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));
app.use('/api/auth/', rateLimit({
  // Temporarily raised from 20 to 100 while actively testing/developing.
  // Tighten this back down to a lower number (e.g. 20) before real users
  // are on the site, to keep the brute-force protection meaningful.
  windowMs: 15 * 60 * 1000, max: 100,
  message: { success: false, message: 'Too many attempts. Please try again later.' }
}));

// Serve uploaded documents/product images, e.g. GET /uploads/products/169999-abc.jpg
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => res.json({ success: true, message: 'Embu Marketplace API is running.' }));

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/payments', paymentRoutes);

// 404
app.use((req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` }));

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  if (process.env.NODE_ENV !== 'production') console.error(err.stack);
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'A record with this value already exists.' });
  res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error.' });
});

const PORT = process.env.PORT || 5000;

(async () => {
  await pool.testConnection();
  app.listen(PORT, () => {
    console.log(`🚀 Embu Marketplace API running on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
  });
})();

module.exports = app;
