// Business logic: ใบสั่งงานรวม (คั่ว + บรรจุ)
//   - เมล็ด green: เบิกจาก "ล็อต green" ที่ Store (qty_store_kg) — ตามรอยรายล็อต
//   - ถุง/ฟอล์ย: เบิกจาก store_stock (คลัง Store ของวัสดุทั่วไป)
//   - จบงาน: สร้าง roast_batch (lineage) + finished_lot (ล็อตถุงสำเร็จ ตราวันคั่ว)
const { pool } = require('../config/db');
const { Bom } = require('../models/bom.model');
const { WorkOrder, FinishedLots } = require('../models/workorder.model');
const { StoreStock } = require('../models/warehouse.model');
const { nextCode, GreenLots, Roasting } = require('../models/roastery.model');

const round3 = (n) => Math.round(n * 1000) / 1000;

function httpErr(status, message, data) {
  const e = new Error(message);
  e.statusCode = status;
  if (data) e.data = data;
  return e;
}

// วัตถุดิบที่ต้องเบิกจาก store_stock (เฉพาะ "ช่วงบรรจุ" — ถุง/ฟอล์ย)
//   pack items × planned_pack × (1 + pack_loss%)  ยกเว้นเมล็ดคั่ว (ของกลางในงาน)
// เมล็ด green ไม่อยู่ในนี้ — เบิกจากล็อต green ต่างหาก
function computePackDemand(order, packItems) {
  const packFactor = 1 + Number(order.pack_loss_pct || 0) / 100;
  const roastMatId = order.output_material_id; // เมล็ดคั่วกึ่งสำเร็จ (ของกลาง)

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

  let roastedNeeded = 0;
  for (const it of packItems) {
    if (it.material_id === roastMatId) {
      roastedNeeded = round3(Number(it.qty_required) * Number(order.planned_pack_qty) * packFactor);
      continue; // เมล็ดคั่ว = ของกลาง ไม่เบิกจาก store_stock
    }
    add(it, Number(it.qty_required) * Number(order.planned_pack_qty) * packFactor);
  }
  return { demand: [...map.values()], roastedNeeded };
}

// โหลด BOM คั่ว/บรรจุ + validate ชนิด (roast items เป็น optional เพราะ green มาจากล็อต)
async function loadBoms(db, order) {
  const roastBom = (await Bom.getById(db, order.roast_bom_id)).rows[0];
  const packBom = (await Bom.getById(db, order.pack_bom_id)).rows[0];
  if (!roastBom || roastBom.bom_type !== 'roasting') throw httpErr(400, 'roast_bom_id ต้องเป็นสูตรชนิด roasting');
  if (!packBom || packBom.bom_type !== 'packaging') throw httpErr(400, 'pack_bom_id ต้องเป็นสูตรชนิด packaging');
  if (!roastBom.output_material_id) throw httpErr(400, 'สูตรคั่วต้องกำหนด output_material_id (เมล็ดคั่ว)');
  if (!packBom.output_product_id) throw httpErr(400, 'สูตรบรรจุต้องกำหนด output_product_id (สินค้าสำเร็จรูป)');
  const packItems = (await Bom.items(db, packBom.bom_id)).rows;
  if (!packItems.length) throw httpErr(400, 'สูตรบรรจุต้องมีส่วนผสม');
  return { roastBom, packBom, packItems };
}

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
  const { packItems } = await loadBoms(pool, order);
  const { demand, roastedNeeded } = computePackDemand(orderMeta(order), packItems);
  return { ...order, store_demand: demand, roasted_needed: roastedNeeded };
};

