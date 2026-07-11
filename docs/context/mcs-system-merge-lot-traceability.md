# mcs-system-merge-lot-traceability
> MCS merge of the two overlapping systems (☕ roastery + 🏭 manufacturing) into one lot-traceable flow

รวม "2 ระบบทำงานซ้ำ" ของ [[mcs-project-overview]] ให้เป็นระบบเดียว (เสร็จ+push 2026-07-11). เดิม ☕ โรงคั่ว ([[mcs-roastery-module]], lot-based, สต็อกคู่ขนาน) ทับกับ 🏭 สายการผลิต+คลัง ([[mcs-manufacturing-2warehouse]]). เจ้าของยืนยัน: 2 คลัง (central/Store) ถูกต้องเก็บไว้ — ที่ซ้ำคือ 2 **โมดูลซอฟต์แวร์**.

**ทางออก (เจ้าของเลือก):** ยึดสาย 🏭 เป็นหลัก ดึงของดีจาก ☕ มาเสียบ; green ติดตาม "ล็อตล้วน"; ขาย "ถุงสำเร็จ" FEFO. migration `012`–`014`.

- **เฟส 1 (012):** `warehouse_receipts.supplier_id` → `suppliers` (เลิกชื่อลอยๆ).
- **เฟส 2 (013) หัวใจ:** `green_coffee_lots` เก็บ `qty_central_kg`+`qty_store_kg` (drop `remaining_kg`; model คืน derived remaining_kg = central+store เผื่อ UI เก่า). `green_lot_transfers`(+trigger) โอน central↔store. ใบสั่งงาน+`green_lot_id`+`roast_level`; `/complete` สร้าง `roast_batches`(trigger `fn_roast_consume_green` ชี้ใหม่ให้หัก `qty_store_kg`) + `finished_lots`(lineage). สาวรอย `GET /work-orders/finished-lots`. green จองที่ล็อต(`qty_store_reserved_kg`)/หักตอน complete จริง; ถุงจาก store_stock.
- **เฟส 3 (014):** `sales_orders.product_id/qty_bags` + `finished_allocations`(trigger หัก `finished_lots.qty_remaining`). `POST /finished-sales` จัดสรร FEFO ข้ามล็อต + หัก stock_levels(`stock_transactions 'sell'`). `GET /finished-sales/:id` โชว์ล็อตที่ส่ง.

**Why:** ตัดการบันทึกซ้ำ + ได้ traceability เต็ม (ถุง→คั่ว→ล็อต green→ซัพ) ซึ่งสำคัญกับกาแฟ single-origin/ส่งออก.

**How to apply:** ผลข้างเคียงตั้งใจ — คั่วผ่านแท็บ ☕ เดิม (`POST /roast-batches`) ตอนนี้หัก `qty_store_kg` ด้วย (ต้องโอน green เข้า Store ก่อน). `nextCode(db,table,prefix,col='code')` รับชื่อคอลัมน์ได้ (green_lot_transfers ใช้ `transfer_no`). รหัสใหม่: GT-, FL-, SO-. Frontend: GreenLotsTab(ช่อง central/Store+ปุ่ม →Store), WorkOrderTab(เลือกล็อต+ระดับคั่ว), แท็บใหม่ 🔎 ตามรอยล็อต + 🧾 ขายถุงสำเร็จ. ทดสอบ `npm run demo:mfg` (8 ขั้น รวมขายถุง FEFO+สาวรอย) ✅. ยังไม่ทำ: **min/max ทั้ง 2 คลัง (เจ้าของขอไว้)**, แพคเข้าลัง, FEFO วันหมดอายุ/ความสด.
