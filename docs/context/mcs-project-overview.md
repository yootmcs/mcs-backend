# mcs-project-overview
> MisterCoffeeShop (mcs-backend) — Node/Express/PostgreSQL backend joining CRM, Inventory, RFID, and Factory modules

โปรเจกต์ **MisterCoffeeShop** ("business modules") ที่ e:\Project_CRM — backend เดียว `mcs-backend` (Node + Express + PostgreSQL/pg) รวม 4 โมดูล: CRM, Inventory, RFID, และ Factory (Production/BOM). Frontend (`mcs-frontend`, React 19 + Vite + Tailwind v4) มีหน้าจอจริงหลายแท็บแล้ว.

โครงสร้าง: `src/{routes,controllers,services,models,middlewares,scripts,config}`. Schema สร้างด้วย migration SQL 001–014 รันผ่าน `node src/scripts/runSql.js <file>`. หัวใจระบบ: DB trigger ขยับสต็อกเองอัตโนมัติ (`trg_apply_stock_transaction` บน stock_transactions; `apply_warehouse_receipt`/`apply_warehouse_issue` บน warehouse; transfer/work-order/roast triggers).

**How to apply:** ผู้ใช้ (เจ้าของร้าน ไม่ใช่โปรแกรมเมอร์, สื่อสารไทย) โฟกัสโมดูล Factory ก่อน ดู [[mcs-factory-module]] → ต่อยอดเป็น [[mcs-manufacturing-2warehouse]] และรวมกับ [[mcs-roastery-module]] เป็นระบบเดียว [[mcs-system-merge-lot-traceability]]. คู่มืออธิบายภาพรวมภาษาคนอยู่ที่ `คู่มือเข้าใจโปรเจกต์_สำหรับมือใหม่.md`.
