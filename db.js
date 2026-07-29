// db.js
// Shared MySQL connection pool. Import as `const pool = require('./db')`
// and use `await pool.query(...)` anywhere.

const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'embu_marketplace',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  // Hosted databases like Aiven require an encrypted connection. Set
  // DB_SSL=true in .env to enable it (leave unset/false for local XAMPP,
  // which doesn't use SSL). rejectUnauthorized:false accepts Aiven's
  // certificate without needing to download and reference their CA file
  // separately - fine for this project's current scale.
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

// Fails fast at startup if the DB is unreachable, instead of only
// discovering it on the first real request.
async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL connected:', process.env.DB_NAME);
    conn.release();
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = pool;
module.exports.testConnection = testConnection;
