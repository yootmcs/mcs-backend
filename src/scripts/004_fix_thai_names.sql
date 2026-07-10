-- =====================================================================
-- 004_fix_thai_names.sql
-- แก้ชื่อสินค้าภาษาไทยที่ถูกเก็บเป็น '?' (เพราะ seed ผ่าน PowerShell pipe)
-- รันผ่าน node runner เพื่อให้ UTF-8 ไปถึง Postgres จริง:
--   node src/scripts/runSql.js src/scripts/004_fix_thai_names.sql
-- =====================================================================

UPDATE products SET name = 'เมล็ดกาแฟคั่ว Mr.Coffee Blend' WHERE sku = 'CB-001';
UPDATE products SET name = 'ผงช็อคโกแลต' WHERE sku = 'CH-001';
UPDATE products SET name = 'ไซรัปคาราเมล' WHERE sku = 'CS-001';
UPDATE products SET name = 'ผงชาเขียว' WHERE sku = 'GT-001';
UPDATE products SET name = 'ผงชาไทย' WHERE sku = 'TT-001';
