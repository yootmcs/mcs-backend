// Business logic: ใบสั่งงานรวม (คั่ว + บรรจุ) เบิกวัตถุดิบทั้งหมดจาก Store โรงคั่ว
const { pool } = require('../config/db');
const { Bom } = require('../models/bom.model');
const { WorkOrder } = require('../models/workorder.model');
const { StoreStock } = require('../models/warehouse.model');

const round3 = (n) => Math.round(n * 1000) / 1000;

function httpErr(status, message, data) {
  const e = new Error(message);
  e.statusCode = status;
  if (data) e.data = data;
  return e;
}

// รวมวัตถุดิบที่ต้องเบิกจาก Store สำหรับใบสั่งงาน 1 ใบ:
//   ช่วงคั่ว  = roast items × planned_roast × (1 + roast_loss%)   → เมล็ดดิบ
//   ช่วงบรรจุ = pack items (ยกเว้นเมล็ดคั่ว) × planned_pack × (1 + pack_loss%) → ถุง/ฟอล์ย
// เมล็ดคั่ว (roast output) = ของกลางในงาน ไม่เบิกจาก Store
function computeStoreDemand(order, roastItems, packItems) {
  const roastFactor = 1 + Number(order.roast_loss_pct || 0) / 100;
  const packFactor = 1 + Number(order.pack_loss_pct || 0) / 100;
  const roastMatId = order.output_material_id; // เมล็ดคั่วกึ่งสำเร็จ

  const map = new Map();
  const add = (it, qty) => {
    const prev = map.get(it.material_id);
    const required = round3(qty);
    if (prev) prev.required_qty = round3(prev.required_qty + required);
    else map.set(it.material_id, {
      material_id: it.material_id, material_code: it.material_code,
      material_name: it.material_name, unit: it.unit, required_qty: required,
    });
  };

  for (const it of roastItems) {
    add(it, Number(it.qty_required) * Number(order.planned_roast_qty) * roastFactor);
  }
  let roastedNeeded = 0;
  for (const it of packItems) {
    if (it.material_id === roastMatId) {
      roastedNeeded = round3(Number(it.qty_required) * Number(order.planned_pack_qty) * packFactor);
      continue; // เมล็ดคั่ว = ของกลาง ไม่เบิกจาก Store
    }
    add(it, Number(it.qty_required) * Number(order.planned_pack_qty) * packFactor);
  }
  return { demand: [...map.values()], roastedNeeded };
}

// โหลด BOM + items ทั้งคั่วและบรรจุ พร้อม validate ชนิด
async function loadBoms(db, order) {
  const roastBom = (await Bom.getById(db, order.roast_bom_id)).rows[0];
  const packBom = (await Bom.getById(db, order.pack_bom_id)).rows[0];
  if (!roastBom || roastBom.bom_type !== 'roasting') throw httpErr(400, 'roast_bom_id ต้องเป็นสูตรชนิด roasting');
  if (!packBom || packBom.bom_type !== 'packaging') throw httpErr(400, 'pack_bom_id ต้องเป็นสูตรชนิด packaging');
  if (!roastBom.output_material_id) throw httpErr(400, 'สูตรคั่วต้องกำหนด output_material_id (เมล็ดคั่ว)');
  if (!packBom.output_product_id) throw httpErr(400, 'สูตรบรรจุต้องกำหนด output_product_id (สินค้าสำเร็จรูป)');
  const roastItems = (await Bom.items(db, roastBom.bom_id)).rows;
  const packItems = (await Bom.items(db, packBom.bom_id)).rows;
  if (!roastItems.length || !packItems.length) throw httpErr(400, 'BOM ต้องมีส่วนผสม');
  return { roastBom, packBom, roastItems, packItems };
}

// enrich order object ด้วยข้อมูล loss_pct + output ids (จาก WorkOrder.getById มีให้แล้ว)
function orderMeta(order) {
  return {
    planned_roast_qty: order.planned_roast_qty,
    planned_pack_qty: order.planned_pack_qty,
    roast_loss_pct: order.roast_loss_pct,
    pack_loss_pct: order.pack_loss_pct,
    output_material_id: order.output_material_id,
  };
}

