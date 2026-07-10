-- =====================================================================
-- 007_create_bom_schema.sql
-- MCS — BOM (Bill of Materials) + Production orders
-- Target DB: mcs_backend
-- รันผ่าน: node src/scripts/runSql.js src/scripts/007_create_bom_schema.sql
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. bom_templates — สูตรการผลิต
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bom_templates (
    bom_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code              varchar(50) UNIQUE NOT NULL,
    name              varchar(200) NOT NULL,
    bom_type          varchar(20) CHECK (bom_type IN ('roasting', 'packaging')),
    output_product_id uuid REFERENCES products(product_id),
    output_qty        numeric(10, 3) NOT NULL,
    output_unit       varchar(20) NOT NULL,
    expected_loss_pct numeric(5, 2) DEFAULT 0,
    is_active         boolean DEFAULT true,
    created_at        timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. bom_items — ส่วนผสมในแต่ละสูตร
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bom_items (
    item_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_id       uuid REFERENCES bom_templates(bom_id),
    material_id  uuid REFERENCES raw_materials(material_id),
    qty_required numeric(10, 3) NOT NULL,
    unit         varchar(20) NOT NULL,
    note         text
);

-- ---------------------------------------------------------------------
-- 3. production_orders — ใบสั่งผลิต
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_orders (
    order_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_no     varchar(50) UNIQUE NOT NULL,
    bom_id       uuid REFERENCES bom_templates(bom_id),
    planned_qty  numeric(10, 3) NOT NULL,
    status       varchar(20) DEFAULT 'pending'
                 CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    started_at   timestamptz,
    completed_at timestamptz,
    staff_id     varchar(100),
    note         text,
    created_at   timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 4. production_outputs — ผลผลิตจริง
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_outputs (
    output_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id     uuid REFERENCES production_orders(order_id),
    qty_produced numeric(10, 3) NOT NULL,
    qty_loss     numeric(10, 3) DEFAULT 0,
    loss_reason  text,
    recorded_at  timestamptz DEFAULT now(),
    staff_id     varchar(100)
);

CREATE INDEX IF NOT EXISTS idx_bom_items_bom       ON bom_items(bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_material  ON bom_items(material_id);
CREATE INDEX IF NOT EXISTS idx_prod_orders_bom     ON production_orders(bom_id);
CREATE INDEX IF NOT EXISTS idx_prod_outputs_order  ON production_outputs(order_id);

-- =====================================================================
-- Seed data
-- =====================================================================

-- สินค้าสำเร็จรูปสำหรับ output ของ BOM-002 (แพค 500g)
INSERT INTO products (sku, name, product_type, packaging_type)
VALUES ('MRC-500', 'Mr.Coffee Blend 500g', 'consumable', 'ถุง 500g')
ON CONFLICT (sku) DO NOTHING;

-- วัตถุดิบกึ่งสำเร็จ: เมล็ดคั่ว (output ของ BOM-001 / ส่วนผสมของ BOM-002)
-- หมายเหตุ: bom_items อ้างอิง raw_materials จึงสร้าง raw material นี้แทน output ของ roasting
INSERT INTO raw_materials (code, name, category, unit, qty_min_alert)
VALUES ('ROAST-001', 'เมล็ดกาแฟคั่ว Mr.Coffee Blend (กึ่งสำเร็จ)', 'BEAN', 'kg', 10)
ON CONFLICT (code) DO NOTHING;

INSERT INTO warehouse_stock (material_id)
SELECT material_id FROM raw_materials WHERE code = 'ROAST-001'
ON CONFLICT (material_id) DO NOTHING;

-- BOM-001: สูตรคั่วกาแฟ (roasting) — output เมล็ดคั่ว 1 kg, loss 15%
INSERT INTO bom_templates (code, name, bom_type, output_product_id, output_qty, output_unit, expected_loss_pct)
VALUES ('BOM-001', 'สูตรคั่วกาแฟ Mr.Coffee Blend', 'roasting', NULL, 1, 'kg', 15)
ON CONFLICT (code) DO NOTHING;

INSERT INTO bom_items (bom_id, material_id, qty_required, unit, note)
SELECT b.bom_id, m.material_id, v.qty, 'kg', NULL
FROM (VALUES ('BEAN-006', 0.6), ('BEAN-018', 0.4)) AS v(code, qty)
JOIN raw_materials m ON m.code = v.code
JOIN bom_templates b ON b.code = 'BOM-001'
WHERE NOT EXISTS (
    SELECT 1 FROM bom_items bi WHERE bi.bom_id = b.bom_id AND bi.material_id = m.material_id
);

-- BOM-002: สูตรแพคกาแฟถุง 500g (packaging) — output 1 ถุง (MRC-500), loss 2%
INSERT INTO bom_templates (code, name, bom_type, output_product_id, output_qty, output_unit, expected_loss_pct)
SELECT 'BOM-002', 'สูตรแพคกาแฟถุง 500g', 'packaging', p.product_id, 1, 'ถุง', 2
FROM products p WHERE p.sku = 'MRC-500'
ON CONFLICT (code) DO NOTHING;

INSERT INTO bom_items (bom_id, material_id, qty_required, unit, note)
SELECT b.bom_id, m.material_id, v.qty, v.unit, v.note
FROM (VALUES
    ('ROAST-001', 0.52, 'kg',   'เมล็ดกาแฟคั่วจาก BOM-001'),
    ('PKG-001',   1,    'ชิ้น', NULL),
    ('PKG-003',   1,    'ชิ้น', NULL)
) AS v(code, qty, unit, note)
JOIN raw_materials m ON m.code = v.code
JOIN bom_templates b ON b.code = 'BOM-002'
WHERE NOT EXISTS (
    SELECT 1 FROM bom_items bi WHERE bi.bom_id = b.bom_id AND bi.material_id = m.material_id
);

COMMIT;

-- สรุป
SELECT b.code, b.name, b.bom_type, b.output_qty, b.output_unit,
       (SELECT count(*) FROM bom_items bi WHERE bi.bom_id = b.bom_id) AS n_items
FROM bom_templates b ORDER BY b.code;