// เปิดใบสั่งงาน: เช็ค green ที่ล็อตพอไหม + เช็ค/จองถุงที่ store_stock → จองทั้งคู่
exports.createOrder = async (payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!payload.green_lot_id) throw httpErr(400, 'green_lot_id is required (เลือกล็อตเมล็ดที่จะคั่ว)');

    const roastBom = (await Bom.getById(client, payload.roast_bom_id)).rows[0];
    const packBom = (await Bom.getById(client, payload.pack_bom_id)).rows[0];
    if (!roastBom || roastBom.bom_type !== 'roasting') throw httpErr(400, 'roast_bom_id ต้องเป็นสูตรชนิด roasting');
    if (!packBom || packBom.bom_type !== 'packaging') throw httpErr(400, 'pack_bom_id ต้องเป็นสูตรชนิด packaging');
    if (!roastBom.output_material_id) throw httpErr(400, 'สูตรคั่วต้องกำหนด output_material_id');
    if (!packBom.output_product_id) throw httpErr(400, 'สูตรบรรจุต้องกำหนด output_product_id');

    const packItems = (await Bom.items(client, packBom.bom_id)).rows;
    if (!packItems.length) throw httpErr(400, 'สูตรบรรจุต้องมีส่วนผสม');

    const plannedGreen = round3(Number(payload.planned_roast_qty));

    // 1) เช็คล็อต green ที่ Store พอไหม (available = store − reserved)
    const lot = (await GreenLots.lockById(client, payload.green_lot_id)).rows[0];
    if (!lot) throw httpErr(400, 'ไม่พบล็อต green ที่เลือก');
    const greenFree = round3(Number(lot.qty_store_kg) - Number(lot.qty_store_reserved_kg));
    if (greenFree < plannedGreen) {
      throw httpErr(400, `เมล็ดที่ Store ไม่พอ: ล็อต ${lot.code} ว่าง ${greenFree} กก. แต่วางแผนคั่ว ${plannedGreen} กก. (เบิกโอนเข้า Store ก่อน)`,
        { lot_code: lot.code, green_free: greenFree, planned: plannedGreen });
    }

    // 2) เช็คถุง/ฟอล์ยที่ store_stock พอไหม
    const meta = {
      planned_roast_qty: plannedGreen, planned_pack_qty: payload.planned_pack_qty,
      roast_loss_pct: roastBom.expected_loss_pct, pack_loss_pct: packBom.expected_loss_pct,
      output_material_id: roastBom.output_material_id,
    };
    const { demand } = computePackDemand(meta, packItems);
    const stockRows = (await StoreStock.forMaterials(client, demand.map((d) => d.material_id))).rows;
    const stockMap = Object.fromEntries(stockRows.map((s) => [s.material_id, s]));
    const shortages = [];
    for (const d of demand) {
      const s = stockMap[d.material_id];
      const free = s ? Number(s.qty_available) - Number(s.qty_reserved) : 0;
      d.available_free = free;
      if (free < d.required_qty) shortages.push(d);
    }
    if (shortages.length) throw httpErr(400, 'วัสดุบรรจุที่ Store ไม่พอ (เบิกโอนเพิ่มก่อน)', { shortages });

    // 3) เปิดใบ + จอง green ที่ล็อต + จองถุงที่ store_stock
    const order = (await WorkOrder.insert(client, payload)).rows[0];
    await GreenLots.addStoreReserved(client, payload.green_lot_id, plannedGreen);
    for (const d of demand) await StoreStock.addReserved(client, d.material_id, d.required_qty);

    await client.query('COMMIT');
    return { ...order, green_reserved_kg: plannedGreen, store_demand: demand };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// เริ่มงาน: ตัดถุง/ฟอล์ยจริงจาก store_stock + ปล่อยจอง (green ยังจองที่ล็อต รอคั่วตอนจบ)
