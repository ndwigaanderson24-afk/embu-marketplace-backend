// createAdmin.js
// Run this once per admin you want to add - starting with yourself, since
// after the migration there are ZERO admin accounts and no way to create
// the first one through the app itself.
//
// Usage:
//   node createAdmin.js "Full Name" "email@example.com" "password"
//   node createAdmin.js "Full Name" "email@example.com" "password" super
//
// Add "super" as a 4th argument to make them a super admin - the only
// role that can add or remove other admin accounts. Everyone else gets
// normal admin dashboard access but can't manage admin accounts.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');
const Admin = require('./models/admin');

async function main() {
  const [name, email, password, roleFlag] = process.argv.slice(2);
  const isSuperAdmin = roleFlag === 'super';

  if (!name || !email || !password) {
    console.log('Usage: node createAdmin.js "Full Name" "email@example.com" "password" [super]');
    process.exit(1);
  }
  if (password.length < 6) {
    console.log('Password must be at least 6 characters.');
    process.exit(1);
  }

  const existing = await Admin.findByEmail(email);
  if (existing) {
    console.log(`An admin with email ${email} already exists (id ${existing.id}). Nothing to do.`);
    process.exit(0);
  }

  const password_hash = await bcrypt.hash(password, 10);
  const id = await Admin.create({ name, email, password_hash, is_super_admin: isSuperAdmin });
  console.log(`✅ Admin created: ${name} <${email}> (id ${id})${isSuperAdmin ? ' [SUPER ADMIN]' : ''}`);
  console.log('   They can now log in through the app using this email and password.');
  process.exit(0);
}

main().catch(err => {
  console.error('Failed to create admin:', err.message);
  process.exit(1);
});
