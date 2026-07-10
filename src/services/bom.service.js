// Business logic: BOM + Production orders (จอง/ตัดวัตถุดิบ/ผลิตเสร็จ)
const { pool } = require('../config/db');
const { Bom, Prod, Stock } = require('../models/bom.model');
const { Issues } = require('../models/warehouse.model');

const round3 = (n) => Math.round(n * 1000) / 1000;

function httpErr(status, message, data) {
  const e = new Error(message);
  e.statusCode = status;
  if (data) e.data = data;
  return e;
}

// วัตถุดิบที่ต้องใช้จริง = qty_required * planned_qty * (1 + loss_pct/100)
// เผื่อของเสียตาม expected_loss_pct (เช่น ผลิต 10 loss 15% ต้องใช้วัตถุดิบ x1.15)
function computeRequired(bom, items, plannedQty) {
  const lossFactor = 1 + Number(bom.expected_loss_pct || 0) / 100;
  return items.map((it) => ({
    material_id: it.material_id,
    material_code: it.material_code,
    material_name: it.material_name,
    unit: it.unit,
    qty_per_unit: Number(it.qty_required),
    required_qty: round3(Number(it.qty_required) * Number(plannedQty) * lossFactor),
  }));
}

// ---- BOM ----
exports.listBoms = async () => (await Bom.list()).rows;

exports.getBom = async (id) => {
  const bom = (await Bom.getById(pool, id)).rows[0];
  if (!bom) return null;
  const items = (await Bom.items(pool, id)).rows;
  return { ...bom, items };
};

