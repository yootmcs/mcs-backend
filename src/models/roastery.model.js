// Data access layer สำหรับโมดูลโรงคั่ว (roastery)
// ทุกฟังก์ชันรับ db (client ใน transaction หรือ pool) เป็นตัวแรก
const { pool } = require('../config/db');

// ---- ตัวช่วยออกรหัสอัตโนมัติ: PREFIX-YYMM-NNN (นับต่อเดือน) ----
// ใช้ใน transaction เดียวกับการ insert เพื่อลดโอกาสรหัสชน
// col = คอลัมน์ที่เก็บรหัส (ปกติ 'code'; บางตารางใช้ชื่ออื่น เช่น 'transfer_no')
const nextCode = async (db, table, prefix, col = 'code') => {
  const ym = new Date().toISOString().slice(2, 7).replace('-', ''); // YYMM
  const like = `${prefix}-${ym}-%`;
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(CAST(split_part(${col}, '-', 3) AS int)), 0) AS max_seq
       FROM ${table} WHERE ${col} LIKE $1`,
    [like]
  );
  const seq = String(Number(rows[0].max_seq) + 1).padStart(3, '0');
  return `${prefix}-${ym}-${seq}`;
};

const Suppliers = {
  list: (db = pool) => db.query('SELECT * FROM suppliers ORDER BY code'),

  getById: (db = pool, id) =>
    db.query('SELECT * FROM suppliers WHERE supplier_id = $1', [id]),

  insert: (db, s) =>
    db.query(
      `INSERT INTO suppliers (code, name, contact, phone, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [s.code, s.name, s.contact ?? null, s.phone ?? null, s.note ?? null]
    ),

  update: (db, id, s) =>
    db.query(
      `UPDATE suppliers
          SET name = COALESCE($2, name), contact = $3, phone = $4,
              note = $5, is_active = COALESCE($6, is_active)
        WHERE supplier_id = $1 RETURNING *`,
      [id, s.name ?? null, s.contact ?? null, s.phone ?? null, s.note ?? null, s.is_active ?? null]
    ),
};

const GreenLots = {
  // remaining_kg (derived) = คงเหลือรวมทั้งสองคลัง — เผื่อ UI เดิมที่ยังอ้างชื่อนี้
  list: (db = pool) =>
    db.query(
      `SELECT g.*, (g.qty_central_kg + g.qty_store_kg) AS remaining_kg,
              s.name AS supplier_name
         FROM green_coffee_lots g
         LEFT JOIN suppliers s USING (supplier_id)
        ORDER BY g.received_date DESC, g.code DESC`
    ),

  getById: (db = pool, id) =>
    db.query(
      `SELECT g.*, (g.qty_central_kg + g.qty_store_kg) AS remaining_kg,
              s.name AS supplier_name
         FROM green_coffee_lots g
         LEFT JOIN suppliers s USING (supplier_id)
        WHERE g.lot_id = $1`,
      [id]
    ),

  // รับ green เข้า → ลงช่องคลังกลาง (qty_central_kg = น้ำหนักที่รับ); ยังไม่มีที่ Store
  insert: (db, code, g) =>
    db.query(
      `INSERT INTO green_coffee_lots
           (code, supplier_id, received_date, origin, variety, process_method,
            moisture_pct, weight_kg, qty_central_kg, price_per_kg, note)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5, COALESCE($6, 'washed'),
               $7, $8, $8, $9, $10)
       RETURNING *`,
      [code, g.supplier_id ?? null, g.received_date ?? null, g.origin, g.variety ?? null,
       g.process_method ?? null, g.moisture_pct ?? null, g.weight_kg,
       g.price_per_kg ?? 0, g.note ?? null]
    ),

  // แก้ไขได้เฉพาะข้อมูลอธิบาย (ไม่ยุ่ง remaining_kg ที่ trigger ดูแล)
  update: (db, id, g) =>
    db.query(
      `UPDATE green_coffee_lots
          SET supplier_id = $2, received_date = COALESCE($3, received_date),
              origin = COALESCE($4, origin), variety = $5,
              process_method = COALESCE($6, process_method),
              moisture_pct = $7, price_per_kg = COALESCE($8, price_per_kg), note = $9
        WHERE lot_id = $1 RETURNING *`,
      [id, g.supplier_id ?? null, g.received_date ?? null, g.origin ?? null, g.variety ?? null,
       g.process_method ?? null, g.moisture_pct ?? null, g.price_per_kg ?? null, g.note ?? null]
    ),

  delete: (db, id) => db.query('DELETE FROM green_coffee_lots WHERE lot_id = $1 RETURNING lot_id', [id]),

  usedInRoast: (db = pool, id) =>
    db.query('SELECT 1 FROM roast_batches WHERE lot_id = $1 LIMIT 1', [id]),

  // ล็อคแถวล็อต + อ่านช่องคงเหลือ (ใช้ตอนจอง/ตรวจของก่อนเปิดใบสั่งงาน)
  lockById: (db, id) =>
    db.query(
      'SELECT lot_id, code, qty_central_kg, qty_store_kg, qty_store_reserved_kg FROM green_coffee_lots WHERE lot_id = $1 FOR UPDATE',
      [id]
    ),

  // ปรับยอดจองที่ Store (+/-) ของล็อต green (ไลน์ผลิตจองเมล็ดไว้ก่อนคั่ว)
  addStoreReserved: (db, id, delta) =>
    db.query(
      `UPDATE green_coffee_lots SET qty_store_reserved_kg = qty_store_reserved_kg + $2
        WHERE lot_id = $1 RETURNING *`,
      [id, delta]
    ),
};

