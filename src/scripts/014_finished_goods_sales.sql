-- =====================================================================
-- 014_finished_goods_sales.sql
-- MCS — รวมระบบ เฟส 3: ขายถุงสำเร็จ (finished goods) แบบ FEFO
--
-- ต่อยอด sales_orders เดิม (ที่ ☕ ใช้ขายเมล็ดคั่วเป็น กก.) ให้รองรับ
-- การขาย "ถุงสำเร็จ" โดยตัดจาก finished_lots แบบ FEFO (คั่วก่อน-ออกก่อน)
--   → ออเดอร์รู้ว่าส่งถุงจากล็อตคั่วไหน (ตามรอยถึงมือลูกค้า)
--
-- ไม่แตะ path ขายเมล็ดคั่วเดิม (sales_order_allocations) — อยู่ร่วมกันได้
-- รันผ่าน: node src/scripts/runSql.js src/scripts/014_finished_goods_sales.sql
-- =====================================================================

BEGIN;

-- 1) sales_orders: เพิ่มสินค้า + จำนวนถุงที่สั่ง (สำหรับออเดอร์ขายถุง)
ALTER TABLE sales_orders
    ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(product_id),
    ADD COLUMN IF NOT EXISTS qty_bags   numeric(12, 3);

-- 2) finished_allocations — จัดสรรถุงจาก finished_lots ให้ออเดอร์ (FEFO ทำใน service)
CREATE TABLE IF NOT EXISTS finished_allocations (
    allocation_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        uuid NOT NULL REFERENCES sales_orders(order_id) ON DELETE CASCADE,
    finished_lot_id uuid NOT NULL REFERENCES finished_lots(finished_lot_id),
    qty_bags        numeric(12, 3) NOT NULL CHECK (qty_bags > 0),
    created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_alloc_order ON finished_allocations(order_id);
CREATE INDEX IF NOT EXISTS idx_fin_alloc_lot   ON finished_allocations(finished_lot_id);

-- 3a) จัดสรร → หักคงเหลือถุงของล็อตสำเร็จ (lock + กันติดลบ)
CREATE OR REPLACE FUNCTION fn_fin_alloc_consume()
RETURNS trigger AS $$
DECLARE
    avail numeric(12, 3);
BEGIN
    SELECT qty_remaining INTO avail
    FROM finished_lots WHERE finished_lot_id = NEW.finished_lot_id
    FOR UPDATE;

    IF avail IS NULL THEN
        RAISE EXCEPTION 'finished lot % not found', NEW.finished_lot_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF avail - NEW.qty_bags < 0 THEN
        RAISE EXCEPTION 'ถุงในล็อตสำเร็จไม่พอ: เหลือ % ถุง แต่ขอ % ถุง',
            avail, NEW.qty_bags USING ERRCODE = 'check_violation';
    END IF;

    UPDATE finished_lots
       SET qty_remaining = qty_remaining - NEW.qty_bags
     WHERE finished_lot_id = NEW.finished_lot_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fin_alloc_consume ON finished_allocations;
CREATE TRIGGER trg_fin_alloc_consume
    AFTER INSERT ON finished_allocations
    FOR EACH ROW EXECUTE FUNCTION fn_fin_alloc_consume();

-- 3b) ลบจัดสรร (ยกเลิกออเดอร์) → คืนถุงเข้าล็อตสำเร็จ
CREATE OR REPLACE FUNCTION fn_fin_alloc_return()
RETURNS trigger AS $$
BEGIN
    UPDATE finished_lots
       SET qty_remaining = qty_remaining + OLD.qty_bags
     WHERE finished_lot_id = OLD.finished_lot_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fin_alloc_return ON finished_allocations;
CREATE TRIGGER trg_fin_alloc_return
    AFTER DELETE ON finished_allocations
    FOR EACH ROW EXECUTE FUNCTION fn_fin_alloc_return();

COMMIT;

SELECT 'finished_allocations' AS tbl, count(*) FROM finished_allocations;
