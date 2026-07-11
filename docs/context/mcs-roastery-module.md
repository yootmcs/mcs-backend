# mcs-roastery-module
> MCS Roastery module — real lot-traceability domain from coffee-roastery-erp.jsx prototype (suppliers→green lots→roast→sales)

โมดูลโรงคั่ว (Roastery) ของ [[mcs-project-overview]] — โดเมน **"ของจริง"** ที่ผู้ใช้ยืนยัน (seed เดิม BEAN-006/MRC-500 เป็นแค่ตัวอย่าง). ที่มา: prototype `e:/Project_CRM/coffee-roastery-erp.jsx`. โมเดลแบบ **ตามรอยรายล็อต** ต่างจาก [[mcs-factory-module]] (BOM).

**Backend + Frontend เสร็จแล้ว (2026-07-11).** Backend: `009_create_roastery_schema.sql` + `roastery.{model,service,controller,routes}.js` (mount ที่ /api ผ่าน router.use('/', ...)). Frontend (`mcs-frontend`): `pages/Roastery.jsx` 6 แท็บ + `components/roastery/*` + api methods ใน `src/api/client.js`; เป็นแท็บแรกใน App.jsx.

**6 ตาราง:** suppliers, green_coffee_lots, roast_batches (loss_pct+remaining คำนวณ trigger), packaging_items, sales_orders, sales_order_allocations. Triggers ตัด/คืนสต็อกอัตโนมัติ. รหัส PREFIX-YYMM-NNN (SUP/GC/RB/EX/SO/GT/FL) ออกใน service ผ่าน `nextCode(db,table,prefix,col='code')`.

**API:** /roastery/summary, /suppliers, /green-lots, /roast-batches, /packaging, /sales-orders(+/:id/status).

**สำคัญ — โมดูลนี้ถูกรวมเข้าสาย 🏭 แล้ว** (ดู [[mcs-system-merge-lot-traceability]]): green ไม่ใช้ `remaining_kg` เดี่ยวอีก แต่แยกเป็น `qty_central_kg`+`qty_store_kg`; การคั่วผ่านแท็บ ☕ (`POST /roast-batches`) ตอนนี้หัก `qty_store_kg`; การขายหลักย้ายเป็น "ขายถุงสำเร็จ FEFO". ตาราง suppliers/green_coffee_lots/sales_orders ถูก reuse โดยสาย 🏭.

**How to apply:** เมื่อแก้โมดูลนี้ ให้ยึด prototype เป็น source of truth ของ UX/ฟิลด์; ตามรูปแบบ layer เดิมของ backend. ระวัง: green stock อยู่ที่ 2 ช่อง (central/store) ไม่ใช่ remaining_kg แล้ว.
