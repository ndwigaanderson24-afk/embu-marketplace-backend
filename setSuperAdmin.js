// setSuperAdmin.js
// Promotes (or demotes) an already-existing admin account. Use this for
// Anderson, since his account already existed before super-admin support
// was added - createAdmin.js's "super" flag only applies to brand new
// accounts.
//
// Usage:
//   node setSuperAdmin.js "email@example.com" on
//   node setSuperAdmin.js "email@example.com" off

require('dotenv').config();
const pool = require('./db');
const Admin = require('./models/admin');

async function main() {
  const [email, mode] = process.argv.slice(2);

  if (!email || !['on', 'off'].includes(mode)) {
    console.log('Usage: node setSuperAdmin.js "email@example.com" on|off');
    process.exit(1);
  }

  const admin = await Admin.findByEmail(email);
  if (!admin) {
    console.log(`No admin found with email ${email}.`);
    process.exit(1);
  }

  await Admin.setSuperAdmin(admin.id, mode === 'on');
  console.log(`✅ ${admin.name} <${email}> is ${mode === 'on' ? 'now a super admin' : 'no longer a super admin'}.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Failed to update admin:', err.message);
  process.exit(1);
});