exports.listOrders = async () => (await WorkOrder.list()).rows;

exports.getOrder = async (id) => {
  const order = (await WorkOrder.getById(pool, id)).rows[0];
  if (!order) return null;
  const { roastItems, packItems } = await loadBoms(pool, order);
  const { demand, roastedNeeded } = computeStoreDemand(orderMeta(order), roastItems, packItems);
  return { ...order, store_demand: demand, roasted_needed: roastedNeeded };
};

// เปิดใบสั่งงาน: คำนวณวัตถุดิบ → เช็ค Store พอไหม → จอง qty_reserved ที่ Store
exports.createOrder = async (payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roastBom = (await Bom.getById(client, payload.roast_bom_id)).rows[0];
    const packBom = (await Bom.getById(client, payload.pack_bom_id)).rows[0];
    if (!roastBom || roastBom.bom_type !== 'roasting') throw httpErr(400, 'roast_bom_id ต้องเป็นสูตรชนิด roasting');
    if (!packBom || packBom.bom_type !== 'packaging') throw httpErr(400, 'pack_bom_id ต้องเป็นสูตรชนิด packaging');
    if (!roastBom.output_material_id) throw httpErr(400, 'สูตรคั่วต้องกำหนด output_material_id');
    if (!packBom.output_product_id) throw httpErr(400, 'สูตรบรรจุต้องกำหนด output_product_id');

    const roastItems = (await Bom.items(client, roastBom.bom_id)).rows;
    const packItems = (await Bom.items(client, packBom.bom_id)).rows;

    const meta = {
      planned_roast_qty: payload.planned_roast_qty,
      planned_pack_qty: payload.planned_pack_qty,
      roast_loss_pct: roastBom.expected_loss_pct,
      pack_loss_pct: packBom.expected_loss_pct,
      output_material_id: roastBom.output_material_id,
    };
    const { demand } = computeStoreDemand(meta, roastItems, packItems);

    // เช็คของว่างที่ Store (available − reserved)
    const stockRows = (await StoreStock.forMaterials(client, demand.map((d) => d.material_id))).rows;
    const stockMap = Object.fromEntries(stockRows.map((s) => [s.material_id, s]));
    const shortages = [];
    for (const d of demand) {
      const s = stockMap[d.material_id];
      const free = s ? Number(s.qty_available) - Number(s.qty_reserved) : 0;
      d.available_free = free;
      if (free < d.required_qty) shortages.push(d);
    }
    if (shortages.length) throw httpErr(400, 'วัตถุดิบที่ Store ไม่พอ (เบิกโอนเพิ่มก่อน)', { shortages });

    const order = (await WorkOrder.insert(client, payload)).rows[0];
    for (const d of demand) await StoreStock.addReserved(client, d.material_id, d.required_qty);

    await client.query('COMMIT');
    return { ...order, store_demand: demand };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// เริ่มงาน: ตัดวัตถุดิบจริงจาก Store + ปล่อยการจอง → in_progress
exports.startOrder = async (id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = (await WorkOrder.getById(client, id)).rows[0];
    if (!order) throw httpErr(404, 'work order not found');
    if (order.status !== 'pending') throw httpErr(409, `ใบสั่งงานต้องเป็น pending (ปัจจุบัน: ${order.status})`);

    const { roastItems, packItems } = await loadBoms(client, order);
    const { demand } = computeStoreDemand(orderMeta(order), roastItems, packItems);

    for (const d of demand) {
      const consumed = (await StoreStock.consume(client, d.material_id, d.required_qty)).rows[0];
      if (!consumed) throw httpErr(400, `Store ไม่พอสำหรับ ${d.material_code} (ขอ ${d.required_qty})`, { material: d });
      await StoreStock.addReserved(client, d.material_id, -d.required_qty); // ปล่อยจอง
    }

    const updated = (await WorkOrder.setStatus(client, id, 'in_progress', 'started_at')).rows[0];
    await client.query('COMMIT');
    return { ...updated, issued_materials: demand };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// จบงาน: บันทึกได้/เสีย 2 จุด → ถุงสำเร็จเข้า stock_levels → completed
exports.completeOrder = async (id, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = (await WorkOrder.getById(client, id)).rows[0];
    if (!order) throw httpErr(404, 'work order not found');
    if (order.status !== 'in_progress') throw httpErr(409, `ใบสั่งงานต้องเป็น in_progress (ปัจจุบัน: ${order.status})`);
    if (payload.roast_produced == null) throw httpErr(400, 'roast_produced is required');
    if (payload.pack_produced == null) throw httpErr(400, 'pack_produced is required');

    const { packItems } = await loadBoms(client, order);
    // เมล็ดคั่วที่บรรจุใช้จริง = สูตรบรรจุ(เมล็ดคั่ว) × ถุงที่ผลิตได้ — ต้องไม่เกินที่คั่วได้
    const roastItem = packItems.find((it) => it.material_id === order.output_material_id);
    const roastedConsumed = roastItem
      ? round3(Number(roastItem.qty_required) * Number(payload.pack_produced))
      : 0;
    if (Number(payload.roast_produced) < roastedConsumed) {
      throw httpErr(400, `เมล็ดคั่วที่ได้ (${payload.roast_produced}) ไม่พอสำหรับบรรจุ ${payload.pack_produced} ถุง (ต้องใช้ ${roastedConsumed})`);
    }

    // ถุงสำเร็จเข้า stock_levels ผ่าน stock_transactions (trigger อัปเดตให้)
    await client.query(
      `INSERT INTO stock_transactions (product_id, txn_type, qty_change, note, staff_id)
       VALUES ($1, 'receive', $2, $3, $4)`,
      [order.output_product_id, payload.pack_produced, `ผลิตเสร็จ ${order.work_no}`, payload.staff_id ?? null]
    );

    const updated = (await WorkOrder.recordOutputs(client, id, payload)).rows[0];
    const finishedStock = (await client.query(
      'SELECT qty_total, qty_available FROM stock_levels WHERE product_id = $1',
      [order.output_product_id]
    )).rows[0];

    await client.query('COMMIT');
    return {
      order: updated,
      roasted_consumed: roastedConsumed,
      finished_stock: { product_sku: order.product_sku, ...finishedStock },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ยกเลิกใบสั่งงาน: ถ้ายัง pending → ปล่อยการจองคืน; ถ้า in_progress → คืนวัตถุดิบเข้า Store
exports.cancelOrder = async (id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = (await WorkOrder.getById(client, id)).rows[0];
    if (!order) throw httpErr(404, 'work order not found');
    if (order.status === 'completed') throw httpErr(409, 'ใบสั่งงานเสร็จแล้ว ยกเลิกไม่ได้');
    if (order.status === 'cancelled') throw httpErr(409, 'ใบสั่งงานถูกยกเลิกแล้ว');

    const { roastItems, packItems } = await loadBoms(client, order);
    const { demand } = computeStoreDemand(orderMeta(order), roastItems, packItems);

    for (const d of demand) {
      if (order.status === 'pending') {
        await StoreStock.addReserved(client, d.material_id, -d.required_qty); // ปล่อยจอง
      } else {
        // in_progress → คืนของที่ตัดไปแล้วกลับเข้า Store
        await client.query(
          `INSERT INTO store_stock (material_id, qty_total, qty_available, updated_at)
           VALUES ($1, $2, $2, now())
           ON CONFLICT (material_id) DO UPDATE
             SET qty_total = store_stock.qty_total + $2,
                 qty_available = store_stock.qty_available + $2, updated_at = now()`,
          [d.material_id, d.required_qty]
        );
      }
    }

    const updated = (await WorkOrder.setStatus(client, id, 'cancelled', null)).rows[0];
    await client.query('COMMIT');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
