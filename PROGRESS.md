# mcs-backend — สรุปความคืบหน้าโปรเจกต์

> **โปรเจกต์:** MCS CRM Backend API + RFID Stock + Manufacturing
> **Stack:** Node.js v24+ (ทดสอบบน v25.6) + Express + PostgreSQL 17.10
> **อัปเดตล่าสุด:** 2026-07-11

---

## 📌 ภาพรวม
Backend API สำหรับระบบ CRM + คลังสินค้า RFID + **สายการผลิต (manufacturing)** ของ MCS
ครอบคลุมตั้งแต่ต้นน้ำถึงปลายน้ำ:

1. **คลังวัตถุดิบ (Warehouse)** — รับเข้า/จ่ายออกวัตถุดิบ (เมล็ดกาแฟดิบ, ผง, ไซรัป, บรรจุภัณฑ์)
2. **การผลิต (Production + BOM)** — สูตรการผลิต → เปิดใบสั่งผลิต → จอง/ตัดวัตถุดิบ → บันทึกผลผลิต
3. **สินค้าสำเร็จรูป + RFID** — ติด RFID tag, ยอดคงเหลือ, สแกนขาย
4. **การแพค (Packing)** — เริ่ม → สแกนตรวจสอบ → ยืนยัน → ส่งออก

ทุกส่วน **ทดสอบผ่านจริงแล้ว** (end-to-end)

---

## ✅ สิ่งที่ทำไปแล้ว

### 1. ตั้งค่าสภาพแวดล้อม
- เพิ่ม `psql` เข้า user PATH (`C:\Program Files\PostgreSQL\17\bin`)
- ยืนยัน Node v24+ / PostgreSQL 17.10

### 2. สร้างโปรเจกต์ `mcs-backend` (Express + PostgreSQL)
- โครงสร้างโฟลเดอร์มาตรฐาน (config / routes / controllers / services / models / middlewares / utils / scripts)
- ติดตั้ง dependencies: `express`, `pg`, `dotenv`, `cors`, `helmet`, `morgan`
- สร้าง connection pool + graceful shutdown
- Endpoint สุขภาพ: `GET /api/health`, `GET /api/health/db` → ทดสอบผ่าน
- สร้างฐานข้อมูล `mcs_backend` + ตั้งค่า `.env`

### 3. สร้าง RFID / Inventory Schema
**ไฟล์:** `src/scripts/001_create_rfid_schema.sql`

5 ตาราง: `products`, `rfid_tags`, `stock_levels`, `stock_transactions`, `packing_sessions`
**Trigger:** `trg_apply_stock_transaction` — อัปเดต `stock_levels` อัตโนมัติทุกครั้งที่ insert `stock_transactions`
→ ทดสอบแล้ว: รับ +50, ขาย −8 = คงเหลือ 42 ✅

### 4. ข้อมูลตัวอย่าง (Seed)
**ไฟล์:** `src/scripts/002_seed_data.sql` (+ `004_fix_thai_names.sql`)
- 5 products (เมล็ดกาแฟคั่ว, ผงชาไทย, ไซรัปคาราเมล, ผงชาเขียว, ช็อคโกแลต)
- 20 rfid_tags: `MCS-CB-001` → `MCS-CB-020` (4 tag/product)
- 20 stock_transactions (receive) → stock_levels = 4/product อัตโนมัติ

### 5. RFID Scan API + Simulator
- **`POST /api/rfid/scan`** — สแกน `epc_codes[]` แล้วทำงานครบวงจร (ห่อใน DB transaction): สร้าง `sell` txn (−1) → trigger ปรับสต็อก, อัปเดต `status='sold'`/`eas_active=false`, เตือนใกล้หมดอายุ + สต็อกต่ำ, กันขายซ้ำ (`skipped`)
- **`src/scripts/rfid_simulator.js`** — จำลองเครื่องอ่าน RFID (สุ่ม EPC → POST ทุก 3 วินาที)

### 6. Products & Stock API
- `GET/POST /api/products`, `GET /api/products/:id` (validate + error case 400/404/409)
- `GET /api/stock` — ยอดคงเหลือ + ธง `low_stock` + `low_stock_count`

### 7. Packing API
**ไฟล์:** `packing.controller.js`; migration `003_add_packing_expected.sql`
- `POST /api/packing/start` — สร้าง session (`pending`) เก็บ expected EPC
- `POST /api/packing/verify` — เทียบ scanned vs expected → ถ้าครบพอดี: `packed` + บันทึก `pack` txn (−1) + tags → `sold` (atomic)
- `POST /api/packing/ship` — `packed` → `shipped`
- `GET /api/packing/:packing_id` — ดูสถานะ

