-- =====================================================================
-- 002_seed_data.sql
-- MCS CRM — Sample / demo data for the RFID inventory schema
-- Target DB: mcs_backend
-- Re-runnable: uses ON CONFLICT / NOT EXISTS guards.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. products (5 รายการ)
-- ---------------------------------------------------------------------
INSERT INTO products (sku, name, product_type, price, packaging_type) VALUES
    ('CB-001', 'เมล็ดกาแฟคั่ว',   'consumable', 350.00, 'ถุง 250g'),
    ('TT-001', 'ผงชาไทย',         'consumable', 180.00, 'ถุง 500g'),
    ('CS-001', 'ไซรัปคาราเมล',    'consumable', 220.00, 'ขวด 750ml'),
    ('GT-001', 'ผงชาเขียว',       'consumable', 240.00, 'ถุง 500g'),
    ('CH-001', 'ช็อคโกแลต',       'consumable', 200.00, 'ถุง 1kg')
ON CONFLICT (sku) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. rfid_tags (20 รายการ: MCS-CB-001 .. MCS-CB-020)
--    กระจาย 4 tag ต่อ 1 product
-- ---------------------------------------------------------------------
WITH tag_map AS (
    SELECT
        n,
        'MCS-CB-' || lpad(n::text, 3, '0') AS epc,
        CASE
            WHEN n BETWEEN  1 AND  4 THEN 'CB-001'
            WHEN n BETWEEN  5 AND  8 THEN 'TT-001'
            WHEN n BETWEEN  9 AND 12 THEN 'CS-001'
            WHEN n BETWEEN 13 AND 16 THEN 'GT-001'
            ELSE                          'CH-001'
        END AS sku
    FROM generate_series(1, 20) AS n
)
INSERT INTO rfid_tags
    (epc_code, tid_code, product_id, tag_type, status, lot_number, mfd_date, exp_date, printed_at)
SELECT
    tm.epc,
    'TID-' || lpad(tm.n::text, 3, '0'),
    p.product_id,
    'label',
    'active',
    'LOT-2026-07',
    DATE '2026-07-01',
    DATE '2027-07-01',
    now()
FROM tag_map tm
JOIN products p ON p.sku = tm.sku
ON CONFLICT (epc_code) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. stock_transactions (รับเข้าคลัง 20 รายการ — 1 รายการต่อ tag)
--    trigger trg_apply_stock_transaction จะอัปเดต stock_levels อัตโนมัติ
--    NOT EXISTS guard กันการรับซ้ำเมื่อรัน seed ซ้ำ
-- ---------------------------------------------------------------------
INSERT INTO stock_transactions
    (product_id, tag_id, txn_type, qty_change, note, staff_id)
SELECT
    t.product_id,
    t.tag_id,
    'receive',
    1,
    'รับเข้าคลังเริ่มต้น (seed)',
    'seed-script'
FROM rfid_tags t
WHERE t.epc_code LIKE 'MCS-CB-%'
  AND NOT EXISTS (
        SELECT 1
        FROM stock_transactions st
        WHERE st.tag_id = t.tag_id
          AND st.txn_type = 'receive'
    );

COMMIT;

-- ---------------------------------------------------------------------
-- สรุปผลหลัง seed
-- ---------------------------------------------------------------------
SELECT p.sku, p.name, s.qty_total, s.qty_available
FROM stock_levels s
JOIN products p USING (product_id)
ORDER BY p.sku;