exports.startOrder = async (id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = (await WorkOrder.getById(client, id)).rows[0];
    if (!order) throw httpErr(404, 'work order not found');
    if (order.status !== 'pending') throw httpErr(409, `ใบสั่งงานต้องเป็น pending (ปัจจุบัน: ${order.status})`);

    const { packItems } = await loadBoms(client, order);
    const { demand } = computePackDemand(orderMeta(order), packItems);

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

// จบงาน: บันทึกได้/เสีย 2 จุด → สร้าง roast_batch (หัก green ที่ล็อต) + finished_lot → completed
exports.completeOrder = async (id, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = (await WorkOrder.getById(client, id)).rows[0];
    if (!order) throw httpErr(404, 'work order not found');
    if (order.status !== 'in_progress') throw httpErr(409, `ใบสั่งงานต้องเป็น in_progress (ปัจจุบัน: ${order.status})`);
    if (payload.roast_produced == null) throw httpErr(400, 'roast_produced is required');
    if (payload.pack_produced == null) throw httpErr(400, 'pack_produced is required');
    if (!order.green_lot_id) throw httpErr(400, 'ใบสั่งงานนี้ไม่ได้ผูกล็อต green');

    const roastProduced = round3(Number(payload.roast_produced));
    const plannedGreen = round3(Number(order.planned_roast_qty));
    // green ที่โหลดเข้าเตาจริง (ถ้าไม่ระบุ ใช้ตามแผน) — ต้อง ≥ ที่คั่วได้
    const greenIn = round3(Number(payload.green_used ?? plannedGreen));
    if (roastProduced <= 0) throw httpErr(400, 'roast_produced ต้อง > 0');
    if (roastProduced > greenIn) throw httpErr(400, `คั่วได้ (${roastProduced}) มากกว่าเมล็ดที่โหลด (${greenIn}) ไม่ได้`);

    const { roastBom, packItems } = await loadBoms(client, order);
    // เมล็ดคั่วที่บรรจุใช้จริง = สูตรบรรจุ(เมล็ดคั่ว) × ถุงที่ผลิตได้ — ต้องไม่เกินที่คั่วได้
    const roastItem = packItems.find((it) => it.material_id === order.output_material_id);
    const roastedConsumed = roastItem ? round3(Number(roastItem.qty_required) * Number(payload.pack_produced)) : 0;
    if (roastProduced < roastedConsumed) {
      throw httpErr(400, `เมล็ดคั่วที่ได้ (${roastProduced}) ไม่พอสำหรับบรรจุ ${payload.pack_produced} ถุง (ต้องใช้ ${roastedConsumed})`);
    }

    // 1) ปล่อยจอง green ที่ล็อต แล้วสร้าง roast_batch → trigger หัก qty_store_kg + คำนวณ loss
    await GreenLots.addStoreReserved(client, order.green_lot_id, -plannedGreen);
    const batchCode = await nextCode(client, 'roast_batches', 'RB');
    let batch;
    try {
      batch = (await Roasting.insert(client, batchCode, {
        lot_id: order.green_lot_id, roast_date: null, roast_level: order.roast_level,
        green_weight_in: greenIn, roasted_weight_out: roastProduced,
        operator: payload.staff_id ?? null, machine: payload.machine ?? null,
        note: `ใบสั่งงาน ${order.work_no}`, work_order_id: id,
      })).rows[0];
    } catch (e) {
      if (e.code === '23514') throw httpErr(400, e.message); // เมล็ดที่ Store ไม่พอ (จาก trigger)
      throw e;
    }
    await WorkOrder.setBatch(client, id, batch.batch_id);
    // เมล็ดคั่วที่ถูกบรรจุเป็นถุง → หักออกจากคงเหลือคั่วของล็อต (ที่เหลือ = คั่วที่ไม่ได้บรรจุ)
    if (roastedConsumed > 0) await Roasting.reduceRoasted(client, batch.batch_id, roastedConsumed);

    // 2) ถุงสำเร็จ → บันทึกเป็น finished_lot (ตราวันคั่ว + สาวกลับ batch) + เข้า stock_levels
    const flCode = await nextCode(client, 'finished_lots', 'FL');
    const finishedLot = (await FinishedLots.insert(client, flCode, {
      product_id: order.output_product_id, work_id: id, batch_id: batch.batch_id,
      roast_date: batch.roast_date, roast_level: batch.roast_level, qty_produced: payload.pack_produced,
    })).rows[0];

    await client.query(
      `INSERT INTO stock_transactions (product_id, txn_type, qty_change, note, staff_id)
       VALUES ($1, 'receive', $2, $3, $4)`,
      [order.output_product_id, payload.pack_produced, `ผลิตเสร็จ ${order.work_no} (ล็อต ${finishedLot.code})`, payload.staff_id ?? null]
    );

    const updated = (await WorkOrder.recordOutputs(client, id, payload)).rows[0];
    const finishedStock = (await client.query(
      'SELECT qty_total, qty_available FROM stock_levels WHERE product_id = $1',
      [order.output_product_id]
    )).rows[0];

    await client.query('COMMIT');
    return {
      order: updated,
      roast_batch: { code: batch.code, loss_pct: batch.loss_pct, green_in: greenIn, roasted_out: roastProduced },
      finished_lot: { code: finishedLot.code, roast_date: finishedLot.roast_date, qty: finishedLot.qty_produced },
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

// ยกเลิก: pending → ปล่อยจอง (green + ถุง) ; in_progress → ปล่อยจอง green + คืนถุงเข้า Store
// (green ยังไม่ถูกหักจนกว่าจะจบงาน จึงแค่ปล่อยจอง)
exports.cancelOrder = async (id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = (await WorkOrder.getById(client, id)).rows[0];
    if (!order) throw httpErr(404, 'work order not found');
    if (order.status === 'completed') throw httpErr(409, 'ใบสั่งงานเสร็จแล้ว ยกเลิกไม่ได้');
    if (order.status === 'cancelled') throw httpErr(409, 'ใบสั่งงานถูกยกเลิกแล้ว');

    const { packItems } = await loadBoms(client, order);
    const { demand } = computePackDemand(orderMeta(order), packItems);

    // ปล่อยจอง green ที่ล็อต (ทั้ง pending และ in_progress — green ยังไม่ถูกหัก)
    if (order.green_lot_id) {
      await GreenLots.addStoreReserved(client, order.green_lot_id, -round3(Number(order.planned_roast_qty)));
    }

    for (const d of demand) {
      if (order.status === 'pending') {
        await StoreStock.addReserved(client, d.material_id, -d.required_qty); // ปล่อยจองถุง
      } else {
        // in_progress → คืนถุงที่ตัดไปแล้วกลับเข้า Store
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

// รายการล็อตถุงสำเร็จ + สายเลือดตามรอย (ถุง → คั่ว → ล็อต green → ซัพ)
exports.listFinishedLots = async (productId) => (await FinishedLots.listWithLineage(pool, productId)).rows;
