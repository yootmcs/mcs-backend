// Data access layer สำหรับใบสั่งงานรวม (คั่ว + บรรจุ)
const { pool } = require('../config/db');

const WorkOrder = {
  insert: (db, w) =>
    db.query(
      `INSERT INTO work_orders
           (work_no, roast_bom_id, pack_bom_id, green_lot_id, roast_level,
            planned_roast_qty, planned_pack_qty, staff_id, note)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'medium'), $6, $7, $8, $9)
       RETURNING *`,
      [w.work_no, w.roast_bom_id, w.pack_bom_id, w.green_lot_id ?? null, w.roast_level ?? null,
       w.planned_roast_qty, w.planned_pack_qty, w.staff_id ?? null, w.note ?? null]
    ),

  list: (db = pool) =>
    db.query(
      `SELECT w.*,
              br.code AS roast_bom_code, bp.code AS pack_bom_code,
              bp.output_product_id, p.sku AS product_sku, p.name AS product_name,
              g.code AS green_lot_code, g.origin AS green_origin
         FROM work_orders w
         JOIN bom_templates br ON br.bom_id = w.roast_bom_id
         JOIN bom_templates bp ON bp.bom_id = w.pack_bom_id
         LEFT JOIN products p ON p.product_id = bp.output_product_id
         LEFT JOIN green_coffee_lots g ON g.lot_id = w.green_lot_id
        ORDER BY w.created_at DESC`
    ),

  getById: (db = pool, id) =>
    db.query(
      `SELECT w.*,
              br.code AS roast_bom_code, br.expected_loss_pct AS roast_loss_pct,
              br.output_material_id,
              bp.code AS pack_bom_code, bp.expected_loss_pct AS pack_loss_pct,
              bp.output_product_id, p.sku AS product_sku, p.name AS product_name,
              g.code AS green_lot_code, g.origin AS green_origin,
              g.qty_store_kg AS green_store_kg, g.qty_store_reserved_kg AS green_store_reserved_kg
         FROM work_orders w
         JOIN bom_templates br ON br.bom_id = w.roast_bom_id
         JOIN bom_templates bp ON bp.bom_id = w.pack_bom_id
         LEFT JOIN products p ON p.product_id = bp.output_product_id
         LEFT JOIN green_coffee_lots g ON g.lot_id = w.green_lot_id
        WHERE w.work_id = $1`,
      [id]
    ),

  setStatus: (db, id, status, field) =>
    db.query(
      `UPDATE work_orders
          SET status = $2${field ? `, ${field} = now()` : ''}
        WHERE work_id = $1 RETURNING *`,
      [id, status]
    ),

  recordOutputs: (db, id, o) =>
    db.query(
      `UPDATE work_orders
          SET roast_produced = $2, roast_loss = $3, roast_loss_reason = $4,
              pack_produced = $5, pack_loss = $6, pack_loss_reason = $7,
              status = 'completed', completed_at = now()
        WHERE work_id = $1 RETURNING *`,
      [id, o.roast_produced, o.roast_loss ?? 0, o.roast_loss_reason ?? null,
       o.pack_produced, o.pack_loss ?? 0, o.pack_loss_reason ?? null]
    ),

  // ผูกใบสั่งงานกับล็อตคั่วที่เกิดตอนจบงาน (ไว้ตามรอย)
  setBatch: (db, id, batchId) =>
    db.query('UPDATE work_orders SET batch_id = $2 WHERE work_id = $1 RETURNING *', [id, batchId]),
};

// ล็อตถุงสำเร็จ — ตราวันคั่ว + สาวกลับไป roast_batch → ล็อต green → ซัพ
const FinishedLots = {
  insert: (db, code, f) =>
    db.query(
      `INSERT INTO finished_lots
           (code, product_id, work_id, batch_id, roast_date, roast_level, qty_produced, qty_remaining)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [code, f.product_id, f.work_id ?? null, f.batch_id ?? null,
       f.roast_date ?? null, f.roast_level ?? null, f.qty_produced]
    ),

  // ตามรอยล็อตถุงสำเร็จ → คั่ว → ล็อต green → ซัพ (สายเลือดครบเส้น)
  listWithLineage: (db = pool, productId) =>
    db.query(
      `SELECT fl.*, p.sku AS product_sku, p.name AS product_name,
              rb.code AS batch_code, rb.roasted_weight_out,
              g.code AS green_lot_code, g.origin AS green_origin, g.variety AS green_variety,
              sup.name AS supplier_name
         FROM finished_lots fl
         JOIN products p ON p.product_id = fl.product_id
         LEFT JOIN roast_batches rb ON rb.batch_id = fl.batch_id
         LEFT JOIN green_coffee_lots g ON g.lot_id = rb.lot_id
         LEFT JOIN suppliers sup ON sup.supplier_id = g.supplier_id
        WHERE ($1::uuid IS NULL OR fl.product_id = $1)
        ORDER BY fl.roast_date DESC, fl.produced_at DESC`,
      [productId ?? null]
    ),
};

module.exports = { WorkOrder, FinishedLots };
