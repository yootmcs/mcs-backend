// Data access layer สำหรับโมดูลโรงคั่ว (roastery)
// ทุกฟังก์ชันรับ db (client ใน transaction หรือ pool) เป็นตัวแรก
const { pool } = require('../config/db');

// ---- ตัวช่วยออกรหัสอัตโนมัติ: PREFIX-YYMM-NNN (นับต่อเดือน) ----
// ใช้ใน transaction เดียวกับการ insert เพื่อลดโอกาสรหัสชน
const nextCode = async (db, table, prefix) => {
  const ym = new Date().toISOString().slice(2, 7).replace('-', ''); // YYMM
  const like = `${prefix}-${ym}-%`;
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(CAST(split_part(code, '-', 3) AS int)), 0) AS max_seq
       FROM ${table} WHERE code LIKE $1`,
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
  list: (db = pool) =>
    db.query(
      `SELECT g.*, s.name AS supplier_name
         FROM green_coffee_lots g
         LEFT JOIN suppliers s USING (supplier_id)
        ORDER BY g.received_date DESC, g.code DESC`
    ),

  getById: (db = pool, id) =>
    db.query(
      `SELECT g.*, s.name AS supplier_name
         FROM green_coffee_lots g
         LEFT JOIN suppliers s USING (supplier_id)
        WHERE g.lot_id = $1`,
      [id]
    ),

  insert: (db, code, g) =>
    db.query(
      `INSERT INTO green_coffee_lots
           (code, supplier_id, received_date, origin, variety, process_method,
            moisture_pct, weight_kg, remaining_kg, price_per_kg, note)
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
            operator, machine, note)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), COALESCE($4, 'medium'), $5, $6, $7, $8, $9)
       RETURNING *`,
      [code, r.lot_id, r.roast_date ?? null, r.roast_level ?? null,
       r.green_weight_in, r.roasted_weight_out, r.operator ?? null, r.machine ?? null, r.note ?? null]
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
              (COALESCE(a.total_kg, 0) * o.unit_price) AS total_value
         FROM sales_orders o
         LEFT JOIN (
           SELECT order_id, SUM(qty_kg) AS total_kg
             FROM sales_order_allocations GROUP BY order_id
         ) a USING (order_id)
        ORDER BY o.order_date DESC, o.code DESC`
    ),

  getById: (db = pool, id) =>
    db.query('SELECT * FROM sales_orders WHERE order_id = $1', [id]),

  insertOrder: (db, code, o) =>
    db.query(
      `INSERT INTO sales_orders
           (code, order_date, customer, destination, currency, unit_price, status, note)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, COALESCE($5, 'THB'), $6, COALESCE($7, 'pending'), $8)
       RETURNING *`,
      [code, o.order_date ?? null, o.customer, o.destination ?? null,
       o.currency ?? null, o.unit_price ?? 0, o.status ?? null, o.note ?? null]
    ),

  insertAllocation: (db, orderId, a) =>
    db.query(
      `INSERT INTO sales_order_allocations (order_id, batch_id, qty_kg)
       VALUES ($1, $2, $3) RETURNING *`,
      [orderId, a.batch_id, a.qty_kg]
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

module.exports = { nextCode, Suppliers, GreenLots, Roasting, Packaging, SalesOrders };
