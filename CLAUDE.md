# CLAUDE.md — mcs-backend

> ไฟล์นี้ให้ Claude Code อ่านอัตโนมัติทุก session (ทุกเครื่องที่ clone repo นี้)
> เป็น "บริบทถาวร" ของโปรเจกต์ เจ้าของ repo แก้ได้ตลอด

## ภาษา
สื่อสารกับผู้ใช้เป็น **ภาษาไทย** ผู้ใช้เป็นเจ้าของร้าน ไม่ใช่โปรแกรมเมอร์ — อธิบายให้เข้าใจง่าย และอธิบายเหตุผล ไม่ใช่แค่สั่งงาน

## โปรเจกต์นี้คืออะไร
**MisterCoffeeShop (MCS)** — backend ระบบหลังบ้านร้านกาแฟ รวม 4 โมดูล: **CRM, Inventory, RFID, Factory (Production/BOM)**
หัวใจ: DB trigger ขยับสต็อกเองอัตโนมัติทุกครั้งที่มีรายการเคลื่อนไหว
โฟกัสงานปัจจุบัน: **โมดูลโรงงาน (Factory)**
Frontend (`mcs-frontend`) ยังเป็นแค่โครง งานจริงอยู่ฝั่ง backend ทั้งหมด

## Stack
Node.js + Express + PostgreSQL (ผ่าน `pg`) · dotenv, cors, helmet, morgan · ไม่มี ORM (เขียน SQL ตรง)

## โครงสร้าง (แยกหน้าที่เป็นชั้น)
```
server.js            จุดเริ่ม (ฟังที่ 0.0.0.0 ให้เครื่องใน LAN เรียกได้)
src/app.js           ตั้งค่า Express
src/config/          index.js (อ่าน .env) + db.js (connection pool)
src/routes/          แผนที่ URL → controller
src/controllers/     รับ req, validate, ตอบ res  (บาง ๆ)
src/services/        business logic + ครอบ DB transaction (BEGIN/COMMIT/ROLLBACK)
src/models/          data access layer — ฟังก์ชัน query รับ (db, ...) โดย db = client หรือ pool
src/middlewares/     notFound (404), errorHandler (จับ error รวมศูนย์)
src/scripts/         migration SQL 001–008 + tools
```
**Flow มาตรฐาน:** routes → controller → service → model → PostgreSQL
**กฎเหล็ก:** งานเขียนหลายสเต็ปต้องห่อด้วย transaction เดียว (ดูตัวอย่างใน `services/bom.service.js`)

## API (mount ที่ `/api` ใน `src/routes/index.js`)
`/health` `/rfid` `/products` `/stock` `/packing` `/warehouse` `/bom` `/production`
รูปแบบ response: `{ status: 'ok'|'error', ... }`

## โมดูลโรงงาน (Factory) — รายละเอียดที่กำลังทำ
Schema: `007_create_bom_schema.sql`, `008_add_bom_output_material.sql`

**ตาราง:** `bom_templates` (สูตร; bom_type = roasting|packaging; expected_loss_pct; output_product_id / output_material_id) · `bom_items` (ส่วนผสม → raw_materials) · `production_orders` (status: pending→in_progress→completed→cancelled) · `production_outputs` (qty_produced, qty_loss)

**Output แยก 2 ทางตามชนิดสูตร:**
- roasting → ผลผลิตเป็นวัตถุดิบกึ่งสำเร็จ เข้า `warehouse_stock` (output_material_id เช่น ROAST-001)
- packaging → ผลผลิตเป็นสินค้าสำเร็จรูป เข้า `stock_levels` ผ่าน stock_transactions (output_product_id เช่น MRC-500)

**วงจรใบสั่งผลิต 3 จังหวะ (`services/bom.service.js`):**
1. `createOrder` — required = qty_required × planned_qty × (1 + loss%/100); เช็คสต็อกพอไหม; พอ → จอง `qty_reserved`; ไม่พอ → ตอบ shortages
2. `startOrder` — ออก warehouse_issue ตัดวัตถุดิบจริง (trigger ลด qty_available + กันติดลบ) + ปล่อย reserved → in_progress
3. `completeOrder` — บันทึก output → เพิ่มสต็อกปลายทางตาม bom_type → completed

**API โรงงาน:** `GET/POST /api/bom`, `GET /api/bom/:id` · `POST /api/production/orders`, `GET /orders`, `GET /orders/:id`, `POST /orders/:id/start`, `POST /orders/:id/complete`

