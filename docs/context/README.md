# 🧠 บริบทถาวรของโปรเจกต์ (Portable Context)

โฟลเดอร์นี้คือ **สำเนาบันทึกความจำ** ของโปรเจกต์ MCS ที่ **อยู่ใน git** จึงติดไปทุกเครื่องที่ `git clone`
ทำให้คุยกับ Claude ต่อเนื่องได้โดยไม่ต้องอธิบายโปรเจกต์ใหม่

> Claude: อ่าน `CLAUDE.md` ก่อน แล้วอ่านไฟล์ในโฟลเดอร์นี้เพื่อบริบทเชิงลึก
> ไฟล์เชื่อมกันด้วย `[[ชื่อไฟล์]]` (คือไฟล์ `.md` ชื่อเดียวกันในโฟลเดอร์นี้)

## รายการ
- [mcs-project-overview](mcs-project-overview.md) — ภาพรวม: backend เดียว 4 โมดูล (CRM/Inventory/RFID/Factory)
- [mcs-factory-module](mcs-factory-module.md) — BOM + ใบสั่งผลิต, วงจร 3 จังหวะ, output 2 ปลายทาง
- [mcs-roastery-module](mcs-roastery-module.md) — โดเมนตามรอยล็อตจริง (ซัพ→สารดิบ→คั่ว→ขาย)
- [mcs-manufacturing-2warehouse](mcs-manufacturing-2warehouse.md) — flow จริงเจ้าของ: 2 คลัง + ใบสั่งงานรวมคั่ว+บรรจุ
- [mcs-system-merge-lot-traceability](mcs-system-merge-lot-traceability.md) — รวม 2 ระบบเป็นหนึ่ง: green เป็นล็อต, สาวรอยถุงสำเร็จ, ขายถุง FEFO

> หมายเหตุ: นี่คือ snapshot อัปเดตด้วยมือ (2026-07-11). แหล่งจริงตอนทำงานคือ `CLAUDE.md` + `PROGRESS.md`.
> ประวัติแชทคำต่อคำ ไม่ได้อยู่ในนี้ (อยู่เครื่องที่คุยเท่านั้น).
