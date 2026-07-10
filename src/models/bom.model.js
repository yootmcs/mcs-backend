// Data access layer สำหรับ BOM + Production
const { pool } = require('../config/db');

const Bom = {
  list: (db = pool) =>
    db.query(
      `SELECT b.*, p.sku AS output_sku, p.name AS output_product_name,
              (SELECT count(*) FROM bom_items bi WHERE bi.bom_id = b.bom_id) AS n_items
         FROM bom_templates b
         LEFT JOIN products p ON p.product_id = b.output_product_id
        ORDER BY b.code`
    ),

  getById: (db = pool, id) =>
    db.query(
      `SELECT b.*, p.sku AS output_sku, p.name AS output_product_name
         FROM bom_templates b
         LEFT JOIN products p ON p.product_id = b.output_product_id
        WHERE b.bom_id = $1`,
      [id]
    ),

  insert: (db, b) =>
    db.query(
      `INSERT INTO bom_templates
           (code, name, bom_type, output_product_id, output_qty, output_unit, expected_loss_pct)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 0))
       RETURNING *`,
      [b.code, b.name, b.bom_type, b.output_product_id ?? null, b.output_qty, b.output_unit, b.expected_loss_pct ?? null]
    ),

  items: (db = pool, bomId) =>
    db.query(
      `SELECT bi.*, m.code AS material_code, m.name AS material_name
         FROM bom_items bi
         JOIN raw_materials m USING (material_id)
        WHERE bi.bom_id = $1
        ORDER BY m.code`,
      [bomId]
    ),

  insertItem: (db, bomId, it) =>
    db.query(
      `INSERT INTO bom_items (bom_id, material_id, qty_required, unit, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [bomId, it.material_id, it.qty_required, it.unit, it.note ?? null]
    ),
};

const Prod = {
  insertOrder: (db, o) =>
    db.query(
      `INSERT INTO production_orders (order_no, bom_id, planned_qty, staff_id, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [o.order_no, o.bom_id, o.planned_qty, o.staff_id ?? null, o.note ?? null]
    ),

  list: (db = pool) =>
    db.query(
      `SELECT po.*, b.code AS bom_code, b.name AS bom_name, b.bom_type
         FROM production_orders po
         JOIN bom_templates b USING (bom_id)
        ORDER BY po.created_at DESC`
    ),

  getById: (db = pool, id) =>
    db.query(
      `SELECT po.*,
              b.code AS bom_code, b.name AS bom_name, b.bom_type,
              b.output_qty, b.output_unit, b.output_product_id, b.expected_loss_pct
         FROM production_orders po
         JOIN bom_templates b USING (bom_id)
        WHERE po.order_id = $1`,
      [id]
    ),

  setStatus: (db, id, status, field) =>
    db.query(
      `UPDATE production_orders
          SET status = $2${field ? `, ${field} = now()` : ''}
        WHERE order_id = $1
        RETURNING *`,
      [id, status]
    ),

  insertOutput: (db, o) =>
    db.query(
      `INSERT INTO production_outputs (order_id, qty_produced, qty_loss, loss_reason, staff_id)
       VALUES ($1, $2, COALESCE($3, 0), $4, $5)
       RETURNING *`,
      [o.order_id, o.qty_produced, o.qty_loss ?? null, o.loss_reason ?? null, o.staff_id ?? null]
    ),

  outputs: (db = pool, orderId) =>
    db.query('SELECT * FROM production_outputs WHERE order_id = $1 ORDER BY recorded_at', [orderId]),
};

// warehouse_stock helpers สำหรับการจอง/ตัดวัตถุดิบ
const Stock = {
  forMaterials: (db, materialIds) =>
    db.query(
      `SELECT s.material_id, m.code, m.name, m.unit,
              s.qty_available, s.qty_reserved
         FROM warehouse_stock s
         JOIN raw_materials m USING (material_id)
        WHERE s.material_id = ANY($1)`,
      [materialIds]
    ),

  addReserved: (db, materialId, delta) =>
    db.query(
      `UPDATE warehouse_stock
          SET qty_reserved = qty_reserved + $2, updated_at = now()
        WHERE material_id = $1`,
      [materialId, delta]
    ),
};

module.exports = { Bom, Prod, Stock };
