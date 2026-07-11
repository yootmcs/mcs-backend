# mcs-factory-module
> MCS Factory module (BOM + Production orders) — tables, 3-phase order flow, dual output routing

โมดูลโรงงาน (Factory) ของ [[mcs-project-overview]] = BOM + Production orders. Schema: `007_create_bom_schema.sql` + `008_add_bom_output_material.sql`. (โมดูล `/production` เดิมนี้ยังอยู่ใช้ได้ แต่สาย "ของจริง" ย้ายไป [[mcs-manufacturing-2warehouse]] แล้ว)

**ตาราง:** `bom_templates` (สูตร, bom_type IN roasting|packaging, expected_loss_pct, output_product_id, output_material_id), `bom_items` (ส่วนผสม→raw_materials), `production_orders` (status pending→in_progress→completed→cancelled), `production_outputs` (qty_produced/qty_loss).

**Output 2 ปลายทาง:** roasting → เพิ่ม `warehouse_stock` (output_material_id, วัตถุดิบกึ่งสำเร็จ เช่น ROAST-001); packaging → เพิ่ม `stock_levels` ผ่าน stock_transactions (output_product_id, สินค้าสำเร็จรูป เช่น MRC-500).

**วงจรใบสั่งผลิต** (`services/bom.service.js`, ทุกจังหวะเป็น DB transaction):
1. createOrder — required = qty_required × planned × (1+loss%/100); เช็คสต็อกพอไหม; ถ้าพอจอง qty_reserved, ไม่พอ throw shortages.
2. startOrder — ออก warehouse_issue ตัดวัตถุดิบจริง (trigger ลด qty_available, กันติดลบ) + ปล่อย reserved → in_progress.
3. completeOrder — บันทึก output → เพิ่มสต็อกปลายทางตาม bom_type → completed.

**API:** GET/POST /api/bom, GET /api/bom/:id; POST /api/production/orders, GET /orders, GET /orders/:id, POST /orders/:id/start, POST /orders/:id/complete.

**How to apply:** ทำงานส่วนนี้ต่อ ให้ตามรูปแบบ layer เดิม (routes→controller→service→model) และห่อ multi-step write ด้วย client transaction (BEGIN/COMMIT/ROLLBACK) เสมอ.