## โมดูลโรงคั่ว (Roastery) — โดเมน "ของจริง" ⭐ กำลังทำ
ที่มา: prototype `../coffee-roastery-erp.jsx` (React single-file, เดิมเก็บใน browser). เป็นข้อมูลจริงที่ธุรกิจใช้ (seed เดิม BEAN-006/MRC-500 เป็นแค่ตัวอย่าง). โมเดลเป็นแบบ **ตามรอยรายล็อต (traceability)** ต่างจาก BOM เดิม.
Schema: `009_create_roastery_schema.sql` (เพิ่มใหม่ ไม่แตะของเดิม). โค้ด: `roastery.{model,service,controller,routes}.js`.

**6 ตาราง:** `suppliers` · `green_coffee_lots` (สารดิบรายล็อต: origin/variety/process_method/moisture/price, remaining_kg บนแถว) · `roast_batches` (คั่ว: roast_level 5 ระดับ, green_in/roasted_out, loss_pct+remaining คำนวณโดย trigger, operator/machine) · `packaging_items` · `sales_orders` (customer/destination/currency THB|USD|EUR|JPY, status pending|packing|shipped) · `sales_order_allocations` (จัดสรรคั่ว→ออเดอร์)

**Triggers ตัด/คืนสต็อกอัตโนมัติ:** คั่ว → หัก `green_coffee_lots.remaining_kg` (กันติดลบ) + คำนวณ loss%; ลบล็อตคั่ว → คืนสารดิบ; allocation → หัก `roast_batches.remaining_roasted_kg`; ลบออเดอร์ → CASCADE + คืนคั่ว. รหัสออกอัตโนมัติ PREFIX-YYMM-NNN (SUP/GC/RB/EX) ใน service ภายใน transaction.

**API (mount ที่ /api):** `/roastery/summary` (dashboard) · `/suppliers` · `/green-lots` · `/roast-batches` · `/packaging` · `/sales-orders` (+ `/:id/status`)

**สถานะ:** backend + frontend เสร็จทั้งคู่.
- Backend: ทดสอบ e2e ผ่าน 8/8 + ยืนยันชั้น HTTP จริง.
- Frontend (`mcs-frontend`): หน้า `Roastery` (pages/Roastery.jsx) 6 แท็บ — แดชบอร์ด/รับวัตถุดิบ/การคั่ว/สต็อก/คำสั่งซื้อ/ซัพพลายเออร์. components อยู่ใน `src/components/roastery/*` ใช้ Tailwind v4 + api client (`src/api/client.js`). build + oxlint ผ่าน. เป็นแท็บแรกใน App.jsx.
- โครง prototype เดิม `../coffee-roastery-erp.jsx` ใช้เป็น reference ของฟิลด์/UX (แปลง window.storage → REST API แล้ว).

## สายการผลิต 2 คลัง + ใบสั่งงานรวม ⭐ (flow ที่ใช้จริง)
Migration `010` (Store+เบิกโอน) และ `011` (ใบสั่งงานรวม). โค้ด: `warehouse.*` (เพิ่ม transfers/store-stock) + `workorder.{model,service,controller,routes}.js`.

**2 คลังแยกยอด:** `warehouse_stock` (คลังกลาง, รับของเข้า) + `store_stock` (Store โรงคั่ว, ไลน์ผลิตเบิกใช้). ย้ายระหว่างกันด้วย **ใบเบิกโอน** `stock_transfers`(+items) → trigger `apply_stock_transfer` ต้นทางลด(กันติดลบ)/ปลายทางเพิ่ม, 2 ทิศ.

**ใบสั่งงานรวม `work_orders`:** 1 ใบ = คั่ว+บรรจุ (อ้าง 2 BOM: roasting+packaging) เบิกวัตถุดิบทั้งหมด (เมล็ด+ถุง/ฟอล์ย) จาก **Store** ทีเดียว. เมล็ดคั่ว = **ของกลางในงาน** (ไหลคั่ว→บรรจุ ไม่เก็บสต็อก). บันทึกได้/เสีย 2 จุด (roast_produced/loss, pack_produced/loss). ถุงสำเร็จ → stock_levels.
- flow: `POST /work-orders` (จองที่ Store) → `/start` (ตัดจาก Store+ปล่อยจอง) → `/complete` (ได้/เสีย 2 จุด→ถุงเข้า stock) → `/cancel` (คืนของ). guard: Store ไม่พอ / เมล็ดคั่วไม่พอบรรจุ → 400.
- planned_roast_qty (kg คั่ว) + planned_pack_qty (จำนวนถุง) — demand คำนวณ: roast items × planned_roast × (1+roast_loss%), pack items(ยกเว้นเมล็ดคั่ว) × planned_pack × (1+pack_loss%).

