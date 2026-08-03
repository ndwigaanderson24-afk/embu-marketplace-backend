require('dotenv').config();
const pool = require('./db');

async function main() {
  const [rows] = await pool.query(
    'SELECT id, name, email, is_super_admin, created_at FROM admins ORDER BY id ASC'
  );
  if (!rows.length) {
    console.log('No admin accounts found.');
    process.exit(0);
  }
  console.log(`\nFound ${rows.length} admin account(s):\n`);
  rows.forEach(a => {
    console.log(`id ${a.id} | ${a.name} <${a.email}> | ${a.is_super_admin ? 'SUPER ADMIN' : 'admin'} | created ${a.created_at}`);
  });
  console.log('');
  process.exit(0);
}

main().catch(err => {
  console.error('Failed to list admins:', err.message);
  process.exit(1);
});