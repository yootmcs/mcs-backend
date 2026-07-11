// =====================================================================
// manufacturing_e2e.js — พิสูจน์สายการผลิต 2 ช่วง (คั่ว → บรรจุ) ผ่าน HTTP API
//
//   รับวัตถุดิบเข้าคลัง (receipt)
//         ↓
//   เปิดใบสั่งผลิต "คั่ว" → จองวัตถุดิบ → เริ่ม (ตัดเมล็ดดิบจริง)
//         ↓
//   คั่วเสร็จ → บันทึกได้/เสีย → เมล็ดคั่วเข้าเก็บที่ Store (warehouse_stock)
//         ↓
//   เปิดใบสั่งผลิต "บรรจุ" → จองเมล็ดคั่ว+บรรจุภัณฑ์ → เริ่ม (ตัดจริง)
//         ↓
//   บรรจุเสร็จ → บันทึกได้/เสีย → สินค้าสำเร็จรูปเข้า stock_levels
//
// สคริปต์นี้สร้างข้อมูลทดสอบของตัวเอง (รหัส T<timestamp>-*) จึงไม่กระทบ seed จริง
// และลบข้อมูลทั้งหมดทิ้งเมื่อจบ (ใส่ --keep เพื่อเก็บไว้ตรวจสอบ)
//
// ต้องเปิดเซิร์ฟเวอร์ก่อน (npm run dev). ตั้งค่า API_BASE ได้ผ่าน env
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

// numeric ของ pg คืนเป็น string — แปลงเป็นเลขก่อนเทียบ และเผื่อ error ทศนิยม
const num = (v) => Number(v);
const near = (a, b) => Math.abs(num(a) - num(b)) < EPS;

// หา row วัตถุดิบจาก GET /warehouse/stock ตาม code
async function whStockByCode(code) {
  const res = await api('GET', '/warehouse/stock');
  const row = res.data.find((r) => r.code === code);
  if (!row) throw new Error(`ไม่พบวัตถุดิบ ${code} ใน /warehouse/stock`);
  return row;
}

