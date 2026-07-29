// updateAdmin.js
// Updates an existing admin account's name and/or password, without
// deleting and recreating it (which would change their id and could break
// any records that reference it later).
//
// Usage:
//   node updateAdmin.js "email@example.com" "New Name" "newPassword"
//
// Leave a field as "-" to keep it unchanged, e.g. to only change the
// password and keep the existing name:
//   node updateAdmin.js "email@example.com" "-" "newPassword"

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');
const Admin = require('./models/admin');

async function main() {
  const [email, newName, newPassword] = process.argv.slice(2);

  if (!email || !newName || !newPassword) {
    console.log('Usage: node updateAdmin.js "email@example.com" "New Name" "newPassword"');
    console.log('       Use "-" for a field you want to leave unchanged.');
    process.exit(1);
  }

  const admin = await Admin.findByEmail(email);
  if (!admin) {
    console.log(`No admin found with email ${email}.`);
    process.exit(1);
  }

  const nameToUse = newName === '-' ? admin.name : newName;
  let passwordChanged = false;

  if (newName !== '-') {
    await pool.query('UPDATE admins SET name = ? WHERE id = ?', [nameToUse, admin.id]);
  }

  if (newPassword !== '-') {
    if (newPassword.length < 6) {
      console.log('Password must be at least 6 characters.');
      process.exit(1);
    }
    const password_hash = await bcrypt.hash(newPassword, 10);
    await Admin.updatePassword(admin.id, password_hash);
    passwordChanged = true;
  }

  console.log(`✅ Admin updated: ${nameToUse} <${email}> (id ${admin.id})`);
  if (passwordChanged) console.log('   Password changed - they should log in with the new one from now on.');
  process.exit(0);
}

main().catch(err => {
  console.error('Failed to update admin:', err.message);
  process.exit(1);
});
