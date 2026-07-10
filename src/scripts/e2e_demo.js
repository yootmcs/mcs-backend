// =====================================================================
// e2e_demo.js — เดินไล่ flow ทั้งหมดผ่าน HTTP API แล้วพิสูจน์ว่าทำงานจริง
//
//   ลงทะเบียน Tag → รับเข้าคลัง (stock +)
//         ↓
//   เริ่ม Packing Session
//         ↓
//   สแกนของบนโต๊ะแพค → verify ครบไหม
//         ↓
//   ยืนยัน → Stock หัก + Tag = sold
//         ↓
//   พร้อมส่งออก (shipped)
//
// ต้องเปิดเซิร์ฟเวอร์ก่อน (npm run dev). ใช้ --keep เพื่อไม่ลบข้อมูล demo
// =====================================================================
require('dotenv').config();

const { pool } = require('../config/db');

const BASE = process.env.API_BASE || 'http://localhost:3000/api';

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function step(n, title) {
  console.log(`\n${'─'.repeat(60)}\n▶ STEP ${n}: ${title}\n${'─'.repeat(60)}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  const keep = process.argv.includes('--keep');
  const ts = Date.now();
  const sku = `DEMO-${ts}`;
  const epc = `DEMO-EPC-${ts}`;
  const orderRef = `DEMO-ORD-${ts}`;
  let productId;
  let packingId;

  console.log('🎬 E2E DEMO — RFID inventory flow');
  console.log(`   sku=${sku}  epc=${epc}  order=${orderRef}`);

  try {
    step(1, 'สร้างสินค้า → ลงทะเบียน Tag → รับเข้าคลัง (stock +)');
    const prod = await api('POST', '/products', {
      sku,
      name: `Demo Product ${ts}`,
      product_type: 'consumable',
      price: 99.0,
    });
    productId = prod.data.product_id;
    console.log(`  · สร้างสินค้า ${prod.data.sku}`);

    const reg = await api('POST', '/rfid/tags', {
      epc_code: epc,
      sku,
      tag_type: 'label',
      exp_date: '2027-12-31',
    });
    assert(reg.data.tag.status === 'active', `ลงทะเบียน tag ${epc} → status=active`);
    assert(reg.data.stock.qty_available === 1, `รับเข้าคลัง → qty_available=${reg.data.stock.qty_available} (คาดหวัง 1)`);

    step(2, 'เริ่ม Packing Session');
    const startRes = await api('POST', '/packing/start', {
      order_ref: orderRef,
      expected_epc_codes: [epc],
    });
    packingId = startRes.data.packing_id;
    assert(startRes.data.status === 'pending', `เริ่ม session ${packingId} → status=pending`);

    step(3, 'สแกนของบนโต๊ะแพค → verify ครบไหม');
    const verifyRes = await api('POST', '/packing/verify', {
      packing_id: packingId,
      scanned_epc_codes: [epc],
    });
    console.log(`  matched=${JSON.stringify(verifyRes.matched)} missing=${JSON.stringify(verifyRes.missing)} extra=${JSON.stringify(verifyRes.extra)}`);
    assert(verifyRes.verified === true, 'verify → verified=true (สแกนครบพอดี)');

    step(4, 'ยืนยัน → Stock หัก + Tag = sold');
    const stockAfter = await api('GET', '/stock');
    const stockRow = stockAfter.data.find((r) => r.sku === sku);
    assert(stockRow && stockRow.qty_available === 0, `stock หัก → qty_available=${stockRow ? stockRow.qty_available : 'n/a'} (คาดหวัง 0)`);

    const { rows: tagRows } = await pool.query('SELECT status, eas_active FROM rfid_tags WHERE epc_code = $1', [epc]);
    assert(tagRows[0].status === 'sold', 'tag → status=sold');
    assert(tagRows[0].eas_active === false, 'tag → eas_active=false (ไม่ดัง Gate)');

    step(5, 'พร้อมส่งออก (ship)');
    const shipRes = await api('POST', '/packing/ship', { packing_id: packingId });
    assert(shipRes.data.status === 'shipped', 'session → status=shipped');

    const finalG = await api('GET', `/packing/${packingId}`);
    assert(finalG.data.status === 'shipped' && finalG.data.is_verified === true, 'ตรวจซ้ำ: shipped + is_verified=true');

    console.log(`\n✅ E2E DEMO สำเร็จครบทุกขั้น`);
  } catch (err) {
    console.error(`\n❌ E2E DEMO ล้มเหลว: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (!keep && productId) {
      try {
        if (packingId) await pool.query('DELETE FROM packing_sessions WHERE packing_id = $1', [packingId]);
        await pool.query('DELETE FROM stock_transactions WHERE product_id = $1', [productId]);
        await pool.query('DELETE FROM rfid_tags WHERE product_id = $1', [productId]);
        await pool.query('DELETE FROM stock_levels WHERE product_id = $1', [productId]);
        await pool.query('DELETE FROM products WHERE product_id = $1', [productId]);
        console.log('🧹 ล้างข้อมูล demo แล้ว (ใช้ --keep เพื่อเก็บไว้ตรวจสอบ)');
      } catch (e) {
        console.error('cleanup error:', e.message);
      }
    }
    await pool.end();
  }
}

main();
