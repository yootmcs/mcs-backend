// =====================================================================
// manufacturing_e2e.js — พิสูจน์สายการผลิตใหม่ผ่าน HTTP API
//
//   รับวัตถุดิบเข้าคลังกลาง (receipt)
//         ↓
//   เบิกโอนคลังกลาง → Store โรงคั่ว (transfer)
//         ↓
//   เปิดใบสั่งงานรวม "คั่ว + บรรจุ" → จองวัตถุดิบที่ Store
//         ↓
//   เริ่มงาน → ตัดวัตถุดิบจริงจาก Store (เมล็ดดิบ + ถุง)
//         ↓
//   จบงาน → บันทึกได้/เสีย 2 จุด (คั่ว, บรรจุ)
//            เมล็ดคั่ว = ของกลางในงาน (ไหลเข้าบรรจุเลย)
//            ถุงสำเร็จ → เข้า stock_levels
//
// สร้างข้อมูลทดสอบของตัวเอง (รหัส T<timestamp>-*) และลบทิ้งเมื่อจบ (ใส่ --keep เพื่อเก็บ)
// ต้องเปิดเซิร์ฟเวอร์ก่อน (npm run dev / npm start). ตั้ง API_BASE ผ่าน env ได้
// =====================================================================
require('dotenv').config();

const { pool } = require('../config/db');

