-- =====================================================================
-- 008_add_bom_output_material.sql
-- เพิ่ม output_material_id ให้ bom_templates — สำหรับสูตร roasting ที่
-- ผลิต "วัตถุดิบกึ่งสำเร็จ" (raw material) แทนสินค้าสำเร็จรูป (product)
-- เมื่อ complete สูตร roasting จะเพิ่ม warehouse_stock ของ material นี้
-- รันผ่าน: node src/scripts/runSql.js src/scripts/008_add_bom_output_material.sql
-- =====================================================================

BEGIN;

ALTER TABLE bom_templates
    ADD COLUMN IF NOT EXISTS output_material_id uuid REFERENCES raw_materials(material_id);

-- BOM-001 (roasting) ผลิต ROAST-001 (เมล็ดกาแฟคั่ว)
UPDATE bom_templates
   SET output_material_id = (SELECT material_id FROM raw_materials WHERE code = 'ROAST-001')
 WHERE code = 'BOM-001';

COMMIT;

SELECT b.code, b.bom_type, b.output_product_id, m.code AS output_material
FROM bom_templates b
LEFT JOIN raw_materials m ON m.material_id = b.output_material_id
ORDER BY b.code;
