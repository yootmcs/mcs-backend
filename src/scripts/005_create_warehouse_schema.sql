-- =====================================================================
-- 003_create_warehouse_schema.sql
-- MCS — Warehouse (raw materials) schema: รับเข้า / จ่ายออก วัตถุดิบ
-- Target DB: mcs_backend  (PostgreSQL 13+)
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. raw_materials — วัตถุดิบ
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_materials (
    material_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code          varchar(50) UNIQUE NOT NULL,
    name          varchar(200) NOT NULL,
    category      varchar(20) CHECK (category IN ('BEAN', 'POWDER', 'LEAF', 'SYRUP', 'CREAM', 'PKG')),
    unit          varchar(20) NOT NULL,
    unit_cost     numeric(10, 2),
    qty_min_alert numeric(10, 3) DEFAULT 10,
    is_active     boolean DEFAULT true,
    created_at    timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. warehouse_stock — ยอดคงเหลือวัตถุดิบ
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouse_stock (
    material_id   uuid PRIMARY KEY REFERENCES raw_materials(material_id),
    qty_total     numeric(10, 3) DEFAULT 0,
    qty_available numeric(10, 3) DEFAULT 0,
    qty_reserved  numeric(10, 3) DEFAULT 0,
    updated_at    timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. warehouse_receipts — ใบรับเข้า
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouse_receipts (
    receipt_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_no    varchar(50) UNIQUE NOT NULL,
    supplier_name varchar(200),
    received_date date DEFAULT CURRENT_DATE,
    note          text,
    staff_id      varchar(100),
    created_at    timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 4. warehouse_receipt_items — รายการในใบรับเข้า
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouse_receipt_items (
    item_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id   uuid REFERENCES warehouse_receipts(receipt_id),
    material_id  uuid REFERENCES raw_materials(material_id),
    lot_number   varchar(50),
    mfd_date     date,
    exp_date     date,
    qty_received numeric(10, 3),
    unit_cost    numeric(10, 2),
    created_at   timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 5. warehouse_issues — ใบจ่ายออก
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouse_issues (
    issue_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_no    varchar(50) UNIQUE NOT NULL,
    issue_type  varchar(20) CHECK (issue_type IN ('production', 'adjust', 'return', 'loss')),
    ref_id      uuid,
    issued_date date DEFAULT CURRENT_DATE,
    note        text,
    staff_id    varchar(100),
    created_at  timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 6. warehouse_issue_items — รายการในใบจ่ายออก
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouse_issue_items (
    item_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id      uuid REFERENCES warehouse_issues(issue_id),
    material_id   uuid REFERENCES raw_materials(material_id),
    lot_number    varchar(50),
    qty_requested numeric(10, 3),
    qty_issued    numeric(10, 3),
    note          text,
    created_at    timestamptz DEFAULT now()
);

-- =====================================================================
-- Triggers: อัปเดต warehouse_stock อัตโนมัติ
-- =====================================================================

-- รับเข้า → เพิ่ม qty_total + qty_available
CREATE OR REPLACE FUNCTION apply_warehouse_receipt()
RETURNS trigger AS $$
BEGIN
    IF NEW.material_id IS NULL OR NEW.qty_received IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO warehouse_stock (material_id, qty_total, qty_available, updated_at)
    VALUES (NEW.material_id, NEW.qty_received, NEW.qty_received, now())
    ON CONFLICT (material_id) DO UPDATE
        SET qty_total     = warehouse_stock.qty_total + NEW.qty_received,
            qty_available = warehouse_stock.qty_available + NEW.qty_received,
            updated_at    = now();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apply_warehouse_receipt ON warehouse_receipt_items;
CREATE TRIGGER trg_apply_warehouse_receipt
    AFTER INSERT ON warehouse_receipt_items
    FOR EACH ROW
    EXECUTE FUNCTION apply_warehouse_receipt();

-- จ่ายออก → ลด qty_total + qty_available (กัน qty_available ติดลบ)
CREATE OR REPLACE FUNCTION apply_warehouse_issue()
RETURNS trigger AS $$
DECLARE
    current_available numeric(10, 3);
BEGIN
    IF NEW.material_id IS NULL OR NEW.qty_issued IS NULL THEN
        RETURN NEW;
    END IF;

    -- ทำให้มีแถว stock ก่อน แล้ว lock ไว้กันแข่งกันอัปเดต
    INSERT INTO warehouse_stock (material_id, qty_total, qty_available, updated_at)
    VALUES (NEW.material_id, 0, 0, now())
    ON CONFLICT (material_id) DO NOTHING;

    SELECT qty_available INTO current_available
    FROM warehouse_stock
    WHERE material_id = NEW.material_id
    FOR UPDATE;

    IF current_available - NEW.qty_issued < 0 THEN
        RAISE EXCEPTION 'Insufficient warehouse stock for material %: available=%, requested issue=%',
            NEW.material_id, current_available, NEW.qty_issued
            USING ERRCODE = 'check_violation';
    END IF;

    UPDATE warehouse_stock
    SET qty_total     = qty_total - NEW.qty_issued,
        qty_available = qty_available - NEW.qty_issued,
        updated_at    = now()
    WHERE material_id = NEW.material_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apply_warehouse_issue ON warehouse_issue_items;
CREATE TRIGGER trg_apply_warehouse_issue
    AFTER INSERT ON warehouse_issue_items
    FOR EACH ROW
    EXECUTE FUNCTION apply_warehouse_issue();

-- ---------------------------------------------------------------------
-- Indexes สำหรับ foreign keys
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_wh_receipt_items_receipt  ON warehouse_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_wh_receipt_items_material ON warehouse_receipt_items(material_id);
CREATE INDEX IF NOT EXISTS idx_wh_issue_items_issue      ON warehouse_issue_items(issue_id);
CREATE INDEX IF NOT EXISTS idx_wh_issue_items_material   ON warehouse_issue_items(material_id);

COMMIT;
