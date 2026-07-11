// Business logic layer — โมดูลโรงคั่ว (roastery)
// ครอบ transaction ให้การออกรหัส + insert หลายแถว atomic; ปล่อยการตัดสต็อกให้ trigger
const { pool } = require('../config/db');
const { nextCode, Suppliers, GreenLots, Roasting, Packaging, SalesOrders } = require('../models/roastery.model');

const LOW_RAW_THRESHOLD = 50; // กก. — สารกาแฟดิบเหลือน้อยกว่านี้ = แจ้งเตือน

function httpErr(status, message, data) {
  const e = new Error(message);
  e.statusCode = status;
  if (data) e.data = data;
  return e;
}

// ---- Suppliers ----
exports.listSuppliers = async () => (await Suppliers.list()).rows;

exports.createSupplier = async (payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const code = payload.code || (await nextCode(client, 'suppliers', 'SUP'));
    const row = (await Suppliers.insert(client, { ...payload, code })).rows[0];
    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.updateSupplier = async (id, payload) => {
  const row = (await Suppliers.update(pool, id, payload)).rows[0];
  if (!row) throw httpErr(404, 'supplier not found');
  return row;
};

// ---- Green coffee lots (รับวัตถุดิบ) ----
exports.listGreenLots = async () => (await GreenLots.list()).rows;

exports.getGreenLot = async (id) => (await GreenLots.getById(pool, id)).rows[0] || null;

exports.createGreenLot = async (payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const code = payload.code || (await nextCode(client, 'green_coffee_lots', 'GC'));
    const row = (await GreenLots.insert(client, code, payload)).rows[0];
    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.updateGreenLot = async (id, payload) => {
  const row = (await GreenLots.update(pool, id, payload)).rows[0];
  if (!row) throw httpErr(404, 'green lot not found');
  return row;
};

exports.deleteGreenLot = async (id) => {
  if ((await GreenLots.usedInRoast(pool, id)).rows.length) {
    throw httpErr(409, 'ล็อตนี้ถูกใช้ในการคั่วแล้ว ไม่สามารถลบได้');
  }
  const row = (await GreenLots.delete(pool, id)).rows[0];
  if (!row) throw httpErr(404, 'green lot not found');
  return row;
};

// ---- Roasting (คั่ว) ----
exports.listRoastBatches = async () => (await Roasting.list()).rows;

exports.getRoastBatch = async (id) => (await Roasting.getById(pool, id)).rows[0] || null;

// trigger จะเช็คว่าสารดิบพอไหม + หักให้ + คำนวณ loss_pct ให้เอง
exports.createRoastBatch = async (payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const code = payload.code || (await nextCode(client, 'roast_batches', 'RB'));
    const row = (await Roasting.insert(client, code, payload)).rows[0];
    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.deleteRoastBatch = async (id) => {
  if ((await Roasting.usedInOrder(pool, id)).rows.length) {
    throw httpErr(409, 'ล็อตคั่วนี้ถูกจัดสรรในคำสั่งซื้อแล้ว ไม่สามารถลบได้');
  }
  const row = (await Roasting.delete(pool, id)).rows[0]; // trigger คืนสารดิบเข้าล็อตเดิม
  if (!row) throw httpErr(404, 'roast batch not found');
  return row;
};

// ---- Packaging (บรรจุภัณฑ์) ----
exports.listPackaging = async () => (await Packaging.list()).rows;

exports.createPackaging = async (payload) => (await Packaging.insert(pool, payload)).rows[0];

exports.updatePackaging = async (id, payload) => {
  const row = (await Packaging.update(pool, id, payload)).rows[0];
  if (!row) throw httpErr(404, 'packaging item not found');
  return row;
};

exports.adjustPackaging = async (id, delta) => {
  const row = (await Packaging.adjust(pool, id, delta)).rows[0];
  if (!row) throw httpErr(404, 'packaging item not found');
  return row;
};

exports.deletePackaging = async (id) => {
  const row = (await Packaging.delete(pool, id)).rows[0];
  if (!row) throw httpErr(404, 'packaging item not found');
  return row;
};

// ---- Sales orders (คำสั่งซื้อ/ส่งออก) ----
exports.listSalesOrders = async () => (await SalesOrders.list()).rows;

exports.getSalesOrder = async (id) => {
  const order = (await SalesOrders.getById(pool, id)).rows[0];
  if (!order) return null;
  const allocations = (await SalesOrders.allocations(pool, id)).rows;
  const total_kg = allocations.reduce((s, a) => s + Number(a.qty_kg), 0);
  return { ...order, allocations, total_kg, total_value: total_kg * Number(order.unit_price) };
};

// สร้างคำสั่งซื้อ + จัดสรรจากล็อตคั่ว (atomic) — trigger หักกาแฟคั่ว/กันติดลบ
exports.createSalesOrder = async (payload) => {
  const allocations = payload.allocations || [];
  if (!allocations.length) throw httpErr(400, 'ต้องมี allocations อย่างน้อย 1 รายการ');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const code = payload.code || (await nextCode(client, 'sales_orders', 'EX'));
    const order = (await SalesOrders.insertOrder(client, code, payload)).rows[0];
    const saved = [];
    for (const a of allocations) {
      saved.push((await SalesOrders.insertAllocation(client, order.order_id, a)).rows[0]);
    }
    await client.query('COMMIT');
    return { ...order, allocations: saved };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.setSalesOrderStatus = async (id, status) => {
  const row = (await SalesOrders.setStatus(pool, id, status)).rows[0];
  if (!row) throw httpErr(404, 'sales order not found');
  return row;
};

// ลบคำสั่งซื้อ → allocations ถูกลบแบบ CASCADE → trigger คืนกาแฟคั่วเข้าล็อต
exports.deleteSalesOrder = async (id) => {
  const row = (await SalesOrders.delete(pool, id)).rows[0];
  if (!row) throw httpErr(404, 'sales order not found');
  return row;
};

// ---- Dashboard summary (แดชบอร์ดภาพรวม) ----
exports.dashboardSummary = async () => {
  const [green, roasted, batches, pending, lowRaw, lowPkg, byLevel] = await Promise.all([
    pool.query('SELECT COALESCE(SUM(remaining_kg), 0) AS kg FROM green_coffee_lots'),
    pool.query('SELECT COALESCE(SUM(remaining_roasted_kg), 0) AS kg FROM roast_batches'),
    pool.query(`SELECT count(*) AS n FROM roast_batches
                 WHERE date_trunc('month', roast_date) = date_trunc('month', CURRENT_DATE)`),
    pool.query(`SELECT count(*) AS n FROM sales_orders WHERE status <> 'shipped'`),
    pool.query(
      `SELECT g.code, g.origin, g.remaining_kg, s.name AS supplier_name
         FROM green_coffee_lots g
         LEFT JOIN suppliers s USING (supplier_id)
        WHERE g.remaining_kg > 0 AND g.remaining_kg < $1
        ORDER BY g.remaining_kg`,
      [LOW_RAW_THRESHOLD]
    ),
    pool.query(
      `SELECT name, quantity, reorder_level, unit FROM packaging_items
        WHERE quantity <= reorder_level ORDER BY name`
    ),
    Roasting.stockByLevel(pool),
  ]);

  return {
    raw_remaining_kg: Number(green.rows[0].kg),
    roasted_remaining_kg: Number(roasted.rows[0].kg),
    batches_this_month: Number(batches.rows[0].n),
    pending_orders: Number(pending.rows[0].n),
    low_raw: lowRaw.rows,
    low_packaging: lowPkg.rows,
    roasted_by_level: byLevel.rows,
  };
};