**API:** `POST/GET /warehouse/transfers`, `GET /warehouse/store-stock`, `GET/POST /work-orders`, `POST /work-orders/:id/{start,complete,cancel}`.
**ทดสอบ:** `npm run demo:mfg` (HTTP e2e flow ใหม่: รับ→เบิกโอน Store→ใบสั่งงานรวม→สินค้าเข้า stock) ✅ ผ่าน. โมดูล `/production` เดิม (ทีละ BOM, ตัดจากคลังกลาง) ยังอยู่ใช้ได้.

## รวม 2 ระบบ → ระบบเดียว (ตามรอยรายล็อตเต็มสูบ) ⭐ เสร็จแล้ว
เดิมมี 2 ระบบทำงานซ้ำ: **☕ โรงคั่ว** (lot-based: suppliers/green_coffee_lots/roast_batches/sales_orders — สต็อกคู่ขนานของตัวเอง) vs **🏭 สายการผลิต+คลัง** (work_orders บน warehouse_stock/store_stock). รวมโดย **ยึดสาย 🏭 เป็นหลัก ดึงของดีจาก ☕ มาเสียบ** (migration 012–014):

- **เฟส 1 (012):** `warehouse_receipts.supplier_id` → ทะเบียน `suppliers` (เลิกพิมพ์ชื่อลอยๆ). ใบรับเข้า list/get คืน `supplier_display`.
- **เฟส 2 (013) — หัวใจ:** green ติดตามเป็น **ล็อตล้วน** (ไม่ปนคลังวัตถุดิบ ไม่บันทึกซ้ำ). `green_coffee_lots` เก็บ `qty_central_kg` + `qty_store_kg` (เลิก remaining_kg). flow: รับล็อต→คลังกลาง → `green_lot_transfers` โอน→Store → ใบสั่งงานเลือก `green_lot_id`. ตอน `/complete` สร้าง `roast_batches` (trigger `fn_roast_consume_green` หัก `qty_store_kg`) + `finished_lots` (ตราวันคั่ว+batch). **สาวรอย: ถุง→roast_batch→green lot→ซัพ** (`GET /work-orders/finished-lots`). green เบิกจากล็อต/บรรจุเบิกจาก store_stock; green หักตอน complete (จริง).
- **เฟส 3 (014):** ขายถุงสำเร็จ FEFO: `sales_orders.product_id/qty_bags` + `finished_allocations` (trigger หัก `finished_lots.qty_remaining`). `POST /finished-sales` จัดสรร FEFO ข้ามล็อต + หัก stock_levels; ออเดอร์รู้ว่าส่งจากล็อตคั่วไหน. `GET /finished-sales/:id`.

**ผลข้างเคียงที่ตั้งใจ:** การคั่วผ่านแท็บ ☕ เดิม (`POST /roast-batches`) ตอนนี้หัก **qty_store_kg** เช่นกัน — ต้องเบิกโอน green เข้า Store ก่อนคั่ว (สอดคล้องกับสายจริง). `planned_roast_qty` = kg green ที่โหลดเข้าเตา.
**Frontend:** GreenLotsTab (ช่องคลังกลาง/Store + ปุ่ม →Store), WorkOrderTab (เลือกล็อต+ระดับคั่ว), แท็บใหม่ 🔎 ตามรอยล็อต + 🧾 ขายถุงสำเร็จ.
**ทดสอบ:** `npm run demo:mfg` ครอบคลุมถึงขายถุง FEFO + สาวรอยกลับ ✅ ผ่าน.

## คำสั่ง (รันในโฟลเดอร์ mcs-backend)
| คำสั่ง | ทำอะไร |
| --- | --- |
| `npm run dev` | เปิดเซิร์ฟเวอร์ dev (auto-reload ด้วย node --watch) |
| `npm start` | เปิดเซิร์ฟเวอร์ปกติ |
| `npm run db:test` | ทดสอบต่อฐานข้อมูล |
| `npm run rfid:sim` | จำลองเครื่องสแกน RFID |
| `npm run demo:e2e` | เทสต์ทั้งระบบ end-to-end |
| `node src/scripts/runSql.js src/scripts/009_create_roastery_schema.sql` | สร้างตารางโรงคั่ว |
| `node src/scripts/runSql.js src/scripts/00X_*.sql` | รัน migration ทีละไฟล์ |

## ข้อควรระวัง / convention
- ค่าลับอยู่ใน `.env` (ไม่ขึ้น git) — ดูตัวอย่างที่ `.env.example`
- ค่า numeric (qty) ตั้ง default ที่ฝั่ง JS ไม่ใช่ SQL COALESCE literal (กัน pg เดา type เป็น integer)
- ปัดเศษปริมาณด้วย 3 ตำแหน่ง (`round3`)
- คู่มือภาพรวมภาษาคนอยู่ที่ `../คู่มือเข้าใจโปรเจกต์_สำหรับมือใหม่.md`