async function main() {
  const keep = process.argv.includes('--keep');
  const ts = Date.now();

  // รหัสข้อมูลทดสอบ (ไม่ชนของจริง)
  const CODE = {
    beanA: `T${ts}-BEANA`,
    beanB: `T${ts}-BEANB`,
    roast: `T${ts}-ROAST`,
    pkg: `T${ts}-PKG`,
    prodSku: `T${ts}-PROD`,
    bomR: `T${ts}-BOMR`,
    bomP: `T${ts}-BOMP`,
    orderR: `T${ts}-PO-R`,
    orderP: `T${ts}-PO-P`,
    receipt: `T${ts}-RCPT`,
  };

  // เก็บ id ไว้ตอน cleanup
  const id = { materials: [], productId: null, bomR: null, bomP: null, orderR: null, orderP: null, receiptId: null };

  console.log('🏭 E2E — สายการผลิต 2 ช่วง (คั่ว → บรรจุ)');
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

    const prod = await api('POST', '/products', {
      sku: CODE.prodSku,
      name: 'ทดสอบ กาแฟถุง 500g',
      product_type: 'consumable',
    });
    id.productId = prod.data.product_id;
    console.log(`  · สร้างสินค้าสำเร็จรูป ${prod.data.sku}`);

    // BOM คั่ว: 0.6 A + 0.4 B → เมล็ดคั่ว 1kg, loss 15%
    const bomR = await api('POST', '/bom', {
      code: CODE.bomR,
      name: 'ทดสอบ สูตรคั่ว',
      bom_type: 'roasting',
      output_material_id: roast,
      output_qty: 1,
      output_unit: 'kg',
      expected_loss_pct: 15,
      items: [
        { material_id: beanA, qty_required: 0.6, unit: 'kg' },
        { material_id: beanB, qty_required: 0.4, unit: 'kg' },
      ],
    });
    id.bomR = bomR.data.bom_id;

    // BOM บรรจุ: 0.52 เมล็ดคั่ว + 1 ถุง → สินค้า 1 ถุง, loss 2%
    const bomP = await api('POST', '/bom', {
      code: CODE.bomP,
      name: 'ทดสอบ สูตรบรรจุ',
      bom_type: 'packaging',
      output_product_id: id.productId,
      output_qty: 1,
      output_unit: 'ถุง',
      expected_loss_pct: 2,
      items: [
        { material_id: roast, qty_required: 0.52, unit: 'kg' },
        { material_id: pkg, qty_required: 1, unit: 'ชิ้น' },
      ],
    });
    id.bomP = bomP.data.bom_id;
    assert(bomR.data.items.length === 2 && bomP.data.items.length === 2, 'สร้าง BOM คั่ว/บรรจุ (สูตรละ 2 ส่วนผสม)');

    // -----------------------------------------------------------------
    step(2, 'รับวัตถุดิบเข้าคลัง (receipt): A=10kg, B=10kg, ถุง=15');
    // -----------------------------------------------------------------
    const receipt = await api('POST', '/warehouse/receipts', {
      receipt_no: CODE.receipt,
      supplier_name: 'ทดสอบ ซัพพลายเออร์',
      items: [
        { material_id: beanA, qty_received: 10 },
        { material_id: beanB, qty_received: 10 },
        { material_id: pkg, qty_received: 15 },
      ],
    });
    id.receiptId = receipt.data.receipt_id;

    assert(near((await whStockByCode(CODE.beanA)).qty_available, 10), 'รับเข้า → อาราบิก้า available = 10');
    assert(near((await whStockByCode(CODE.pkg)).qty_available, 15), 'รับเข้า → ถุง available = 15');

    // -----------------------------------------------------------------
    step(3, 'เปิดใบสั่งผลิต "คั่ว" (planned 10kg) → จองวัตถุดิบ');
    // -----------------------------------------------------------------
    // required A = 0.6 * 10 * 1.15 = 6.9 ; B = 0.4 * 10 * 1.15 = 4.6
    const orderR = await api('POST', '/production/orders', {
      order_no: CODE.orderR,
      bom_id: id.bomR,
      planned_qty: 10,
    });
    id.orderR = orderR.data.order_id;
    assert(orderR.data.status === 'pending', 'ใบสั่งผลิตคั่ว → status = pending');
    assert(near((await whStockByCode(CODE.beanA)).qty_reserved, 6.9), 'จองวัตถุดิบ → อาราบิก้า reserved = 6.9');

    // -----------------------------------------------------------------
    step(4, 'เริ่มผลิต "คั่ว" → ตัดเมล็ดดิบจริง + ปล่อยการจอง');
    // -----------------------------------------------------------------
    await api('POST', `/production/orders/${id.orderR}/start`);
    const beanAafter = await whStockByCode(CODE.beanA);
    assert(near(beanAafter.qty_available, 3.1), 'ตัดวัตถุดิบ → อาราบิก้า available = 3.1 (10 − 6.9)');
    assert(near(beanAafter.qty_reserved, 0), 'ปล่อยการจอง → อาราบิก้า reserved = 0');

    // -----------------------------------------------------------------
    step(5, 'คั่วเสร็จ → บันทึกได้ 9kg / เสีย 1kg → เมล็ดคั่วเข้า Store');
    // -----------------------------------------------------------------
    const doneR = await api('POST', `/production/orders/${id.orderR}/complete`, {
      qty_produced: 9,
      qty_loss: 1,
      loss_reason: 'ทดสอบ: น้ำหนักหายจากการคั่ว',
    });
    assert(doneR.data.order.status === 'completed', 'ใบสั่งผลิตคั่ว → status = completed');
    assert(near(doneR.data.output.qty_produced, 9) && near(doneR.data.output.qty_loss, 1),
      'บันทึกผลผลิต → ได้ 9 / เสีย 1');
    assert(near((await whStockByCode(CODE.roast)).qty_available, 9), 'เมล็ดคั่วเข้า Store → available = 9');

    // -----------------------------------------------------------------
    step(6, 'เปิดใบสั่งผลิต "บรรจุ" (planned 10 ถุง) → จองเมล็ดคั่ว');
    // -----------------------------------------------------------------
    // required เมล็ดคั่ว = 0.52 * 10 * 1.02 = 5.304 ; ถุง = 1 * 10 * 1.02 = 10.2
    const orderP = await api('POST', '/production/orders', {
      order_no: CODE.orderP,
      bom_id: id.bomP,
      planned_qty: 10,
    });
    id.orderP = orderP.data.order_id;
    assert(near((await whStockByCode(CODE.roast)).qty_reserved, 5.304), 'จอง → เมล็ดคั่ว reserved = 5.304');

    // -----------------------------------------------------------------
    step(7, 'เริ่มผลิต "บรรจุ" → ตัดเมล็ดคั่ว + ถุงจริง');
    // -----------------------------------------------------------------
    await api('POST', `/production/orders/${id.orderP}/start`);
    assert(near((await whStockByCode(CODE.roast)).qty_available, 3.696), 'ตัด → เมล็ดคั่ว available = 3.696 (9 − 5.304)');
    assert(near((await whStockByCode(CODE.pkg)).qty_available, 4.8), 'ตัด → ถุง available = 4.8 (15 − 10.2)');

    // -----------------------------------------------------------------
    step(8, 'บรรจุเสร็จ → บันทึกได้ 10 ถุง / เสีย 0 → สินค้าเข้า stock_levels');
    // -----------------------------------------------------------------
    const doneP = await api('POST', `/production/orders/${id.orderP}/complete`, {
      qty_produced: 10,
      qty_loss: 0,
    });
    assert(doneP.data.order.status === 'completed', 'ใบสั่งผลิตบรรจุ → status = completed');

    const stock = await api('GET', '/stock');
    const prodStock = stock.data.find((r) => r.sku === CODE.prodSku);
    assert(prodStock && near(prodStock.qty_available, 10), `สินค้าสำเร็จรูปเข้าสต็อก → available = ${prodStock ? prodStock.qty_available : 'n/a'} (คาดหวัง 10)`);

    console.log('\n✅ E2E สายการผลิต สำเร็จครบทุกขั้น (รับ → คั่ว → Store → บรรจุ → สินค้าสำเร็จรูป)');
  } catch (err) {
    console.error(`\n❌ E2E สายการผลิต ล้มเหลว: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (!keep) {
      await cleanup(id);
    } else {
      console.log('\n📌 ใช้ --keep : เก็บข้อมูลทดสอบไว้ (ไม่ลบ)');
    }
    await pool.end();
  }
}

// ลบข้อมูลทดสอบทั้งหมด เรียงตาม FK (ลูกก่อนแม่) — ไม่ให้ค้างในฐานข้อมูล
async function cleanup(id) {
  const orderIds = [id.orderR, id.orderP].filter(Boolean);
  const bomIds = [id.bomR, id.bomP].filter(Boolean);
  try {
    if (orderIds.length) {
      await pool.query('DELETE FROM production_outputs WHERE order_id = ANY($1)', [orderIds]);
      // ใบจ่ายออกที่เกิดตอน start (ref_id = order_id)
      await pool.query(
        `DELETE FROM warehouse_issue_items
          WHERE issue_id IN (SELECT issue_id FROM warehouse_issues WHERE ref_id = ANY($1))`,
        [orderIds]
      );
      await pool.query('DELETE FROM warehouse_issues WHERE ref_id = ANY($1)', [orderIds]);
      await pool.query('DELETE FROM production_orders WHERE order_id = ANY($1)', [orderIds]);
    }
    if (id.receiptId) {
      await pool.query('DELETE FROM warehouse_receipt_items WHERE receipt_id = $1', [id.receiptId]);
      await pool.query('DELETE FROM warehouse_receipts WHERE receipt_id = $1', [id.receiptId]);
    }
    if (bomIds.length) {
      await pool.query('DELETE FROM bom_items WHERE bom_id = ANY($1)', [bomIds]);
      await pool.query('DELETE FROM bom_templates WHERE bom_id = ANY($1)', [bomIds]);
    }
    if (id.productId) {
      await pool.query('DELETE FROM stock_transactions WHERE product_id = $1', [id.productId]);
      await pool.query('DELETE FROM stock_levels WHERE product_id = $1', [id.productId]);
      await pool.query('DELETE FROM products WHERE product_id = $1', [id.productId]);
    }
    if (id.materials.length) {
      await pool.query('DELETE FROM warehouse_stock WHERE material_id = ANY($1)', [id.materials]);
      await pool.query('DELETE FROM raw_materials WHERE material_id = ANY($1)', [id.materials]);
    }
    console.log('\n🧹 ล้างข้อมูลทดสอบแล้ว (ใช้ --keep เพื่อเก็บไว้ตรวจสอบ)');
  } catch (e) {
    console.error('cleanup error:', e.message);
  }
}

main();
