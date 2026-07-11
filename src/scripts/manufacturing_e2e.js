// =====================================================================
// manufacturing_e2e.js — พิสูจน์สายการผลิต "ตามรอยรายล็อตเต็มสูบ" ผ่าน HTTP API
//
//   รับซัพพลายเออร์ + ล็อต green เข้าคลังกลาง (green_coffee_lots.qty_central_kg)
//         ↓  เบิกโอนล็อต green คลังกลาง → Store (qty_store_kg)
//   รับถุง/ฟอล์ยเข้าคลังกลาง → เบิกโอนถุง → Store (store_stock)
//         ↓
//   เปิดใบสั่งงานรวม "คั่ว + บรรจุ" (เลือกล็อต green) → จอง green ที่ล็อต + จองถุงที่ Store
//         ↓  เริ่มงาน → ตัดถุงจริงจาก Store (green ยังจองไว้ รอคั่ว)
//   จบงาน → สร้าง roast_batch (หัก green จากล็อต) + finished_lot (ตราวันคั่ว)
//            → ถุงสำเร็จเข้า stock_levels + สาวรอย ถุง→คั่ว→ล็อต green→ซัพ ได้
//
// สร้างข้อมูลทดสอบเอง (รหัส T<timestamp>-*) แล้วลบทิ้งเมื่อจบ (ใส่ --keep เพื่อเก็บ)
// ต้องเปิดเซิร์ฟเวอร์ก่อน. ตั้ง API_BASE ผ่าน env ได้
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
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${JSON.stringify(data)}`);
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

async function storeRow(code) {
  const res = await api('GET', '/warehouse/store-stock');
  const row = res.data.find((r) => r.code === code);
  if (!row) throw new Error(`ไม่พบ ${code} ใน store-stock`);
  return row;
}
const greenLot = (id) => api('GET', `/green-lots/${id}`).then((r) => r.data);

async function main() {
  const keep = process.argv.includes('--keep');
  const ts = Date.now();

  const CODE = {
    greenMat: `T${ts}-GREEN`, roast: `T${ts}-ROAST`, pkg: `T${ts}-PKG`,
    prodSku: `T${ts}-PROD`, bomR: `T${ts}-BOMR`, bomP: `T${ts}-BOMP`,
    receipt: `T${ts}-RCPT`, transfer: `T${ts}-TRF`, work: `T${ts}-WO`,
  };
  const id = { materials: [], productId: null, bomR: null, bomP: null,
    receiptId: null, transferId: null, workId: null, supplierId: null, lotId: null };

  console.log('🏭 E2E — สายการผลิตตามรอยรายล็อต (green ล็อต → คั่ว → ถุงสำเร็จ)');
  console.log(`   prefix = T${ts}`);

  try {
    // -----------------------------------------------------------------
    step(1, 'สร้างวัตถุดิบ (เมล็ดคั่วกึ่งสำเร็จ + ถุง) + สินค้า + BOM คั่ว/บรรจุ');
    // -----------------------------------------------------------------
    const mkMaterial = async (code, name, category, unit) => {
      const r = await api('POST', '/warehouse/materials', { code, name, category, unit, qty_min_alert: 0 });
      id.materials.push(r.data.material_id);
      return r.data.material_id;
    };
    // green material = เมทาดาทาของสูตรคั่วเท่านั้น (เครื่องยนต์ไม่เบิกจากคลัง — green มาจากล็อต)
    const greenMat = await mkMaterial(CODE.greenMat, 'ทดสอบ green (สูตรคั่ว)', 'BEAN', 'kg');
    const roast = await mkMaterial(CODE.roast, 'ทดสอบ เมล็ดคั่ว (กึ่งสำเร็จ)', 'BEAN', 'kg');
    const pkg = await mkMaterial(CODE.pkg, 'ทดสอบ ถุงบรรจุ', 'PKG', 'ชิ้น');

    const prod = await api('POST', '/products', { sku: CODE.prodSku, name: 'ทดสอบ กาแฟถุง 500g', product_type: 'consumable' });
    id.productId = prod.data.product_id;

    const bomR = await api('POST', '/bom', {
      code: CODE.bomR, name: 'ทดสอบ สูตรคั่ว', bom_type: 'roasting',
      output_material_id: roast, output_qty: 1, output_unit: 'kg', expected_loss_pct: 15,
      items: [{ material_id: greenMat, qty_required: 1, unit: 'kg' }],
    });
    id.bomR = bomR.data.bom_id;

    const bomP = await api('POST', '/bom', {
      code: CODE.bomP, name: 'ทดสอบ สูตรบรรจุ', bom_type: 'packaging',
      output_product_id: id.productId, output_qty: 1, output_unit: 'ถุง', expected_loss_pct: 2,
      items: [{ material_id: roast, qty_required: 0.52, unit: 'kg' }, { material_id: pkg, qty_required: 1, unit: 'ชิ้น' }],
    });
    id.bomP = bomP.data.bom_id;
    assert(bomP.data.items.length === 2, 'สร้าง BOM คั่ว/บรรจุ');

    // -----------------------------------------------------------------
    step(2, 'รับล็อต green เข้าคลังกลาง (20 กก.) — ผูกซัพพลายเออร์');
    // -----------------------------------------------------------------
    const sup = await api('POST', '/suppliers', { name: 'ทดสอบ ดอยช้าง คอฟฟี่' });
    id.supplierId = sup.data.supplier_id;
    const lot = await api('POST', '/green-lots', {
      supplier_id: id.supplierId, origin: 'ดอยช้าง เชียงราย', variety: 'ทดสอบ Typica', weight_kg: 20,
    });
    id.lotId = lot.data.lot_id;
    assert(near(lot.data.qty_central_kg, 20) && near(lot.data.qty_store_kg, 0), 'ล็อต green → คลังกลาง 20, Store 0');

    // -----------------------------------------------------------------
    step(3, 'เบิกโอน green คลังกลาง → Store 15 กก. + รับ/เบิกโอนถุงเข้า Store 16');
    // -----------------------------------------------------------------
    await api('POST', '/green-transfers', { lot_id: id.lotId, qty_kg: 15, direction: 'to_store' });
    const lot3 = await greenLot(id.lotId);
    assert(near(lot3.qty_central_kg, 5) && near(lot3.qty_store_kg, 15), 'ล็อต green → คลังกลาง 5, Store 15');

    const receipt = await api('POST', '/warehouse/receipts', {
      receipt_no: CODE.receipt, supplier_id: id.supplierId,
      items: [{ material_id: pkg, qty_received: 20 }],
    });
    id.receiptId = receipt.data.receipt_id;
    const transfer = await api('POST', '/warehouse/transfers', {
      transfer_no: CODE.transfer, from_location: 'central', to_location: 'store',
      items: [{ material_id: pkg, qty: 16 }],
    });
    id.transferId = transfer.data.transfer_id;
    assert(near((await storeRow(CODE.pkg)).qty_available, 16), 'Store ถุง = 16');

    // -----------------------------------------------------------------
    step(4, 'เปิดใบสั่งงาน (เลือกล็อต, คั่ว 10kg / บรรจุ 15 ถุง) → จอง green + ถุง');
    // -----------------------------------------------------------------
    const work = await api('POST', '/work-orders', {
      work_no: CODE.work, roast_bom_id: id.bomR, pack_bom_id: id.bomP,
      green_lot_id: id.lotId, roast_level: 'medium', planned_roast_qty: 10, planned_pack_qty: 15,
    });
    id.workId = work.data.work_id;
    assert(work.data.status === 'pending', 'ใบสั่งงาน → pending');
    const lot4 = await greenLot(id.lotId);
    assert(near(lot4.qty_store_reserved_kg, 10), 'จอง green ที่ล็อต reserved = 10');
    assert(near((await storeRow(CODE.pkg)).qty_reserved, 15.3), 'จองถุงที่ Store reserved = 15.3 (1×15×1.02)');

    // -----------------------------------------------------------------
    step(5, 'เริ่มงาน → ตัดถุงจริงจาก Store (green ยังจองไว้ รอคั่วตอนจบ)');
    // -----------------------------------------------------------------
    await api('POST', `/work-orders/${id.workId}/start`);
    assert(near((await storeRow(CODE.pkg)).qty_available, 0.7), 'Store ถุง available = 0.7 (16−15.3)');
    const lot5 = await greenLot(id.lotId);
    assert(near(lot5.qty_store_kg, 15) && near(lot5.qty_store_reserved_kg, 10), 'green ยังไม่ถูกหัก (Store 15, จอง 10)');

    // -----------------------------------------------------------------
    step(6, 'จบงาน → คั่วได้ 9/เสีย 1, บรรจุ 15 → roast_batch + finished_lot + เข้าสต็อก');
    // -----------------------------------------------------------------
    const done = await api('POST', `/work-orders/${id.workId}/complete`, {
      roast_produced: 9, roast_loss: 1, roast_loss_reason: 'ทดสอบ: น้ำหนักหายจากการคั่ว', pack_produced: 15, pack_loss: 0,
    });
    assert(done.data.order.status === 'completed', 'ใบสั่งงาน → completed');
    assert(near(done.data.roasted_consumed, 7.8), 'เมล็ดคั่วใช้จริง = 7.8 (0.52×15)');
    assert(done.data.roast_batch && near(done.data.roast_batch.loss_pct, 10), 'roast_batch loss = 10% (10→9)');
    assert(done.data.finished_lot && done.data.finished_lot.code.startsWith('FL-'), `finished_lot สร้างแล้ว (${done.data.finished_lot?.code})`);

    const lot6 = await greenLot(id.lotId);
    assert(near(lot6.qty_store_kg, 5) && near(lot6.qty_store_reserved_kg, 0), 'green ถูกหักจากล็อต (Store 15−10=5, จอง 0)');

    const stock = await api('GET', '/stock');
    const prodStock = stock.data.find((r) => r.sku === CODE.prodSku);
    assert(prodStock && near(prodStock.qty_available, 15), `สินค้าสำเร็จรูปเข้าสต็อก = ${prodStock?.qty_available} (คาด 15)`);

    // -----------------------------------------------------------------
    step(7, 'ตามรอยย้อนกลับ: ถุงสำเร็จ → คั่ว → ล็อต green → ซัพพลายเออร์');
    // -----------------------------------------------------------------
    const fl = await api('GET', `/work-orders/finished-lots?product_id=${id.productId}`);
    const row = fl.data[0];
    assert(row && row.green_lot_code === lot.data.code, `ถุงสำเร็จ ${row?.code} สาวถึงล็อต green ${row?.green_lot_code}`);
    assert(row.supplier_name && row.supplier_name.includes('ดอยช้าง'), `สาวถึงซัพพลายเออร์: ${row?.supplier_name}`);
    assert(row.batch_code && row.batch_code.startsWith('RB-'), `สาวถึงล็อตคั่ว: ${row?.batch_code}`);

    console.log('\n✅ E2E ตามรอยรายล็อตเต็มสูบ สำเร็จครบทุกขั้น (green ล็อต → คั่ว → ถุงสำเร็จ → สาวรอยกลับได้)');
  } catch (err) {
    console.error(`\n❌ E2E สายการผลิต ล้มเหลว: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (!keep) await cleanup(id);
    else console.log('\n📌 ใช้ --keep : เก็บข้อมูลทดสอบไว้ (ไม่ลบ)');
    await pool.end();
  }
}

// ลบข้อมูลทดสอบทั้งหมด เรียงตาม FK (ลูกก่อนแม่; แก้ FK วนระหว่าง work_orders ↔ roast_batches)
async function cleanup(id) {
  try {
    if (id.workId) {
      await pool.query('DELETE FROM finished_lots WHERE work_id = $1', [id.workId]);
      await pool.query('UPDATE work_orders SET batch_id = NULL WHERE work_id = $1', [id.workId]);
      await pool.query('DELETE FROM roast_batches WHERE work_order_id = $1', [id.workId]); // trigger คืน green เข้าล็อต
      await pool.query('DELETE FROM work_orders WHERE work_id = $1', [id.workId]);
    }
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
    if (id.lotId) {
      await pool.query('DELETE FROM green_lot_transfers WHERE lot_id = $1', [id.lotId]);
      await pool.query('DELETE FROM green_coffee_lots WHERE lot_id = $1', [id.lotId]);
    }
    if (id.supplierId) await pool.query('DELETE FROM suppliers WHERE supplier_id = $1', [id.supplierId]);
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
