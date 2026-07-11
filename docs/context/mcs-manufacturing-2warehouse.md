# mcs-manufacturing-2warehouse
> MCS manufacturing flow the owner actually wants — 2 stock locations + combined roast+pack work order

สาย manufacturing "ของจริง" ที่เจ้าของต้องการ (ยืนยัน 2026-07-11) ของ [[mcs-project-overview]] — ต่อยอดจาก [[mcs-factory-module]] (BOM/production เดิมยังอยู่ใช้ได้).

**Flow:** รับของ→คลังกลาง → เบิกโอน→Store โรงคั่ว → ใบสั่งงานรวม(คั่ว+บรรจุ) เบิกทุกอย่างจาก Store → ได้/เสีย 2 จุด → ถุงสำเร็จเข้า stock_levels → (แพคกิ้งเข้าลัง = ขั้นถัดไป ไม่ใช่ BOM).

**Key decisions:** (1) 2 คลังแยกยอดจริง — `warehouse_stock`(กลาง) + `store_stock`(Store) + ใบเบิกโอน `stock_transfers`. (2) BOM แค่ 2: คั่ว+บรรจุ. (3) คั่ว+บรรจุ = **ใบสั่งงานเดียว** (`work_orders`, อ้าง 2 BOM). (4) เมล็ดคั่ว = **ของกลางในงาน** ไหลเข้าบรรจุเลย ไม่เก็บสต็อก.

**สถานะ (เฟส A+B เสร็จ, ทดสอบผ่าน):** migration `010`(store+transfers) + `011`(work_orders); โค้ด `warehouse.*`(+transfers/store-stock) + `workorder.{model,service,controller,routes}.js`. API: `/warehouse/transfers`, `/warehouse/store-stock`, `/work-orders`(+/:id/start|complete|cancel). เทสต์ `npm run demo:mfg`.

**อัปเดต 2026-07-11:** เมล็ด green ย้ายไปติดตามเป็น "ล็อต" แล้ว (ดู [[mcs-system-merge-lot-traceability]]) — ใบสั่งงานเลือก `green_lot_id` แทนเบิก green จาก store_stock; green หักตอน `/complete`. planned_roast_qty ตอนนี้ = kg green ที่โหลด. ถุง/ฟอล์ยยังเบิกจาก store_stock เหมือนเดิม.

**How to apply:** flow นี้คือแนวทางที่ใช้จริงของโรงงาน. งานถัดไปที่ยังไม่ทำ: ขั้น "แพคเข้าลัง" หลังบรรจุ, min/max ทั้ง 2 คลัง.
