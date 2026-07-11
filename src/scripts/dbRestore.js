// =====================================================================
// dbRestore.js — กู้คืนฐานข้อมูลจากไฟล์ .sql ที่ได้จาก db:backup
//   ใช้: npm run db:restore <path ไฟล์.sql>
//   ⚠️ ต้องสร้าง database เปล่าชื่อ mcs_backend ไว้ก่อน (createdb) แล้วค่อย restore
//   ⚠️ ทับข้อมูลเดิมในเครื่องนี้ — ใช้บนเครื่องใหม่/ที่ยอมให้ข้อมูลถูกแทนที่
// =====================================================================
require('dotenv').config();

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function findTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const bases = ['C:/Program Files/PostgreSQL', 'C:/Program Files (x86)/PostgreSQL'];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    for (const v of fs.readdirSync(base).sort().reverse()) {
      const p = path.join(base, v, 'bin', exe);
      if (fs.existsSync(p)) return p;
    }
  }
  return name;
}

const file = process.argv[2];
if (!file) { console.error('ใช้: npm run db:restore <path ไฟล์.sql>'); process.exit(1); }
if (!fs.existsSync(file)) { console.error(`ไม่พบไฟล์: ${file}`); process.exit(1); }

const cfg = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || '5432',
  user: process.env.DB_USER || 'postgres',
  name: process.env.DB_NAME || 'mcs_backend',
  pass: process.env.DB_PASSWORD || '',
};

console.log(`♻️  กำลังกู้คืน "${file}" → ฐานข้อมูล "${cfg.name}" (${cfg.host})`);
try {
  execFileSync(
    findTool('psql'),
    ['-h', cfg.host, '-p', cfg.port, '-U', cfg.user, '-d', cfg.name, '-v', 'ON_ERROR_STOP=1', '-f', file],
    { env: { ...process.env, PGPASSWORD: cfg.pass }, stdio: 'inherit' }
  );
  console.log('✅ กู้คืนสำเร็จ');
} catch (e) {
  console.error('❌ กู้คืนไม่สำเร็จ:', e.message);
  process.exit(1);
}
