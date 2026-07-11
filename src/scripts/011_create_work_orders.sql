-- =====================================================================
-- 011_create_work_orders.sql
-- MCS — ใบสั่งงานรวม (คั่ว + บรรจุ) 1 ใบ เบิกวัตถุดิบทั้งหมดจาก Store โรงคั่ว
--   คั่ว+บรรจุ อยู่สถานีติดกัน → ทำในใบสั่งงานเดียว
--   เมล็ดคั่ว = ของกลางในงาน (ไหลจากคั่ว → บรรจุเลย ไม่เก็บเป็นสต็อก)
--   บันทึกได้/เสีย 2 จุด (หลังคั่ว, หลังบรรจุ) → ถุงสำเร็จเข้า stock_levels
-- Target DB: mcs_backend  (PostgreSQL 13+)
-- รันผ่าน: node src/scripts/runSql.js src/scripts/011_create_work_orders.sql
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- กันสต็อก Store ติดลบ (ตอนไลน์ผลิตเบิกออก) — เพิ่ม CHECK ให้ store_stock
ALTER TABLE store_stock
    ADD CONSTRAINT store_stock_nonneg
    CHECK (qty_available >= 0 AND qty_total >= 0 AND qty_reserved >= 0)
    NOT VALID;

CREATE TABLE IF NOT EXISTS work_orders (
    work_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_no           varchar(50) UNIQUE NOT NULL,
    roast_bom_id      uuid NOT NULL REFERENCES bom_templates(bom_id),
    pack_bom_id       uuid NOT NULL REFERENCES bom_templates(bom_id),
    planned_roast_qty numeric(12, 3) NOT NULL CHECK (planned_roast_qty > 0),  -- kg เมล็ดคั่วที่วางแผน
    planned_pack_qty  numeric(12, 3) NOT NULL CHECK (planned_pack_qty > 0),   -- จำนวนถุงที่วางแผน
    status            varchar(20) DEFAULT 'pending'
                      CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    -- ผลช่วงคั่ว
    roast_produced    numeric(12, 3),
    roast_loss        numeric(12, 3),
    roast_loss_reason text,
    -- ผลช่วงบรรจุ
    pack_produced     numeric(12, 3),
    pack_loss         numeric(12, 3),
    pack_loss_reason  text,
    started_at        timestamptz,
    completed_at      timestamptz,
    staff_id          varchar(100),
    note              text,
    created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_orders_roast_bom ON work_orders(roast_bom_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_pack_bom  ON work_orders(pack_bom_id);

COMMIT;

SELECT 'work_orders' AS tbl, count(*) FROM work_orders;