// ใบเบิกโอนล็อต green (คลังกลาง ↔ Store) — trigger ย้าย kg ระหว่างสองช่องของล็อต
const GreenTransfers = {
  insert: (db, transferNo, t) =>
    db.query(
      `INSERT INTO green_lot_transfers (transfer_no, lot_id, direction, qty_kg, transferred_date, note, staff_id)
       VALUES ($1, $2, COALESCE($3, 'to_store'), $4, COALESCE($5, CURRENT_DATE), $6, $7)
       RETURNING *`,
      [transferNo, t.lot_id, t.direction ?? null, t.qty_kg, t.transferred_date ?? null, t.note ?? null, t.staff_id ?? null]
    ),

  list: (db = pool) =>
    db.query(
      `SELECT t.*, g.code AS lot_code, g.origin
         FROM green_lot_transfers t
         JOIN green_coffee_lots g USING (lot_id)
        ORDER BY t.created_at DESC`
    ),
};

const Roasting = {
  list: (db = pool) =>
    db.query(
      `SELECT r.*, g.code AS lot_code, g.origin, g.variety
         FROM roast_batches r
         JOIN green_coffee_lots g USING (lot_id)
        ORDER BY r.roast_date DESC, r.code DESC`
    ),

  getById: (db = pool, id) =>
    db.query(
      `SELECT r.*, g.code AS lot_code, g.origin, g.variety
         FROM roast_batches r
         JOIN green_coffee_lots g USING (lot_id)
        WHERE r.batch_id = $1`,
      [id]
    ),

  insert: (db, code, r) =>
    db.query(
      `INSERT INTO roast_batches
           (code, lot_id, roast_date, roast_level, green_weight_in, roasted_weight_out,
            operator, machine, note, work_order_id)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), COALESCE($4, 'medium'), $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [code, r.lot_id, r.roast_date ?? null, r.roast_level ?? null,
       r.green_weight_in, r.roasted_weight_out, r.operator ?? null, r.machine ?? null,
       r.note ?? null, r.work_order_id ?? null]
    ),

  // ลดกาแฟคั่วคงเหลือของล็อตคั่ว (ส่วนที่ถูกบรรจุเป็นถุงในงานเดียวกัน)
  reduceRoasted: (db, batchId, kg) =>
    db.query(
      `UPDATE roast_batches
          SET remaining_roasted_kg = GREATEST(0, remaining_roasted_kg - $2)
        WHERE batch_id = $1 RETURNING *`,
      [batchId, kg]
    ),

  delete: (db, id) => db.query('DELETE FROM roast_batches WHERE batch_id = $1 RETURNING batch_id', [id]),

  usedInOrder: (db = pool, id) =>
    db.query('SELECT 1 FROM sales_order_allocations WHERE batch_id = $1 LIMIT 1', [id]),

  // สรุปกาแฟคั่วคงเหลือแยกตามระดับคั่ว
  stockByLevel: (db = pool) =>
    db.query(
      `SELECT roast_level, SUM(remaining_roasted_kg) AS kg
         FROM roast_batches GROUP BY roast_level`
    ),
};

const Packaging = {
  list: (db = pool) => db.query('SELECT * FROM packaging_items ORDER BY name'),

  insert: (db, p) =>
    db.query(
      `INSERT INTO packaging_items (name, unit, quantity, reorder_level, note)
       VALUES ($1, COALESCE($2, 'ชิ้น'), $3, $4, $5) RETURNING *`,
      [p.name, p.unit ?? null, p.quantity ?? 0, p.reorder_level ?? 0, p.note ?? null]
    ),

  update: (db, id, p) =>
    db.query(
      `UPDATE packaging_items
          SET name = COALESCE($2, name), unit = COALESCE($3, unit),
              quantity = COALESCE($4, quantity), reorder_level = COALESCE($5, reorder_level),
              note = $6
        WHERE packaging_id = $1 RETURNING *`,
      [id, p.name ?? null, p.unit ?? null, p.quantity ?? null, p.reorder_level ?? null, p.note ?? null]
    ),

  // ปรับจำนวนแบบ +/- (กันติดลบ)
  adjust: (db, id, delta) =>
    db.query(
      `UPDATE packaging_items
          SET quantity = GREATEST(0, quantity + $2)
        WHERE packaging_id = $1 RETURNING *`,
      [id, delta]
    ),

  delete: (db, id) => db.query('DELETE FROM packaging_items WHERE packaging_id = $1 RETURNING packaging_id', [id]),
};

const SalesOrders = {
  list: (db = pool) =>
    db.query(
      `SELECT o.*,
              COALESCE(a.total_kg, 0) AS total_kg,
              COALESCE(fa.total_bags, 0) AS allocated_bags,
              p.sku AS product_sku, p.name AS product_name,
              CASE WHEN o.product_id IS NOT NULL
                   THEN COALESCE(fa.total_bags, 0) * o.unit_price
                   ELSE COALESCE(a.total_kg, 0) * o.unit_price END AS total_value
         FROM sales_orders o
         LEFT JOIN products p ON p.product_id = o.product_id
         LEFT JOIN (
           SELECT order_id, SUM(qty_kg) AS total_kg
             FROM sales_order_allocations GROUP BY order_id
         ) a USING (order_id)
         LEFT JOIN (
           SELECT order_id, SUM(qty_bags) AS total_bags
             FROM finished_allocations GROUP BY order_id
         ) fa USING (order_id)
        ORDER BY o.order_date DESC, o.code DESC`
    ),

  getById: (db = pool, id) =>
    db.query('SELECT * FROM sales_orders WHERE order_id = $1', [id]),

  insertOrder: (db, code, o) =>
    db.query(
      `INSERT INTO sales_orders
           (code, order_date, customer, destination, currency, unit_price, status, note, product_id, qty_bags)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, COALESCE($5, 'THB'), $6, COALESCE($7, 'pending'), $8, $9, $10)
       RETURNING *`,
      [code, o.order_date ?? null, o.customer, o.destination ?? null,
       o.currency ?? null, o.unit_price ?? 0, o.status ?? null, o.note ?? null,
       o.product_id ?? null, o.qty_bags ?? null]
    ),

  insertAllocation: (db, orderId, a) =>
    db.query(
      `INSERT INTO sales_order_allocations (order_id, batch_id, qty_kg)
       VALUES ($1, $2, $3) RETURNING *`,
      [orderId, a.batch_id, a.qty_kg]
    ),

  // ---- ขายถุงสำเร็จ (finished goods) แบบ FEFO ----
  // จัดสรรถุงจากล็อตสำเร็จให้ออเดอร์ (trigger หัก qty_remaining + กันติดลบ)
  insertFinishedAllocation: (db, orderId, finishedLotId, qtyBags) =>
    db.query(
      `INSERT INTO finished_allocations (order_id, finished_lot_id, qty_bags)
       VALUES ($1, $2, $3) RETURNING *`,
      [orderId, finishedLotId, qtyBags]
    ),

  // ล็อตถุงสำเร็จของสินค้าหนึ่ง ที่ยังมีเหลือ เรียง FEFO (คั่วก่อน-ออกก่อน) + lock
  fefoFinishedLots: (db, productId) =>
    db.query(
      `SELECT finished_lot_id, code, roast_date, qty_remaining
         FROM finished_lots
        WHERE product_id = $1 AND qty_remaining > 0
        ORDER BY roast_date ASC NULLS LAST, produced_at ASC
        FOR UPDATE`,
      [productId]
    ),

  // จัดสรรถุงของออเดอร์ + ล็อตที่ใช้ (ไว้แสดง/ตามรอย)
  finishedAllocations: (db = pool, orderId) =>
    db.query(
      `SELECT fa.*, fl.code AS finished_lot_code, fl.roast_date,
              rb.code AS batch_code, g.code AS green_lot_code, g.origin AS green_origin
         FROM finished_allocations fa
         JOIN finished_lots fl ON fl.finished_lot_id = fa.finished_lot_id
         LEFT JOIN roast_batches rb ON rb.batch_id = fl.batch_id
         LEFT JOIN green_coffee_lots g ON g.lot_id = rb.lot_id
        WHERE fa.order_id = $1
        ORDER BY fa.created_at`,
      [orderId]
    ),

  allocations: (db = pool, orderId) =>
    db.query(
      `SELECT a.*, r.code AS batch_code, r.roast_level
         FROM sales_order_allocations a
         JOIN roast_batches r USING (batch_id)
        WHERE a.order_id = $1
        ORDER BY a.created_at`,
      [orderId]
    ),

  setStatus: (db, id, status) =>
    db.query('UPDATE sales_orders SET status = $2 WHERE order_id = $1 RETURNING *', [id, status]),

  delete: (db, id) => db.query('DELETE FROM sales_orders WHERE order_id = $1 RETURNING order_id', [id]),
};

module.exports = { nextCode, Suppliers, GreenLots, GreenTransfers, Roasting, Packaging, SalesOrders };
