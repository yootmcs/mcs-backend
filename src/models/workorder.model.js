// Data access layer สำหรับใบสั่งงานรวม (คั่ว + บรรจุ)
const { pool } = require('../config/db');

const WorkOrder = {
  insert: (db, w) =>
    db.query(
      `INSERT INTO work_orders (work_no, roast_bom_id, pack_bom_id, planned_roast_qty, planned_pack_qty, staff_id, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [w.work_no, w.roast_bom_id, w.pack_bom_id, w.planned_roast_qty, w.planned_pack_qty, w.staff_id ?? null, w.note ?? null]
    ),

  list: (db = pool) =>
    db.query(
      `SELECT w.*,
              br.code AS roast_bom_code, bp.code AS pack_bom_code,
              bp.output_product_id, p.sku AS product_sku, p.name AS product_name
         FROM work_orders w
         JOIN bom_templates br ON br.bom_id = w.roast_bom_id
         JOIN bom_templates bp ON bp.bom_id = w.pack_bom_id
         LEFT JOIN products p ON p.product_id = bp.output_product_id
        ORDER BY w.created_at DESC`
    ),

  getById: (db = pool, id) =>
    db.query(
      `SELECT w.*,
              br.code AS roast_bom_code, br.expected_loss_pct AS roast_loss_pct,
              br.output_material_id,
              bp.code AS pack_bom_code, bp.expected_loss_pct AS pack_loss_pct,
              bp.output_product_id, p.sku AS product_sku, p.name AS product_name
         FROM work_orders w
         JOIN bom_templates br ON br.bom_id = w.roast_bom_id
         JOIN bom_templates bp ON bp.bom_id = w.pack_bom_id
         LEFT JOIN products p ON p.product_id = bp.output_product_id
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
};

module.exports = { WorkOrder };