### 8. Register Tag + E2E Flow
- `POST /api/rfid/tags` — ลงทะเบียน tag + รับเข้าคลัง (`receive` +1) atomic
- **`src/scripts/e2e_demo.js`** (`npm run demo:e2e`) — เดิน flow เต็ม (register→receive→pack→verify→ship) + assert ทุกขั้น + cleanup อัตโนมัติ → ผ่านครบ ✅

### 9. Git + GitHub
- `git init` → push ขึ้น GitHub repo `mcs-backend` (`.env`/`node_modules` ไม่ถูก track)

---

### 🆕 10. Warehouse — คลังวัตถุดิบ (Raw Materials)
**ไฟล์:** `warehouse.controller.js` + `warehouse.service.js` + `warehouse.model.js`; migration `005_create_warehouse_schema.sql`, `006_seed_raw_materials.sql`

**6 ตาราง:**
| ตาราง | หน้าที่ |
| --- | --- |
| `raw_materials` | วัตถุดิบ (code/name/category/unit/qty_min_alert) |
| `warehouse_stock` | ยอดคงเหลือวัตถุดิบ (`qty_total`/`qty_available`/`qty_reserved`) |
| `warehouse_receipts` + `_items` | ใบรับเข้า + รายการ (lot/exp/qty/unit_cost) |
| `warehouse_issues` + `_items` | ใบจ่ายออก + รายการ |

**Category:** `BEAN` · `POWDER` · `LEAF` · `SYRUP` · `CREAM` · `PKG`
**Issue type:** `production` · `adjust` · `return` · `loss`

**Triggers:**
- `trg_apply_warehouse_receipt` — รับเข้า → เพิ่ม `qty_total`/`qty_available` อัตโนมัติ
- `trg_apply_warehouse_issue` — จ่ายออก → ลดสต็อก + **RAISE EXCEPTION ถ้าของไม่พอ** (กันติดลบ, ERRCODE `check_violation` → HTTP 400)

**Endpoints:**
- `GET /api/warehouse/materials` (กรอง `?category=`) · `POST /api/warehouse/materials`
- `POST/GET /api/warehouse/receipts` · `GET /api/warehouse/receipts/:id`
- `POST/GET /api/warehouse/issues` · `GET /api/warehouse/issues/:id`
- `GET /api/warehouse/stock` — คงเหลือทุกวัตถุดิบ + ธง `low_stock`

**Seed:** 62 วัตถุดิบจริงของ MisterCoffeeShop (เมล็ดกาแฟดิบ 22, ผง, ใบชา, ไซรัป, ครีม, บรรจุภัณฑ์) + `ROAST-001` (เมล็ดคั่วกึ่งสำเร็จ) = **63 รายการ**

### 🆕 11. BOM — สูตรการผลิต (Bill of Materials)
**ไฟล์:** `bom.controller.js` + `bom.service.js` + `bom.model.js`; migration `007_create_bom_schema.sql`, `008_add_bom_output_material.sql`

**2 ตาราง:**
| ตาราง | หน้าที่ |
| --- | --- |
| `bom_templates` | สูตร (code/name/`bom_type`/output/`expected_loss_pct`) |
| `bom_items` | ส่วนผสมในสูตร (material_id + `qty_required` + unit) |

**bom_type:**
- `roasting` — คั่วกาแฟ → output เป็น **วัตถุดิบกึ่งสำเร็จ** (`output_material_id` → `raw_materials`)
- `packaging` — แพคสินค้า → output เป็น **สินค้าสำเร็จรูป** (`output_product_id` → `products`)

**Endpoints:** `GET /api/bom` · `POST /api/bom` (สร้างสูตร + items ใน transaction) · `GET /api/bom/:id`

**Seed 2 สูตร:**
- `BOM-001` สูตรคั่วกาแฟ (roasting): 0.6kg อาราบิก้าลาว + 0.4kg โรบัสต้าไทย → เมล็ดคั่ว 1kg, loss 15%
- `BOM-002` สูตรแพคถุง 500g (packaging): 0.52kg เมล็ดคั่ว + ถุง + สติ๊กเกอร์ → `MRC-500` 1 ถุง, loss 2%

