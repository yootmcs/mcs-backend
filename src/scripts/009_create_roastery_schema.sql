-- =====================================================================
-- 009_create_roastery_schema.sql
-- MCS — Roastery module (โดเมนจริงจาก coffee-roastery-erp prototype)
-- ตามรอยรายล็อต: ซัพพลายเออร์ → ล็อตสารกาแฟดิบ → คั่ว → สต็อก → ขาย/ส่งออก
-- Target DB: mcs_backend  (PostgreSQL 13+)
-- รันผ่าน: node src/scripts/runSql.js src/scripts/009_create_roastery_schema.sql
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. suppliers — ซัพพลายเออร์ (ผู้ขายสารกาแฟดิบ)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
    supplier_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         varchar(50) UNIQUE NOT NULL,
    name         varchar(200) NOT NULL,
    contact      varchar(200),
    phone        varchar(50),
    note         text,
    is_active    boolean DEFAULT true,
    created_at   timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. green_coffee_lots — ล็อตสารกาแฟดิบที่รับเข้า (track รายล็อต)
--    remaining_kg เก็บบนแถวเลย (แนวเดียวกับ prototype) trigger คั่วจะหักให้
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS green_coffee_lots (
    lot_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code           varchar(50) UNIQUE NOT NULL,          -- GC-YYMM-NNN
    supplier_id    uuid REFERENCES suppliers(supplier_id),
    received_date  date DEFAULT CURRENT_DATE,
    origin         varchar(200) NOT NULL,                -- แหล่งผลิต/ประเทศ
    variety        varchar(200),                         -- สายพันธุ์
    process_method varchar(20) DEFAULT 'washed'
                   CHECK (process_method IN ('washed', 'natural', 'honey', 'other')),
    moisture_pct   numeric(5, 2),                        -- ความชื้น %
    weight_kg      numeric(12, 3) NOT NULL CHECK (weight_kg > 0),
    remaining_kg   numeric(12, 3) NOT NULL CHECK (remaining_kg >= 0),
    price_per_kg   numeric(12, 2) DEFAULT 0,
    note           text,
    created_at     timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. roast_batches — ล็อตการคั่ว (สารดิบ → กาแฟคั่ว)
--    loss_pct + remaining_roasted_kg ตั้งค่าให้อัตโนมัติด้วย trigger
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roast_batches (
    batch_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code                 varchar(50) UNIQUE NOT NULL,    -- RB-YYMM-NNN
    lot_id               uuid NOT NULL REFERENCES green_coffee_lots(lot_id),
    roast_date           date DEFAULT CURRENT_DATE,
    roast_level          varchar(20) NOT NULL DEFAULT 'medium'
                         CHECK (roast_level IN ('light', 'medium-light', 'medium', 'medium-dark', 'dark')),
    green_weight_in      numeric(12, 3) NOT NULL CHECK (green_weight_in > 0),
    roasted_weight_out   numeric(12, 3) NOT NULL CHECK (roasted_weight_out > 0),
    loss_pct             numeric(5, 2),                  -- คำนวณโดย trigger
    remaining_roasted_kg numeric(12, 3) CHECK (remaining_roasted_kg >= 0),
    operator             varchar(200),                   -- ผู้คั่ว
    machine              varchar(200),                   -- เครื่องคั่ว
    note                 text,
    created_at           timestamptz DEFAULT now(),
    CHECK (roasted_weight_out <= green_weight_in)        -- หลังคั่วต้องไม่เกินก่อนคั่ว
);

-- ---------------------------------------------------------------------
-- 4. packaging_items — วัสดุบรรจุภัณฑ์ (ถุง, ซีล, กล่อง ฯลฯ)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS packaging_items (
    packaging_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          varchar(200) NOT NULL,
    unit          varchar(50) DEFAULT 'ชิ้น',
    quantity      numeric(12, 3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reorder_level numeric(12, 3) DEFAULT 0,
    note          text,
    created_at    timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 5. sales_orders — คำสั่งซื้อ / ส่งออก
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_orders (
    order_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         varchar(50) UNIQUE NOT NULL,            -- EX-YYMM-NNN
    order_date   date DEFAULT CURRENT_DATE,
    customer     varchar(200) NOT NULL,
    destination  varchar(200),                           -- ปลายทาง/ประเทศ
    currency     varchar(3) DEFAULT 'THB'
                 CHECK (currency IN ('THB', 'USD', 'EUR', 'JPY')),
    unit_price   numeric(12, 2) DEFAULT 0,               -- ราคาต่อ กก.
    status       varchar(20) DEFAULT 'pending'
                 CHECK (status IN ('pending', 'packing', 'shipped')),
    note         text,
    created_at   timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 6. sales_order_allocations — จัดสรรกาแฟคั่วจากล็อตคั่วให้คำสั่งซื้อ
--    (1 คำสั่งซื้ออาจดึงจากหลายล็อตคั่ว) trigger หัก remaining_roasted_kg
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_order_allocations (
    allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      uuid NOT NULL REFERENCES sales_orders(order_id) ON DELETE CASCADE,
    batch_id      uuid NOT NULL REFERENCES roast_batches(batch_id),
    qty_kg        numeric(12, 3) NOT NULL CHECK (qty_kg > 0),
    created_at    timestamptz DEFAULT now()
);

-- =====================================================================
-- Triggers: ตัด/คืนสต็อกอัตโนมัติ (หัวใจ "ตัวเลขเชื่อถือได้")
-- =====================================================================

-- 3a. ก่อน insert ล็อตคั่ว: คำนวณ % สูญเสีย + ตั้งคงเหลือเริ่มต้น
CREATE OR REPLACE FUNCTION fn_roast_before_insert()
RETURNS trigger AS $$
BEGIN
    NEW.loss_pct := round(((NEW.green_weight_in - NEW.roasted_weight_out)
                           / NEW.green_weight_in) * 100, 2);
    IF NEW.remaining_roasted_kg IS NULL THEN
        NEW.remaining_roasted_kg := NEW.roasted_weight_out;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_roast_before_insert ON roast_batches;
CREATE TRIGGER trg_roast_before_insert
    BEFORE INSERT ON roast_batches
    FOR EACH ROW EXECUTE FUNCTION fn_roast_before_insert();

-- 3b. หลัง insert ล็อตคั่ว: หักสารดิบจากล็อต (lock กันแข่ง + กันติดลบ)
CREATE OR REPLACE FUNCTION fn_roast_consume_green()
RETURNS trigger AS $$
DECLARE
    avail numeric(12, 3);
BEGIN
    SELECT remaining_kg INTO avail
    FROM green_coffee_lots WHERE lot_id = NEW.lot_id
    FOR UPDATE;

    IF avail IS NULL THEN
        RAISE EXCEPTION 'green lot % not found', NEW.lot_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF avail - NEW.green_weight_in < 0 THEN
        RAISE EXCEPTION 'สารกาแฟดิบไม่พอ: ล็อตเหลือ % กก. แต่ขอใช้ % กก.',
            avail, NEW.green_weight_in USING ERRCODE = 'check_violation';
    END IF;

    UPDATE green_coffee_lots
       SET remaining_kg = remaining_kg - NEW.green_weight_in
     WHERE lot_id = NEW.lot_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_roast_consume_green ON roast_batches;
CREATE TRIGGER trg_roast_consume_green
    AFTER INSERT ON roast_batches
    FOR EACH ROW EXECUTE FUNCTION fn_roast_consume_green();

-- 3c. ลบล็อตคั่ว → คืนสารดิบเข้าล็อตเดิม
CREATE OR REPLACE FUNCTION fn_roast_return_green()
RETURNS trigger AS $$
BEGIN
    UPDATE green_coffee_lots
       SET remaining_kg = remaining_kg + OLD.green_weight_in
     WHERE lot_id = OLD.lot_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_roast_return_green ON roast_batches;
CREATE TRIGGER trg_roast_return_green
    AFTER DELETE ON roast_batches
    FOR EACH ROW EXECUTE FUNCTION fn_roast_return_green();

-- 6a. หลัง insert allocation: หักกาแฟคั่วจากล็อตคั่ว (lock + กันติดลบ)
CREATE OR REPLACE FUNCTION fn_alloc_consume_roasted()
RETURNS trigger AS $$
DECLARE
    avail numeric(12, 3);
BEGIN
    SELECT remaining_roasted_kg INTO avail
    FROM roast_batches WHERE batch_id = NEW.batch_id
    FOR UPDATE;

    IF avail IS NULL THEN
        RAISE EXCEPTION 'roast batch % not found', NEW.batch_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF avail - NEW.qty_kg < 0 THEN
        RAISE EXCEPTION 'กาแฟคั่วไม่พอ: ล็อตเหลือ % กก. แต่ขอ % กก.',
            avail, NEW.qty_kg USING ERRCODE = 'check_violation';
    END IF;

    UPDATE roast_batches
       SET remaining_roasted_kg = remaining_roasted_kg - NEW.qty_kg
     WHERE batch_id = NEW.batch_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_alloc_consume_roasted ON sales_order_allocations;
CREATE TRIGGER trg_alloc_consume_roasted
    AFTER INSERT ON sales_order_allocations
    FOR EACH ROW EXECUTE FUNCTION fn_alloc_consume_roasted();

-- 6b. ลบ allocation (เช่นยกเลิกคำสั่งซื้อ) → คืนกาแฟคั่วเข้าล็อตคั่ว
CREATE OR REPLACE FUNCTION fn_alloc_return_roasted()
RETURNS trigger AS $$
BEGIN
    UPDATE roast_batches
       SET remaining_roasted_kg = remaining_roasted_kg + OLD.qty_kg
     WHERE batch_id = OLD.batch_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_alloc_return_roasted ON sales_order_allocations;
CREATE TRIGGER trg_alloc_return_roasted
    AFTER DELETE ON sales_order_allocations
    FOR EACH ROW EXECUTE FUNCTION fn_alloc_return_roasted();

-- ---------------------------------------------------------------------
-- Indexes สำหรับ foreign keys / การค้นหาที่ใช้บ่อย
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_green_lots_supplier   ON green_coffee_lots(supplier_id);
CREATE INDEX IF NOT EXISTS idx_roast_batches_lot     ON roast_batches(lot_id);
CREATE INDEX IF NOT EXISTS idx_roast_batches_level   ON roast_batches(roast_level);
CREATE INDEX IF NOT EXISTS idx_alloc_order           ON sales_order_allocations(order_id);
CREATE INDEX IF NOT EXISTS idx_alloc_batch           ON sales_order_allocations(batch_id);

COMMIT;

-- สรุปตารางที่สร้าง
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('suppliers', 'green_coffee_lots', 'roast_batches',
                     'packaging_items', 'sales_orders', 'sales_order_allocations')
ORDER BY table_name;
