-- =====================================================================
-- 013_green_lot_traceability.sql
-- MCS — รวมระบบ เฟส 2: ตามรอยรายล็อตเต็มสูบ (green → คั่ว → ถุงสำเร็จ)
--
-- แนวคิด: "green ติดตามเป็นล็อตล้วน" (ไม่ปนคลังวัตถุดิบทั่วไป ไม่บันทึกซ้ำ)
--   green_coffee_lots = บัญชี green บัญชีเดียว แยกตำแหน่งเป็น 2 ช่อง:
--     qty_central_kg (คลังกลาง)  +  qty_store_kg (Store โรงคั่ว)
--   รับ green → เข้า central ; เบิกโอน → ย้าย central→store ; คั่ว → หัก store
--
-- ใบสั่งงานเลือกล็อต green → ตอนจบงานสร้าง roast_batch (trigger หัก qty_store_kg)
--   → บันทึก finished_lots (ล็อตถุงสำเร็จ ผูกกลับไป roast_batch → ล็อต green → ซัพ)
--
-- รันผ่าน: node src/scripts/runSql.js src/scripts/013_green_lot_traceability.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. green_coffee_lots: เพิ่มช่องตำแหน่ง (central/store) แทน remaining_kg เดี่ยว
-- ---------------------------------------------------------------------
ALTER TABLE green_coffee_lots
    ADD COLUMN IF NOT EXISTS qty_central_kg       numeric(12, 3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS qty_store_kg         numeric(12, 3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS qty_store_reserved_kg numeric(12, 3) NOT NULL DEFAULT 0;

-- ย้ายค่าคงเหลือเดิม (remaining_kg) เข้าช่อง central (ของเดิมถือว่าอยู่คลังกลาง)
UPDATE green_coffee_lots
   SET qty_central_kg = remaining_kg
 WHERE qty_central_kg = 0 AND remaining_kg IS NOT NULL;

-- กันติดลบทั้ง 3 ช่อง
ALTER TABLE green_coffee_lots
    ADD CONSTRAINT green_lots_buckets_nonneg
    CHECK (qty_central_kg >= 0 AND qty_store_kg >= 0 AND qty_store_reserved_kg >= 0
           AND qty_store_reserved_kg <= qty_store_kg)
    NOT VALID;

-- remaining_kg ไม่ใช้เป็นบัญชีอีกต่อไป (บัญชีจริง = สองช่องด้านบน) — ปลดออก
ALTER TABLE green_coffee_lots DROP COLUMN IF EXISTS remaining_kg;

-- ---------------------------------------------------------------------
-- 2. ชี้ trigger การคั่วเดิมให้หัก/คืน "qty_store_kg" (คั่วเบิกจาก Store)
--    ทั้ง path เก่า (แท็บ ☕) และ path ใหม่ (ใบสั่งงาน) จึงหัก green ที่เดียวกัน
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_roast_consume_green()
RETURNS trigger AS $$
DECLARE
    avail numeric(12, 3);
BEGIN
    SELECT qty_store_kg INTO avail
    FROM green_coffee_lots WHERE lot_id = NEW.lot_id
    FOR UPDATE;

    IF avail IS NULL THEN
        RAISE EXCEPTION 'green lot % not found', NEW.lot_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF avail - NEW.green_weight_in < 0 THEN
        RAISE EXCEPTION 'สารกาแฟดิบที่ Store ไม่พอ: ล็อตเหลือ % กก. แต่ขอใช้ % กก. (เบิกโอนเข้า Store ก่อน)',
            avail, NEW.green_weight_in USING ERRCODE = 'check_violation';
    END IF;

    UPDATE green_coffee_lots
       SET qty_store_kg = qty_store_kg - NEW.green_weight_in
     WHERE lot_id = NEW.lot_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_roast_return_green()
RETURNS trigger AS $$
BEGIN
    UPDATE green_coffee_lots
       SET qty_store_kg = qty_store_kg + OLD.green_weight_in
     WHERE lot_id = OLD.lot_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 3. ใบเบิกโอนล็อต green (คลังกลาง ↔ Store) — trigger ย้าย kg ระหว่างสองช่อง
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS green_lot_transfers (
    transfer_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_no  varchar(50) UNIQUE NOT NULL,        -- GT-YYMM-NNN
    lot_id       uuid NOT NULL REFERENCES green_coffee_lots(lot_id),
    direction    varchar(20) NOT NULL DEFAULT 'to_store'
                 CHECK (direction IN ('to_store', 'to_central')),
    qty_kg       numeric(12, 3) NOT NULL CHECK (qty_kg > 0),
    transferred_date date DEFAULT CURRENT_DATE,
    note         text,
    staff_id     varchar(100),
    created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_green_transfers_lot ON green_lot_transfers(lot_id);

-- ย้ายของระหว่างช่อง (lock ล็อต กันแข่ง + กันต้นทางติดลบ)
CREATE OR REPLACE FUNCTION fn_apply_green_transfer()
RETURNS trigger AS $$
DECLARE
    c numeric(12, 3);
    s numeric(12, 3);
BEGIN
    SELECT qty_central_kg, qty_store_kg INTO c, s
    FROM green_coffee_lots WHERE lot_id = NEW.lot_id FOR UPDATE;

    IF c IS NULL THEN
        RAISE EXCEPTION 'green lot % not found', NEW.lot_id USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.direction = 'to_store' THEN
        IF c - NEW.qty_kg < 0 THEN
            RAISE EXCEPTION 'คลังกลางไม่พอ: ล็อตเหลือที่กลาง % กก. แต่ขอโอน % กก.',
                c, NEW.qty_kg USING ERRCODE = 'check_violation';
        END IF;
        UPDATE green_coffee_lots
           SET qty_central_kg = qty_central_kg - NEW.qty_kg,
               qty_store_kg   = qty_store_kg   + NEW.qty_kg
         WHERE lot_id = NEW.lot_id;
    ELSE  -- to_central (โอนกลับ)
        IF s - NEW.qty_kg < 0 THEN
            RAISE EXCEPTION 'Store ไม่พอ: ล็อตเหลือที่ Store % กก. แต่ขอโอนกลับ % กก.',
                s, NEW.qty_kg USING ERRCODE = 'check_violation';
        END IF;
        UPDATE green_coffee_lots
           SET qty_store_kg   = qty_store_kg   - NEW.qty_kg,
               qty_central_kg = qty_central_kg + NEW.qty_kg
         WHERE lot_id = NEW.lot_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apply_green_transfer ON green_lot_transfers;
CREATE TRIGGER trg_apply_green_transfer
    AFTER INSERT ON green_lot_transfers
    FOR EACH ROW EXECUTE FUNCTION fn_apply_green_transfer();

-- ---------------------------------------------------------------------
-- 4. work_orders: ผูกล็อต green + ระดับคั่ว + อ้าง roast_batch ที่เกิดตอนจบงาน
-- ---------------------------------------------------------------------
ALTER TABLE work_orders
    ADD COLUMN IF NOT EXISTS green_lot_id uuid REFERENCES green_coffee_lots(lot_id),
    ADD COLUMN IF NOT EXISTS roast_level  varchar(20) DEFAULT 'medium'
        CHECK (roast_level IN ('light', 'medium-light', 'medium', 'medium-dark', 'dark')),
    ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES roast_batches(batch_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_green_lot ON work_orders(green_lot_id);

-- planned_roast_qty ในโมเดลใหม่ = "กก. green ที่วางแผนโหลดเข้าเตา" (input จากล็อต)
COMMENT ON COLUMN work_orders.planned_roast_qty IS 'kg green ที่วางแผนโหลดเข้าเตา (เบิกจาก qty_store_kg ของ green_lot)';

-- ---------------------------------------------------------------------
-- 5. roast_batches: ผูกกลับไปใบสั่งงานที่สร้างมัน (nullable — path เก่ายังไม่มี)
-- ---------------------------------------------------------------------
ALTER TABLE roast_batches
    ADD COLUMN IF NOT EXISTS work_order_id uuid REFERENCES work_orders(work_id);

CREATE INDEX IF NOT EXISTS idx_roast_batches_wo ON roast_batches(work_order_id);

-- ---------------------------------------------------------------------
-- 6. finished_lots: ล็อตถุงสำเร็จ (ตราวันคั่ว + สาวกลับไป roast_batch)
--    qty_remaining ไว้ตัดแบบ FEFO ตอนขาย/ส่งออก (เฟส 3)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finished_lots (
    finished_lot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         varchar(50) UNIQUE NOT NULL,          -- FL-YYMM-NNN
    product_id   uuid NOT NULL REFERENCES products(product_id),
    work_id      uuid REFERENCES work_orders(work_id),
    batch_id     uuid REFERENCES roast_batches(batch_id),   -- lineage → green lot → supplier
    roast_date   date,
    roast_level  varchar(20),
    qty_produced numeric(12, 3) NOT NULL CHECK (qty_produced >= 0),
    qty_remaining numeric(12, 3) NOT NULL CHECK (qty_remaining >= 0),
    produced_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finished_lots_product ON finished_lots(product_id);
CREATE INDEX IF NOT EXISTS idx_finished_lots_batch   ON finished_lots(batch_id);
CREATE INDEX IF NOT EXISTS idx_finished_lots_roast_date ON finished_lots(roast_date);

COMMIT;

-- ตรวจผล
SELECT 'green_coffee_lots' AS obj, string_agg(column_name, ', ' ORDER BY ordinal_position) AS cols
FROM information_schema.columns WHERE table_name = 'green_coffee_lots'
  AND column_name IN ('qty_central_kg', 'qty_store_kg', 'qty_store_reserved_kg')
UNION ALL
SELECT 'new tables', string_agg(table_name, ', ')
FROM information_schema.tables WHERE table_name IN ('green_lot_transfers', 'finished_lots');