### 🆕 12. Production — ใบสั่งผลิต + ตัดวัตถุดิบ
**ไฟล์:** `production.controller.js` (ใช้ `bom.service.js`); ตาราง `production_orders`, `production_outputs` (จาก migration `007`)

**Flow 3 สถานะ (`pending → in_progress → completed`):**
1. **`POST /api/production/orders`** — เปิดใบสั่ง: คำนวณวัตถุดิบที่ต้องใช้ = `qty_required × planned_qty × (1 + loss%)` → เช็คสต็อกว่าง (`qty_available − qty_reserved`) พอไหม → ถ้าไม่พอคืน 400 + `shortages`; ถ้าพอ → **จอง `qty_reserved`** → `pending`
2. **`POST /api/production/orders/:id/start`** — เริ่มผลิต: สร้าง `warehouse_issues` (type=`production`) **ตัดวัตถุดิบจริง** (trigger throw ถ้าไม่พอ) + ปล่อยการจอง → `in_progress`
3. **`POST /api/production/orders/:id/complete`** — จบผลิต (ต้องส่ง `qty_produced`): บันทึก `production_outputs` → `completed`
   - ถ้า `roasting` → เพิ่ม `warehouse_stock` ของเมล็ดคั่ว (ROAST-001) เก็บไว้ให้ packaging ใช้ต่อ
   - ถ้า `packaging` → เพิ่ม `stock_levels` ของสินค้าสำเร็จรูป (ผ่าน `stock_transactions` receive)
- `GET /api/production/orders` · `GET /api/production/orders/:id` (คืน `required_materials` + `outputs`)

> **หมายเหตุ:** โมดูลนี้เป็นตัวเชื่อม `qty_reserved` (การจอง) ที่เดิม PROGRESS ระบุว่ายังไม่ทำ — ตอนนี้ทำแล้วผ่าน production order

---

## 📁 โครงสร้างไฟล์ปัจจุบัน

```
mcs-backend/
├── server.js                 # Entry point + graceful shutdown
├── package.json              # scripts: start / dev / db:test / rfid:sim / demo:e2e / demo:mfg
├── .env / .env.example       # config (.env อยู่ใน .gitignore)
├── README.md · SETUP_LOG.md · PROGRESS.md
└── src/
    ├── app.js                # Express app
    ├── config/               # index.js (env) + db.js (pg pool)
    ├── routes/               # health · rfid · product · stock · packing
    │                         # + warehouse · bom · production   🆕
    ├── controllers/          # ต่อ route (มี warehouse/bom/production 🆕)
    ├── services/             # 🆕 warehouse.service · bom.service (business logic)
    ├── models/               # 🆕 warehouse.model · bom.model (data access)
    ├── middlewares/          # errorHandler · notFound
    ├── utils/                # 🆕 handleDbError (pg error → HTTP)
    └── scripts/
        ├── 001_create_rfid_schema.sql
        ├── 002_seed_data.sql
        ├── 003_add_packing_expected.sql
        ├── 004_fix_thai_names.sql
        ├── 005_create_warehouse_schema.sql      🆕
        ├── 006_seed_raw_materials.sql           🆕
        ├── 007_create_bom_schema.sql            🆕
        ├── 008_add_bom_output_material.sql      🆕
        ├── runSql.js · testConnection.js
        ├── rfid_simulator.js · e2e_demo.js · manufacturing_e2e.js 🆕
```

---

## 🔌 API Endpoints (สรุปทั้งหมด)

| กลุ่ม | Endpoints |
| --- | --- |
| **Health** | `GET /api/health` · `GET /api/health/db` |
| **RFID** | `POST /api/rfid/tags` · `POST /api/rfid/scan` |
| **Products** | `GET/POST /api/products` · `GET /api/products/:id` |
| **Stock** | `GET /api/stock` |
| **Packing** | `POST /api/packing/{start,verify,ship}` · `GET /api/packing/:packing_id` |
| **Warehouse** 🆕 | `GET/POST /api/warehouse/materials` · `.../receipts` · `.../issues` · `GET /api/warehouse/stock` |
| **BOM** 🆕 | `GET/POST /api/bom` · `GET /api/bom/:id` |
| **Production** 🆕 | `GET/POST /api/production/orders` · `GET /api/production/orders/:id` · `POST .../:id/start` · `POST .../:id/complete` |

---

## 🔄 End-to-End Flows

