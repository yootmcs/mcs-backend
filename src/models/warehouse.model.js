// Data access layer สำหรับ warehouse — ทุกฟังก์ชันรับ db (client หรือ pool)
const { pool } = require('../config/db');

const Materials = {
  list: (db = pool, category) =>
    category
      ? db.query('SELECT * FROM raw_materials WHERE category = $1 ORDER BY code', [category])
      : db.query('SELECT * FROM raw_materials ORDER BY code'),

  create: (db = pool, m) =>
    db.query(
      // qty_min_alert เป็น numeric — default ที่ JS เลี่ยง pg เดา type จาก COALESCE literal เป็น integer
      `INSERT INTO raw_materials (code, name, category, unit, unit_cost, qty_min_alert)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [m.code, m.name, m.category, m.unit, m.unit_cost ?? null, m.qty_min_alert ?? 10]
    ),
};

const Receipts = {
  insert: (db, r) =>
    db.query(
      `INSERT INTO warehouse_receipts (receipt_no, supplier_name, received_date, note, staff_id)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5)
       RETURNING *`,
      [r.receipt_no, r.supplier_name ?? null, r.received_date ?? null, r.note ?? null, r.staff_id ?? null]
    ),

  insertItem: (db, receiptId, it) =>
    db.query(
      `INSERT INTO warehouse_receipt_items
           (receipt_id, material_id, lot_number, mfd_date, exp_date, qty_received, unit_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [receiptId, it.material_id, it.lot_number ?? null, it.mfd_date ?? null, it.exp_date ?? null, it.qty_received ?? null, it.unit_cost ?? null]
    ),

  list: (db = pool) =>
    db.query('SELECT * FROM warehouse_receipts ORDER BY created_at DESC'),

  getById: (db = pool, id) =>
    db.query('SELECT * FROM warehouse_receipts WHERE receipt_id = $1', [id]),

  itemsByReceipt: (db = pool, id) =>
    db.query(
      `SELECT ri.*, m.code, m.name AS material_name, m.unit
         FROM warehouse_receipt_items ri
         JOIN raw_materials m USING (material_id)
        WHERE ri.receipt_id = $1
        ORDER BY ri.created_at`,
      [id]
    ),
};

const Issues = {
  insert: (db, i) =>
    db.query(
      `INSERT INTO warehouse_issues (issue_no, issue_type, ref_id, issued_date, note, staff_id)
       VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6)
       RETURNING *`,
      [i.issue_no, i.issue_type, i.ref_id ?? null, i.issued_date ?? null, i.note ?? null, i.staff_id ?? null]
    ),

  insertItem: (db, issueId, it) =>
    db.query(
      `INSERT INTO warehouse_issue_items
           (issue_id, material_id, lot_number, qty_requested, qty_issued, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [issueId, it.material_id, it.lot_number ?? null, it.qty_requested ?? null, it.qty_issued ?? null, it.note ?? null]
    ),

  list: (db = pool) =>
    db.query('SELECT * FROM warehouse_issues ORDER BY created_at DESC'),

  getById: (db = pool, id) =>
    db.query('SELECT * FROM warehouse_issues WHERE issue_id = $1', [id]),

  itemsByIssue: (db = pool, id) =>
    db.query(
      `SELECT ii.*, m.code, m.name AS material_name, m.unit
         FROM warehouse_issue_items ii
         JOIN raw_materials m USING (material_id)
        WHERE ii.issue_id = $1
        ORDER BY ii.created_at`,
      [id]
    ),
};

const Stock = {
  list: (db = pool) =>
    db.query(
      `SELECT m.material_id,
              m.code,
              m.name,
              m.category,
              m.unit,
              m.qty_min_alert,
              COALESCE(s.qty_total, 0)     AS qty_total,
              COALESCE(s.qty_available, 0) AS qty_available,
              COALESCE(s.qty_reserved, 0)  AS qty_reserved,
              (COALESCE(s.qty_available, 0) < m.qty_min_alert) AS low_stock,
              s.updated_at
         FROM raw_materials m
         LEFT JOIN warehouse_stock s USING (material_id)
        WHERE m.is_active = true
        ORDER BY m.code`
    ),
};

module.exports = { Materials, Receipts, Issues, Stock };