const BASE = process.env.API_BASE || 'http://localhost:3000/api';
const EPS = 0.001;

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
  console.log(`\n${'─'.repeat(64)}\n▶ STEP ${n}: ${title}\n${'─'.repeat(64)}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const num = (v) => Number(v);
const near = (a, b) => Math.abs(num(a) - num(b)) < EPS;

// หา row ตาม code จาก endpoint สต็อก (คลังกลาง หรือ Store)
async function stockByCode(path, code) {
  const res = await api('GET', path);
  const row = res.data.find((r) => r.code === code);
  if (!row) throw new Error(`ไม่พบ ${code} ใน ${path}`);
  return row;
}
const central = (code) => stockByCode('/warehouse/stock', code);
const store = (code) => stockByCode('/warehouse/store-stock', code);

async function main() {
  const keep = process.argv.includes('--keep');
  const ts = Date.now();

  const CODE = {
    beanA: `T${ts}-BEANA`, beanB: `T${ts}-BEANB`, roast: `T${ts}-ROAST`, pkg: `T${ts}-PKG`,
    prodSku: `T${ts}-PROD`, bomR: `T${ts}-BOMR`, bomP: `T${ts}-BOMP`,
    receipt: `T${ts}-RCPT`, transfer: `T${ts}-TRF`, work: `T${ts}-WO`,
  };
  const id = { materials: [], productId: null, bomR: null, bomP: null, receiptId: null, transferId: null, workId: null };

  console.log('🏭 E2E — สายการผลิตใหม่ (รับ → เบิกโอน Store → ใบสั่งงานรวม คั่ว+บรรจุ)');
  console.log(`   prefix = T${ts}`);

  try {
    // -----------------------------------------------------------------
    step(1, 'สร้างวัตถุดิบ + สินค้าสำเร็จรูป + สูตร (BOM คั่ว/บรรจุ)');
    // -----------------------------------------------------------------
    const mkMaterial = async (code, name, category, unit) => {
      const r = await api('POST', '/warehouse/materials', { code, name, category, unit, qty_min_alert: 0 });
      id.materials.push(r.data.material_id);
      return r.data.material_id;
    };
    const beanA = await mkMaterial(CODE.beanA, 'ทดสอบ อาราบิก้า', 'BEAN', 'kg');
    const beanB = await mkMaterial(CODE.beanB, 'ทดสอบ โรบัสต้า', 'BEAN', 'kg');
    const roast = await mkMaterial(CODE.roast, 'ทดสอบ เมล็ดคั่ว (กึ่งสำเร็จ)', 'BEAN', 'kg');
    const pkg = await mkMaterial(CODE.pkg, 'ทดสอบ ถุงบรรจุ', 'PKG', 'ชิ้น');
    console.log('  · สร้างวัตถุดิบ 4 รายการ');

    const prod = await api('POST', '/products', { sku: CODE.prodSku, name: 'ทดสอบ กาแฟถุง 500g', product_type: 'consumable' });
    id.productId = prod.data.product_id;

    const bomR = await api('POST', '/bom', {
      code: CODE.bomR, name: 'ทดสอบ สูตรคั่ว', bom_type: 'roasting',
      output_material_id: roast, output_qty: 1, output_unit: 'kg', expected_loss_pct: 15,
      items: [{ material_id: beanA, qty_required: 0.6, unit: 'kg' }, { material_id: beanB, qty_required: 0.4, unit: 'kg' }],
    });
    id.bomR = bomR.data.bom_id;

    const bomP = await api('POST', '/bom', {
      code: CODE.bomP, name: 'ทดสอบ สูตรบรรจุ', bom_type: 'packaging',
      output_product_id: id.productId, output_qty: 1, output_unit: 'ถุง', expected_loss_pct: 2,
      items: [{ material_id: roast, qty_required: 0.52, unit: 'kg' }, { material_id: pkg, qty_required: 1, unit: 'ชิ้น' }],
    });
    id.bomP = bomP.data.bom_id;
    assert(bomR.data.items.length === 2 && bomP.data.items.length === 2, 'สร้าง BOM คั่ว/บรรจุ (สูตรละ 2 ส่วนผสม)');

    // -----------------------------------------------------------------
    step(2, 'รับวัตถุดิบเข้าคลังกลาง: A=10, B=10, ถุง=20');
    // -----------------------------------------------------------------
    const receipt = await api('POST', '/warehouse/receipts', {
      receipt_no: CODE.receipt, supplier_name: 'ทดสอบ ซัพพลายเออร์',
      items: [{ material_id: beanA, qty_received: 10 }, { material_id: beanB, qty_received: 10 }, { material_id: pkg, qty_received: 20 }],
    });
    id.receiptId = receipt.data.receipt_id;
    assert(near((await central(CODE.beanA)).qty_available, 10), 'คลังกลาง → อาราบิก้า = 10');

    // -----------------------------------------------------------------
    step(3, 'เบิกโอนคลังกลาง → Store โรงคั่ว: A=7, B=5, ถุง=16');
    // -----------------------------------------------------------------
    const transfer = await api('POST', '/warehouse/transfers', {
      transfer_no: CODE.transfer, from_location: 'central', to_location: 'store',
      items: [{ material_id: beanA, qty: 7 }, { material_id: beanB, qty: 5 }, { material_id: pkg, qty: 16 }],
    });
    id.transferId = transfer.data.transfer_id;
    assert(near((await central(CODE.beanA)).qty_available, 3), 'คลังกลาง อาราบิก้า = 3 (10−7)');
    assert(near((await store(CODE.beanA)).qty_available, 7), 'Store อาราบิก้า = 7');
    assert(near((await store(CODE.pkg)).qty_available, 16), 'Store ถุง = 16');

    // -----------------------------------------------------------------
    step(4, 'เปิดใบสั่งงานรวม (คั่ว 10kg / บรรจุ 15 ถุง) → จองที่ Store');
    // -----------------------------------------------------------------
    // demand: A=0.6*10*1.15=6.9, B=4.6, ถุง=1*15*1.02=15.3 (เมล็ดคั่ว=ของกลาง ไม่เบิก)
    const work = await api('POST', '/work-orders', {
      work_no: CODE.work, roast_bom_id: id.bomR, pack_bom_id: id.bomP,
      planned_roast_qty: 10, planned_pack_qty: 15,
    });
    id.workId = work.data.work_id;
    assert(work.data.status === 'pending', 'ใบสั่งงาน → pending');
    assert(near((await store(CODE.beanA)).qty_reserved, 6.9), 'จองที่ Store → อาราบิก้า reserved = 6.9');
    assert(near((await store(CODE.pkg)).qty_reserved, 15.3), 'จองที่ Store → ถุง reserved = 15.3');

    // -----------------------------------------------------------------
    step(5, 'เริ่มงาน → ตัดวัตถุดิบจริงจาก Store + ปล่อยจอง');
    // -----------------------------------------------------------------
    await api('POST', `/work-orders/${id.workId}/start`);
    const sa = await store(CODE.beanA);
    assert(near(sa.qty_available, 0.1), 'Store อาราบิก้า available = 0.1 (7−6.9)');
    assert(near(sa.qty_reserved, 0), 'ปล่อยจอง อาราบิก้า reserved = 0');
    assert(near((await store(CODE.pkg)).qty_available, 0.7), 'Store ถุง available = 0.7 (16−15.3)');

    // -----------------------------------------------------------------
    step(6, 'จบงาน → คั่วได้ 9/เสีย 1, บรรจุได้ 15/เสีย 0 → ถุงเข้า stock_levels');
    // -----------------------------------------------------------------
    const done = await api('POST', `/work-orders/${id.workId}/complete`, {
      roast_produced: 9, roast_loss: 1, roast_loss_reason: 'ทดสอบ: น้ำหนักหายจากการคั่ว',
      pack_produced: 15, pack_loss: 0,
    });
    assert(done.data.order.status === 'completed', 'ใบสั่งงาน → completed');
    assert(near(done.data.roasted_consumed, 7.8), 'เมล็ดคั่วใช้จริง = 7.8 (0.52×15)');

    const stock = await api('GET', '/stock');
    const prodStock = stock.data.find((r) => r.sku === CODE.prodSku);
    assert(prodStock && near(prodStock.qty_available, 15),
      `สินค้าสำเร็จรูปเข้าสต็อก → available = ${prodStock ? prodStock.qty_available : 'n/a'} (คาดหวัง 15)`);

    console.log('\n✅ E2E สายการผลิตใหม่ สำเร็จครบทุกขั้น (รับ → เบิกโอน Store → ใบสั่งงานรวม → สินค้าสำเร็จรูป)');
  } catch (err) {
    console.error(`\n❌ E2E สายการผลิต ล้มเหลว: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (!keep) await cleanup(id);
    else console.log('\n📌 ใช้ --keep : เก็บข้อมูลทดสอบไว้ (ไม่ลบ)');
    await pool.end();
  }
}

