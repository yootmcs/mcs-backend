-- =====================================================================
-- 006_seed_raw_materials.sql
-- Seed วัตถุดิบจริงของ MisterCoffeeShop (62 รายการ) + สร้าง warehouse_stock
-- รันผ่าน: node src/scripts/runSql.js src/scripts/006_seed_raw_materials.sql
-- (มีภาษาไทย ห้าม pipe ผ่าน psql)
-- =====================================================================

BEGIN;

INSERT INTO raw_materials (code, name, category, unit, qty_min_alert) VALUES
    -- หมวด BEAN (kg)
    ('BEAN-001', 'เมล็ด-[สารกาแฟดิบ]-บราซิล ซานโตส', 'BEAN', 'kg', 10),
    ('BEAN-002', 'เมล็ด-[สารกาแฟดิบ]-บราซิล เซราโด้', 'BEAN', 'kg', 10),
    ('BEAN-003', 'เมล็ด-[สารกาแฟดิบ]-โคลัมเบีย', 'BEAN', 'kg', 10),
    ('BEAN-004', 'เมล็ด-[สารกาแฟดิบ]-โคลัมเบีย กลิ่นพีช', 'BEAN', 'kg', 10),
    ('BEAN-005', 'เมล็ด-[สารกาแฟดิบ]-เอธิโอเปีย Sidamo', 'BEAN', 'kg', 10),
    ('BEAN-006', 'เมล็ด-[สารกาแฟดิบ]-อาราบิก้าลาว', 'BEAN', 'kg', 10),
    ('BEAN-007', 'เมล็ด-[สารกาแฟดิบ]-อาราบิก้าลาว เกรดรวม', 'BEAN', 'kg', 10),
    ('BEAN-008', 'เมล็ด-[สารกาแฟดิบ]-อาราบิก้าลาว เกรด FAQ', 'BEAN', 'kg', 10),
    ('BEAN-009', 'เมล็ด-[สารกาแฟดิบ]-อาราบิก้าลาว เกรด 13-14', 'BEAN', 'kg', 10),
    ('BEAN-010', 'เมล็ด-[สารกาแฟดิบ]-อาราบิก้าลาว เกรด 13-14 เม็ดดำ', 'BEAN', 'kg', 10),
    ('BEAN-011', 'เมล็ด-[สารกาแฟดิบ]-อาราบิก้าลาว เกรด AN', 'BEAN', 'kg', 10),
    ('BEAN-012', 'เมล็ด-[สารกาแฟดิบ]-อาราบิก้าลาว ผสม 3 สี', 'BEAN', 'kg', 10),
    ('BEAN-013', 'เมล็ด-[สารกาแฟดิบ]-อาราบิก้า ตกเกรด CS', 'BEAN', 'kg', 10),
    ('BEAN-014', 'เมล็ด-[สารกาแฟดิบ]-อาราบิก้า ตกเกรด GV', 'BEAN', 'kg', 10),
    ('BEAN-015', 'เมล็ด-[สารกาแฟดิบ]-อาราบิก้าไทย เชียงราย', 'BEAN', 'kg', 10),
    ('BEAN-016', 'เมล็ด-[สารกาแฟดิบ]-อาราบิก้าไทย น่าน', 'BEAN', 'kg', 10),
    ('BEAN-017', 'เมล็ด-[สารกาแฟดิบ]-อาราบิก้าเวียดนาม', 'BEAN', 'kg', 10),
    ('BEAN-018', 'เมล็ด-[สารกาแฟดิบ]-โรบัสต้าไทย', 'BEAN', 'kg', 10),
    ('BEAN-019', 'เมล็ด-[สารกาแฟดิบ]-โรบัสต้า EK1 Indonesia', 'BEAN', 'kg', 10),
    ('BEAN-020', 'เมล็ด-[สารกาแฟดิบ]-โรบัสต้า ลาว', 'BEAN', 'kg', 10),
    ('BEAN-021', 'เมล็ด-[สารกาแฟดิบ]-โรบัสต้า แทนซาเนีย', 'BEAN', 'kg', 10),
    ('BEAN-022', 'เมล็ด-[สารกาแฟดิบ]-โรบัสต้า Vietnam', 'BEAN', 'kg', 10),
    -- หมวด POWDER (kg)
    ('POWDER-001', 'RM.ผงผสมชาเขียว', 'POWDER', 'kg', 10),
    ('POWDER-002', 'RM.ผงโกโก้ BT270', 'POWDER', 'kg', 10),
    ('POWDER-003', 'RM.ผงโกโก้ BT240', 'POWDER', 'kg', 10),
    ('POWDER-004', 'RM.ผงช็อคโกแลต', 'POWDER', 'kg', 10),
    ('POWDER-005', 'RM.ผงผสมชาไทย', 'POWDER', 'kg', 10),
    ('POWDER-006', 'RM.ผงเผือก', 'POWDER', 'kg', 10),
    ('POWDER-007', 'RM.ผงเมล่อน', 'POWDER', 'kg', 10),
    ('POWDER-008', 'RM-04-LIMG ผงมะนาว', 'POWDER', 'kg', 10),
    ('POWDER-009', 'ผงชาเขียวมัทฉะ Nutto Matcha Powder', 'POWDER', 'kg', 10),
    ('POWDER-010', 'ชาเขียวมัทฉะ อู่หลง', 'POWDER', 'kg', 10),
    -- หมวด LEAF (kg)
    ('LEAF-001', 'RM.ใบชาไทย ตรามือ', 'LEAF', 'kg', 10),
    ('LEAF-002', 'RM.ใบชาไทย', 'LEAF', 'kg', 10),
    ('LEAF-003', 'RM.ใบชาไทย 200กรัม', 'LEAF', 'kg', 10),
    ('LEAF-004', 'RM.ชานางฟ้า', 'LEAF', 'kg', 10),
    ('LEAF-005', 'RM.ใบชาเขียว #1', 'LEAF', 'kg', 10),
    ('LEAF-006', 'RM.ใบชาเขียว #1 สิริกร', 'LEAF', 'kg', 10),
    ('LEAF-007', 'RM.ใบชาเขียว #2', 'LEAF', 'kg', 10),
    ('LEAF-008', 'RM.ใบชาเขียว #3', 'LEAF', 'kg', 10),
    ('LEAF-009', 'RM.ใบชาเขียว #3 สิริกร', 'LEAF', 'kg', 10),
    ('LEAF-010', 'RM.ใบชาเขียว #4', 'LEAF', 'kg', 10),
    ('LEAF-011', 'RM.ใบชาเขียว #5', 'LEAF', 'kg', 10),
    ('LEAF-012', 'RM.ใบชาเขียว #6', 'LEAF', 'kg', 10),
    ('LEAF-013', 'RM.ใบชาเขียวมะลิ', 'LEAF', 'kg', 10),
    ('LEAF-014', 'RM.ใบชาเขียวมะลิ 2 สิริกร', 'LEAF', 'kg', 10),
    ('LEAF-015', 'RM.ใบชาเขียวอัชสัม พรีเมี่ยม', 'LEAF', 'kg', 10),
    ('LEAF-016', 'RM.ใบชาอัญชัน BZ', 'LEAF', 'kg', 10),
    ('LEAF-017', 'RM.ใบชาซีลอน #1 PS', 'LEAF', 'kg', 10),
    ('LEAF-018', 'RM.ใบชาซีลอน #2 PS', 'LEAF', 'kg', 10),
    ('LEAF-019', 'ใบชาแดง BZ', 'LEAF', 'kg', 10),
    -- หมวด SYRUP (kg)
    ('SYRUP-001', 'RM.Me-S Syrup น้ำเชื่อม', 'SYRUP', 'kg', 10),
    ('SYRUP-002', 'RM.น้ำเชื่อมตราตัวC', 'SYRUP', 'kg', 10),
    ('SYRUP-003', 'ซูคราโลส Sucralose 1000G', 'SYRUP', 'kg', 10),
    ('SYRUP-004', 'สารแต่งกลิ่นอาหาร กลิ่นคาราเมล', 'SYRUP', 'kg', 10),
    -- หมวด CREAM (kg)
    ('CREAM-001', 'RM.B-Mix ครีมหอมนมสด', 'CREAM', 'kg', 10),
    ('CREAM-002', 'RM.B-Two ครีมเทียม 35%', 'CREAM', 'kg', 10),
    ('CREAM-003', 'RM.ครีมนมสด KML', 'CREAM', 'kg', 10),
    -- หมวด PKG (ชิ้น)
    ('PKG-001', 'ถุงฟอล์ย 500g', 'PKG', 'ชิ้น', 10),
    ('PKG-002', 'ถุงฟอล์ย 250g', 'PKG', 'ชิ้น', 10),
    ('PKG-003', 'RFID Label Tag', 'PKG', 'ชิ้น', 10),
    ('PKG-004', 'กล่องกระดาษลูกฟูก', 'PKG', 'ชิ้น', 10)
ON CONFLICT (code) DO NOTHING;

-- สร้าง warehouse_stock ให้ทุก material (qty เริ่มต้น 0)
INSERT INTO warehouse_stock (material_id)
SELECT material_id FROM raw_materials
ON CONFLICT (material_id) DO NOTHING;

COMMIT;

-- สรุปจำนวนตามหมวด
SELECT category, count(*) AS n FROM raw_materials GROUP BY category ORDER BY category;