**A) RFID / Packing** (ทดสอบด้วย `npm run demo:e2e`)
```
ลงทะเบียน Tag → รับเข้าคลัง → Packing Session → verify → Stock หัก + Tag=sold → shipped
```

**B) Manufacturing** 🆕 (ทดสอบด้วย `npm run demo:mfg` — assert 8 ขั้น ผ่านครบ ✅)
```
สร้าง BOM (สูตร)                           POST /api/bom
      ↓
รับวัตถุดิบเข้าคลัง                          POST /api/warehouse/receipts
      ↓
เปิดใบสั่งผลิต → เช็ค+จองวัตถุดิบ            POST /api/production/orders
      ↓
เริ่มผลิต → ตัดวัตถุดิบจริง (issue)          POST /api/production/orders/:id/start
      ↓
จบผลิต → บันทึกผลผลิต                       POST /api/production/orders/:id/complete
      ↓
roasting → เมล็ดคั่วเข้า warehouse_stock
packaging → สินค้าสำเร็จรูปเข้า stock_levels
```

---

## ▶️ คำสั่งใช้งาน

```powershell
cd mcs-backend
npm run dev        # เปิดเซิร์ฟเวอร์ (auto-reload)
npm start          # production
npm run db:test    # ทดสอบการเชื่อมต่อ DB
npm run rfid:sim   # รันตัวจำลอง RFID (ต้องเปิดเซิร์ฟเวอร์ก่อน)
npm run demo:e2e   # ทดสอบ flow ครบวงจร (RFID/Packing)
npm run demo:mfg   # ทดสอบ flow สาย manufacturing (BOM คั่ว→บรรจุ, assert 8 ขั้น)
```

รัน migration ทั้งหมด (จากโฟลเดอร์ `mcs-backend`):
```powershell
foreach ($f in '001_create_rfid_schema','002_seed_data','003_add_packing_expected','004_fix_thai_names','005_create_warehouse_schema','006_seed_raw_materials','007_create_bom_schema','008_add_bom_output_material') {
  node src/scripts/runSql.js "src/scripts/$f.sql"
}
```

---

## 🎯 ขั้นถัดไปที่แนะนำ (ยังไม่ได้ทำ)

1. **ยกเลิกใบสั่งผลิต** — `POST /production/orders/:id/cancel` (คืน `qty_reserved` ที่จองไว้)
2. **CRUD ที่เหลือ** — `PUT/DELETE /products`, แก้ไข/ยกเลิก receipt/issue, endpoint `stock_transactions`
3. **API docs / test** — ไฟล์ `.http` หรือ Swagger, unit/integration test
4. **CI/CD** — GitHub Actions รัน lint/test อัตโนมัติ

### ✅ ทำเสร็จแล้ว (จากรายการเดิม)
- ~~**E2E test สาย manufacturing**~~ → 🆕 `npm run demo:mfg` (`manufacturing_e2e.js`) เดิน flow เต็มผ่าน HTTP API + assert ครบ **8 ขั้น** (รับวัตถุดิบ → เปิดใบสั่งคั่ว/จอง → เริ่ม/ตัดจริง → คั่วเสร็จ/เมล็ดคั่วเข้า Store → เปิดใบสั่งบรรจุ/จอง → เริ่ม/ตัดจริง → บรรจุเสร็จ/สินค้าเข้า `stock_levels`) + cleanup อัตโนมัติ → **ผ่านครบทุกขั้น ✅** (รัน 2026-07-11)
- ~~Packing flow~~ → verify → pack → ship แล้ว
- ~~`qty_reserved` logic~~ → 🆕 production order จอง/ปล่อยวัตถุดิบแล้ว
- ~~ทำให้การสแกนมีผลจริง~~ · ~~API สินค้า/สต็อก~~ · ~~git init + push~~

---

## ⚠️ หมายเหตุ
- **รหัสผ่าน DB** เก็บใน `.env` (อยู่ใน `.gitignore` — ไม่ถูก commit)
- **SQL ที่มีภาษาไทย ต้องรันผ่าน `node src/scripts/runSql.js <file>`** ห้ามใช้ `Get-Content | psql` (PowerShell pipe แปลงไทยเป็น `?` ก่อนถึง Postgres → ข้อมูลเสียถาวร)
- ภาษาไทยใน Windows console อาจแสดงเป็น `???` — พิมพ์ `chcp 65001` ก่อน หรือดูจาก API response (เป็น UTF-8 ถูกต้อง)
