// =====================================================================
// rfid_simulator.js
// จำลองเครื่องอ่าน RFID: สุ่มเลือก EPC 1-5 ชิ้นจาก rfid_tags แล้ว
// POST ไปที่ /api/rfid/scan ทุก 3 วินาที (กด Ctrl+C เพื่อหยุด)
// =====================================================================
require('dotenv').config();

const { pool } = require('../config/db');

const API_URL = process.env.RFID_SCAN_URL || 'http://localhost:3000/api/rfid/scan';
const INTERVAL_MS = 3000;

let epcPool = []; // EPC codes ที่โหลดจากฐานข้อมูล

// สุ่มจำนวน 1-5 และเลือก EPC แบบไม่ซ้ำ
function pickRandomEpcs() {
  const count = Math.floor(Math.random() * 5) + 1;
  const shuffled = [...epcPool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

async function scanOnce() {
  const epcs = pickRandomEpcs();
  const ts = new Date().toLocaleTimeString();

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epc_codes: epcs, reader_id: 'SIM-READER-01' }),
    });

    const data = await res.json();
    console.log(`\n[${ts}] 📡 สแกน ${epcs.length} ชิ้น: ${epcs.join(', ')}`);

    if (Array.isArray(data.matched) && data.matched.length) {
      data.matched.forEach((m) => {
        console.log(`   ✅ ${m.epc_code} → ${m.product_name} (${m.sku}) [${m.status}]`);
      });
    }
    if (Array.isArray(data.unknown) && data.unknown.length) {
      data.unknown.forEach((u) => console.log(`   ❓ ${u} → ไม่พบในระบบ`));
    }
  } catch (err) {
    console.error(`\n[${ts}] ❌ ส่งไม่สำเร็จ: ${err.message}`);
    console.error('   (เซิร์ฟเวอร์รันอยู่หรือไม่? ลอง npm run dev)');
  }
}

async function main() {
  const { rows } = await pool.query(
    "SELECT epc_code FROM rfid_tags WHERE status = 'active' ORDER BY epc_code"
  );
  epcPool = rows.map((r) => r.epc_code);

  if (epcPool.length === 0) {
    console.error('❌ ไม่พบ RFID tags ในฐานข้อมูล — รัน 002_seed_data.sql ก่อน');
    await pool.end();
    process.exit(1);
  }

  console.log(`🏷️  โหลด ${epcPool.length} EPC จากฐานข้อมูล`);
  console.log(`🎯 ปลายทาง: ${API_URL}`);
  console.log(`⏱️  สแกนทุก ${INTERVAL_MS / 1000} วินาที — กด Ctrl+C เพื่อหยุด`);

  await scanOnce();
  const timer = setInterval(scanOnce, INTERVAL_MS);

  process.on('SIGINT', async () => {
    clearInterval(timer);
    console.log('\n\n🛑 หยุดการจำลอง RFID');
    await pool.end();
    process.exit(0);
  });
}

main();
