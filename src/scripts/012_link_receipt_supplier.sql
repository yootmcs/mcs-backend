-- =====================================================================
-- 012_link_receipt_supplier.sql
-- MCS — รวมระบบ เฟส 1: ผูกใบรับเข้า (warehouse_receipts) เข้ากับ
--        ทะเบียนซัพพลายเออร์กลาง (suppliers) แทนการพิมพ์ชื่อลอยๆ
-- เดิม: warehouse_receipts.supplier_name = ข้อความอิสระ (ซ้ำกับตาราง suppliers)
-- ใหม่: เพิ่ม supplier_id → suppliers  (ยังเก็บ supplier_name ไว้เป็น snapshot/legacy)
-- รันผ่าน: node src/scripts/runSql.js src/scripts/012_link_receipt_supplier.sql
-- =====================================================================

BEGIN;

-- เพิ่มคอลัมน์อ้างอิงซัพพลายเออร์ (nullable — ใบเก่าไม่มีก็ยังอยู่ได้)
ALTER TABLE warehouse_receipts
    ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(supplier_id);

CREATE INDEX IF NOT EXISTS idx_wh_receipts_supplier ON warehouse_receipts(supplier_id);

COMMIT;

-- ตรวจผล
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'warehouse_receipts'
  AND column_name IN ('supplier_id', 'supplier_name')
ORDER BY column_name;
