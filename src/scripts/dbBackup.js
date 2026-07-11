// =====================================================================
// dbBackup.js — สำรองฐานข้อมูลทั้งก้อน (โครงสร้าง + ข้อมูล) เป็นไฟล์ .sql
//   ใช้: npm run db:backup
//   ได้ไฟล์: ../backups/mcs_backend_<YYYYMMDD-HHmm>.sql  (นอก git)
//   เอาไฟล์นี้ไป restore ที่เครื่องอื่นด้วย: npm run db:restore <ไฟล์>
// =====================================================================
require('dotenv').config();

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// หา pg_dump: ลอง PATH ก่อน แล้วค่อยไล่หาในโฟลเดอร์ PostgreSQL (เผื่อไม่อยู่ใน PATH)
function findTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const bases = ['C:/Program Files/PostgreSQL', 'C:/Program Files (x86)/PostgreSQL'];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const versions = fs.readdirSync(base).sort().reverse(); // เวอร์ชันใหม่สุดก่อน
    for (const v of versions) {
      const p = path.join(base, v, 'bin', exe);
      if (fs.existsSync(p)) return p;
    }
  }
  return name; // ใช้จาก PATH
}

const cfg = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || '5432',
  user: process.env.DB_USER || 'postgres',
  name: process.env.DB_NAME || 'mcs_backend',
  pass: process.env.DB_PASSWORD || '',
};

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2');
const dir = path.resolve(__dirname, '../../..', 'backups');
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, `${cfg.name}_${stamp}.sql`);

console.log(`📦 กำลังสำรองฐานข้อมูล "${cfg.name}" → ${out}`);
try {
  execFileSync(
    findTool('pg_dump'),
    ['-h', cfg.host, '-p', cfg.port, '-U', cfg.user, '-d', cfg.name, '--no-owner', '--no-privileges', '-f', out],
    { env: { ...process.env, PGPASSWORD: cfg.pass }, stdio: 'inherit' }
  );
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`✅ สำรองสำเร็จ (${kb} KB)\n   ไฟล์นี้เอาไปเครื่องอื่นแล้ว restore ด้วย: npm run db:restore "${out}"`);
} catch (e) {
  console.error('❌ สำรองไม่สำเร็จ:', e.message);
  process.exit(1);
}
