// runSqlFile.js
// Runs a .sql file against your database using the mysql2 package your
// project already has installed - this exists because XAMPP's bundled
// mysql.exe client is too old to authenticate with Aiven's MySQL 8+
// (it's missing the caching_sha2_password plugin). This script has no
// such limitation, since mysql2 supports modern auth natively.
//
// Usage:
//   node runSqlFile.js sql/schema.sql
//   node runSqlFile.js sql/migration_add_admins_table.sql

require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.log('Usage: node runSqlFile.js <path-to-sql-file>');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    process.exit(1);
  }

  let sql = fs.readFileSync(filePath, 'utf8');

  // Aiven's free tier provides exactly one fixed database (defaultdb) and
  // doesn't allow creating additional ones - strip any CREATE DATABASE /
  // USE statements so the script's tables land in whatever database is
  // actually configured in .env (DB_NAME) instead of failing or silently
  // writing to a database you can't use.
  sql = sql.replace(/CREATE DATABASE[^;]*;/gi, '').replace(/USE\s+\w+\s*;/gi, '');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    multipleStatements: true
  });

  console.log(`Running ${filePath} against ${process.env.DB_HOST}...`);
  try {
    await connection.query(sql);
    console.log('✅ Done. No errors.');
  } catch (err) {
    console.error('❌ Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main();
