// รันไฟล์ .sql ผ่าน node (อ่านเป็น UTF-8 แล้วส่งตรงเข้า pg)
// ใช้แทน `psql -f` บน Windows เพื่อเลี่ยงปัญหา:
//   - PowerShell pipe แปลงภาษาไทยเป็น '?'
//   - psql อ่าน path ที่มีอักขระไทยไม่ได้
// usage: node src/scripts/runSql.js <path/to/file.sql>
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const file = process.argv[2];
if (!file) {
  console.error('usage: node src/scripts/runSql.js <file.sql>');
  process.exit(1);
}

(async () => {
  try {
    const sql = fs.readFileSync(path.resolve(file), 'utf8');
    await pool.query(sql);
    console.log(`✅ executed: ${file}`);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