// ลบข้อมูลทดสอบทั้งหมด เรียงตาม FK (ลูกก่อนแม่)
async function cleanup(id) {
  try {
    if (id.workId) await pool.query('DELETE FROM work_orders WHERE work_id = $1', [id.workId]);
    if (id.productId) {
      await pool.query('DELETE FROM stock_transactions WHERE product_id = $1', [id.productId]);
      await pool.query('DELETE FROM stock_levels WHERE product_id = $1', [id.productId]);
    }
    const bomIds = [id.bomR, id.bomP].filter(Boolean);
    if (bomIds.length) {
      await pool.query('DELETE FROM bom_items WHERE bom_id = ANY($1)', [bomIds]);
      await pool.query('DELETE FROM bom_templates WHERE bom_id = ANY($1)', [bomIds]);
    }
    if (id.productId) await pool.query('DELETE FROM products WHERE product_id = $1', [id.productId]);
    if (id.transferId) {
      await pool.query('DELETE FROM stock_transfer_items WHERE transfer_id = $1', [id.transferId]);
      await pool.query('DELETE FROM stock_transfers WHERE transfer_id = $1', [id.transferId]);
    }
    if (id.receiptId) {
      await pool.query('DELETE FROM warehouse_receipt_items WHERE receipt_id = $1', [id.receiptId]);
      await pool.query('DELETE FROM warehouse_receipts WHERE receipt_id = $1', [id.receiptId]);
    }
    if (id.materials.length) {
      await pool.query('DELETE FROM store_stock WHERE material_id = ANY($1)', [id.materials]);
      await pool.query('DELETE FROM warehouse_stock WHERE material_id = ANY($1)', [id.materials]);
      await pool.query('DELETE FROM raw_materials WHERE material_id = ANY($1)', [id.materials]);
    }
    console.log('\n🧹 ล้างข้อมูลทดสอบแล้ว (ใช้ --keep เพื่อเก็บไว้ตรวจสอบ)');
  } catch (e) {
    console.error('cleanup error:', e.message);
  }
}

main();