exports.createBom = async (payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bom = (await Bom.insert(client, payload)).rows[0];
    const items = [];
    for (const it of payload.items || []) {
      items.push((await Bom.insertItem(client, bom.bom_id, it)).rows[0]);
    }
    await client.query('COMMIT');
    return { ...bom, items };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ---- Production ----

// เปิดใบสั่งผลิต: คำนวณวัตถุดิบ → เช็คสต็อกพอไหม → จอง qty_reserved
exports.createOrder = async (payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bom = (await Bom.getById(client, payload.bom_id)).rows[0];
    if (!bom) throw httpErr(404, 'BOM not found');
    const items = (await Bom.items(client, bom.bom_id)).rows;
    if (!items.length) throw httpErr(400, 'BOM has no items');

    const required = computeRequired(bom, items, payload.planned_qty);
    const stockRows = (await Stock.forMaterials(client, required.map((r) => r.material_id))).rows;
    const stockMap = Object.fromEntries(stockRows.map((s) => [s.material_id, s]));

    const shortages = [];
    for (const r of required) {
      const s = stockMap[r.material_id];
      const free = s ? Number(s.qty_available) - Number(s.qty_reserved) : 0;
      r.available_free = free;
      if (free < r.required_qty) shortages.push(r);
    }
    if (shortages.length) throw httpErr(400, 'สต็อกวัตถุดิบไม่พอ (insufficient stock)', { shortages });

    const order = (await Prod.insertOrder(client, payload)).rows[0];
    for (const r of required) await Stock.addReserved(client, r.material_id, r.required_qty);

    await client.query('COMMIT');
    return { ...order, required_materials: required };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.listOrders = async () => (await Prod.list()).rows;

exports.getOrder = async (id) => {
  const order = (await Prod.getById(pool, id)).rows[0];
  if (!order) return null;
  const items = (await Bom.items(pool, order.bom_id)).rows;
  const required = computeRequired(order, items, order.planned_qty);
  const stockRows = (await Stock.forMaterials(pool, required.map((r) => r.material_id))).rows;
  const stockMap = Object.fromEntries(stockRows.map((s) => [s.material_id, s]));
  required.forEach((r) => {
    const s = stockMap[r.material_id];
    r.qty_available = s ? Number(s.qty_available) : 0;
    r.qty_reserved = s ? Number(s.qty_reserved) : 0;
  });
  const outputs = (await Prod.outputs(pool, id)).rows;
  return { ...order, required_materials: required, outputs };
};

// เริ่มผลิต: สร้าง warehouse_issues ตัดวัตถุดิบจริง + ปล่อยการจอง → in_progress
exports.startOrder = async (id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = (await Prod.getById(client, id)).rows[0];
    if (!order) throw httpErr(404, 'production order not found');
    if (order.status !== 'pending') throw httpErr(409, `order must be pending (current: ${order.status})`);

    const items = (await Bom.items(client, order.bom_id)).rows;
    const required = computeRequired(order, items, order.planned_qty);

    const issue = (await Issues.insert(client, {
      issue_no: `ISS-${order.order_no}`,
      issue_type: 'production',
      ref_id: order.order_id,
      staff_id: order.staff_id,
      note: `ตัดวัตถุดิบสำหรับใบสั่งผลิต ${order.order_no}`,
    })).rows[0];

    for (const r of required) {
      // trigger warehouse_issue จะลด qty_available (และ throw ถ้าไม่พอ)
      await Issues.insertItem(client, issue.issue_id, {
        material_id: r.material_id,
        qty_requested: r.required_qty,
        qty_issued: r.required_qty,
        note: null,
      });
      // ปล่อยการจองที่กันไว้ตอนเปิดใบสั่ง
      await Stock.addReserved(client, r.material_id, -r.required_qty);
    }

    const updated = (await Prod.setStatus(client, id, 'in_progress', 'started_at')).rows[0];
    await client.query('COMMIT');
    return { ...updated, issue_no: issue.issue_no, issued_materials: required };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// จบผลิต: บันทึกผลผลิต → completed → ถ้า packaging เพิ่ม stock_levels สินค้าสำเร็จรูป
exports.completeOrder = async (id, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = (await Prod.getById(client, id)).rows[0];
    if (!order) throw httpErr(404, 'production order not found');
    if (order.status !== 'in_progress') throw httpErr(409, `order must be in_progress (current: ${order.status})`);
    if (payload.qty_produced == null) throw httpErr(400, 'qty_produced is required');

    const output = (await Prod.insertOutput(client, { order_id: id, ...payload })).rows[0];
    const updated = (await Prod.setStatus(client, id, 'completed', 'completed_at')).rows[0];

    let finishedStock = null;
    if (order.bom_type === 'packaging' && order.output_product_id) {
      // packaging → สินค้าสำเร็จรูปเข้า stock_levels ผ่าน stock_transactions (trigger อัปเดตให้)
      await client.query(
        `INSERT INTO stock_transactions (product_id, txn_type, qty_change, note, staff_id)
         VALUES ($1, 'receive', $2, $3, $4)`,
        [order.output_product_id, payload.qty_produced, `ผลิตเสร็จ ${order.order_no}`, payload.staff_id ?? null]
      );
      finishedStock = {
        target: 'product',
        ...(await client.query(
          'SELECT qty_total, qty_available FROM stock_levels WHERE product_id = $1',
          [order.output_product_id]
        )).rows[0],
      };
    } else if (order.bom_type === 'roasting' && order.output_material_id) {
      // roasting → วัตถุดิบกึ่งสำเร็จเข้า warehouse_stock (เก็บไว้ให้ packaging ใช้ต่อ)
      await client.query(
        `INSERT INTO warehouse_stock (material_id, qty_total, qty_available, updated_at)
         VALUES ($1, $2, $2, now())
         ON CONFLICT (material_id) DO UPDATE
           SET qty_total     = warehouse_stock.qty_total + $2,
               qty_available = warehouse_stock.qty_available + $2,
               updated_at    = now()`,
        [order.output_material_id, payload.qty_produced]
      );
      finishedStock = {
        target: 'warehouse',
        ...(await client.query(
          'SELECT qty_total, qty_available FROM warehouse_stock WHERE material_id = $1',
          [order.output_material_id]
        )).rows[0],
      };
    }

    await client.query('COMMIT');
    return { order: updated, output, finished_stock: finishedStock };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
