require('dotenv').config();
const pool = require('./db');
const Admin = require('./models/admin');

async function main() {
  const [idArg] = process.argv.slice(2);
  const id = Number(idArg);
  if (!id) {
    console.log('Usage: node deleteAdminById.js <id>');
    process.exit(1);
  }

  const admin = await Admin.findById(id);
  if (!admin) {
    console.log(`No admin found with id ${id}. Nothing to do.`);
    process.exit(0);
  }

  await Admin.delete(id);
  console.log(`✅ Deleted admin: ${admin.name} <${admin.email}> (id ${id})`);
  process.exit(0);
}

main().catch(err => {
  console.error('Failed to delete admin:', err.message);
  process.exit(1);
});