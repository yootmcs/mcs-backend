-- =====================================================================
-- 010_create_store_transfers.sql
-- MCS — Store โรงคั่ว (คลังที่ 2) + ใบเบิกโอน (คลังกลาง → Store)
--   คลังกลาง = warehouse_stock (เดิม, ที่รับของเข้า)
--   Store โรงคั่ว = store_stock (ใหม่, ที่ไลน์ผลิตเบิกไปใช้)
-- เบิกโอน 1 ใบ: คลังกลางลด → Store เพิ่ม อัตโนมัติด้วย trigger + กันติดลบ
-- Target DB: mcs_backend  (PostgreSQL 13+)
-- รันผ่าน: node src/scripts/runSql.js src/scripts/010_create_store_transfers.sql
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. store_stock — ยอดคงเหลือที่ Store โรงคั่ว (โครงเดียวกับ warehouse_stock)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS store_stock (
    material_id   uuid PRIMARY KEY REFERENCES raw_materials(material_id),
    qty_total     numeric(12, 3) DEFAULT 0,
    qty_available numeric(12, 3) DEFAULT 0,
    qty_reserved  numeric(12, 3) DEFAULT 0,
    updated_at    timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. stock_transfers — ใบเบิกโอน (หัวเอกสาร)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transfers (
    transfer_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_no      varchar(50) UNIQUE NOT NULL,
    from_location    varchar(20) DEFAULT 'central'
                     CHECK (from_location IN ('central', 'store')),
    to_location      varchar(20) DEFAULT 'store'
                     CHECK (to_location IN ('central', 'store')),
    transferred_date date DEFAULT CURRENT_DATE,
    note             text,
    staff_id         varchar(100),
    created_at       timestamptz DEFAULT now(),
    CHECK (from_location <> to_location)
);

-- ---------------------------------------------------------------------
-- 3. stock_transfer_items — รายการในใบเบิกโอน
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transfer_items (
    item_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id  uuid REFERENCES stock_transfers(transfer_id),
    material_id  uuid REFERENCES raw_materials(material_id),
    qty          numeric(12, 3) NOT NULL CHECK (qty > 0),
    note         text,
    created_at   timestamptz DEFAULT now()
);

-- =====================================================================
-- Trigger: เบิกโอน central → store (ลดต้นทาง lock+กันติดลบ, เพิ่มปลายทาง)
-- รองรับทิศ store → central ด้วย (เผื่อคืนของ) โดยดูจาก from/to ของหัวเอกสาร
-- =====================================================================
CREATE OR REPLACE FUNCTION apply_stock_transfer()
RETURNS trigger AS $$
DECLARE
    v_from       varchar(20);
    v_to         varchar(20);
    src_available numeric(12, 3);
BEGIN
    IF NEW.material_id IS NULL OR NEW.qty IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT from_location, to_location INTO v_from, v_to
    FROM stock_transfers WHERE transfer_id = NEW.transfer_id;

    -- ---- ลดต้นทาง ----
    IF v_from = 'central' THEN
        INSERT INTO warehouse_stock (material_id, qty_total, qty_available, updated_at)
        VALUES (NEW.material_id, 0, 0, now())
        ON CONFLICT (material_id) DO NOTHING;

        SELECT qty_available INTO src_available
        FROM warehouse_stock WHERE material_id = NEW.material_id FOR UPDATE;

        IF src_available - NEW.qty < 0 THEN
            RAISE EXCEPTION 'คลังกลางไม่พอสำหรับวัตถุดิบ %: มี %, ขอเบิกโอน %',
                NEW.material_id, src_available, NEW.qty USING ERRCODE = 'check_violation';
        END IF;

        UPDATE warehouse_stock
           SET qty_total = qty_total - NEW.qty,
               qty_available = qty_available - NEW.qty, updated_at = now()
         WHERE material_id = NEW.material_id;
    ELSE  -- from store
        INSERT INTO store_stock (material_id, qty_total, qty_available, updated_at)
        VALUES (NEW.material_id, 0, 0, now())
        ON CONFLICT (material_id) DO NOTHING;

        SELECT qty_available INTO src_available
        FROM store_stock WHERE material_id = NEW.material_id FOR UPDATE;

        IF src_available - NEW.qty < 0 THEN
            RAISE EXCEPTION 'Store ไม่พอสำหรับวัตถุดิบ %: มี %, ขอเบิกโอน %',
                NEW.material_id, src_available, NEW.qty USING ERRCODE = 'check_violation';
        END IF;

        UPDATE store_stock
           SET qty_total = qty_total - NEW.qty,
               qty_available = qty_available - NEW.qty, updated_at = now()
         WHERE material_id = NEW.material_id;
    END IF;

    -- ---- เพิ่มปลายทาง ----
    IF v_to = 'store' THEN
        INSERT INTO store_stock (material_id, qty_total, qty_available, updated_at)
        VALUES (NEW.material_id, NEW.qty, NEW.qty, now())
        ON CONFLICT (material_id) DO UPDATE
            SET qty_total = store_stock.qty_total + NEW.qty,
                qty_available = store_stock.qty_available + NEW.qty, updated_at = now();
    ELSE  -- to central
        INSERT INTO warehouse_stock (material_id, qty_total, qty_available, updated_at)
        VALUES (NEW.material_id, NEW.qty, NEW.qty, now())
        ON CONFLICT (material_id) DO UPDATE
            SET qty_total = warehouse_stock.qty_total + NEW.qty,
                qty_available = warehouse_stock.qty_available + NEW.qty, updated_at = now();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apply_stock_transfer ON stock_transfer_items;
CREATE TRIGGER trg_apply_stock_transfer
    AFTER INSERT ON stock_transfer_items
    FOR EACH ROW EXECUTE FUNCTION apply_stock_transfer();

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer ON stock_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_items_material ON stock_transfer_items(material_id);

COMMIT;

SELECT 'store_stock' AS tbl, count(*) FROM store_stock
UNION ALL SELECT 'stock_transfers', count(*) FROM stock_transfers
UNION ALL SELECT 'stock_transfer_items', count(*) FROM stock_transfer_items;
