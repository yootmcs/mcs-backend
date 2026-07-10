-- =====================================================================
-- 003_add_packing_expected.sql
-- เพิ่มคอลัมน์เก็บรายการ EPC ที่คาดหวัง (expected) ต่อ packing session
-- เพื่อให้ /api/packing/verify เทียบกับของที่สแกนได้ (scanned) ภายหลัง
-- =====================================================================

BEGIN;

ALTER TABLE packing_sessions
    ADD COLUMN IF NOT EXISTS expected_epc_codes text[] NOT NULL DEFAULT '{}';

COMMIT;
