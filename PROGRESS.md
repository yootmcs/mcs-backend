# mcs-backend — สรุปความคืบหน้าโปรเจกต์

> **โปรเจกต์:** MCS CRM Backend API
> **Stack:** Node.js v24.18 + Express + PostgreSQL 17.10
> **อัปเดตล่าสุด:** 2026-07-10

---

## 📌 ภาพรวม
Backend API สำหรับระบบ CRM + คลังสินค้า RFID ของ MCS
ตอนนี้มีครบตั้งแต่โครงสร้างโปรเจกต์ → ฐานข้อมูล RFID → ข้อมูลตัวอย่าง → ตัวจำลองการสแกน RFID
ทุกส่วน **ทดสอบผ่านจริงแล้ว** (end-to-end)

---

## ✅ สิ่งที่ทำไปแล้ว

### 1. ตั้งค่าสภาพแวดล้อม
- เพิ่ม `psql` เข้า user PATH (`C:\Program Files\PostgreSQL\17\bin`)
- ยืนยัน Node v24.18.0 / npm 11.16.0 / PostgreSQL 17.10

### 2. สร้างโปรเจกต์ `mcs-backend` (Express + PostgreSQL)
- โครงสร้างโฟลเดอร์มาตรฐาน (config / routes / controllers / services / models / middlewares / utils / scripts)
- ติดตั้ง dependencies: `express`, `pg`, `dotenv`, `cors`, `helmet`, `morgan`
- สร้าง connection pool + graceful shutdown
- Endpoint สุขภาพ: `GET /api/health`, `GET /api/health/db` → ทดสอบผ่าน
- สร้างฐานข้อมูล `mcs_backend` + ตั้งค่า `.env`

### 3. สร้าง RFID / Inventory Schema
**ไฟล์:** `src/scripts/001_create_rfid_schema.sql` (รันเข้า DB แล้ว)

5 ตาราง:
| ตาราง | หน้าที่ |
| --- | --- |
| `products` | สินค้า (consumable / serialized_equipment) |
| `rfid_tags` | RFID tag (EPC/TID, status, EAS, lot/exp) |
| `stock_levels` | ยอดคงเหลือต่อสินค้า |
| `stock_transactions` | ประวัติเคลื่อนไหวสต็อก (receive/pack/sell/return/adjust/count) |
| `packing_sessions` | รอบการแพ็ก/จัดส่ง |

**Trigger:** `trg_apply_stock_transaction` — อัปเดต `stock_levels` อัตโนมัติทุกครั้งที่ insert `stock_transactions`
→ ทดสอบแล้ว: รับ +50, ขาย −8 = คงเหลือ 42 ✅

### 4. ข้อมูลตัวอย่าง (Seed)
**ไฟล์:** `src/scripts/002_seed_data.sql` (รันเข้า DB แล้ว)
- 5 products: เมล็ดกาแฟคั่ว, ผงชาไทย, ไซรัปคาราเมล, ผงชาเขียว, ช็อคโกแลต
- 20 rfid_tags: `MCS-CB-001` → `MCS-CB-020` (กระจาย 4 tag/product)
- 20 stock_transactions (receive) → stock_levels = 4/product อัตโนมัติ
- Re-runnable (มี `ON CONFLICT` / `NOT EXISTS` guard)

### 5. RFID Scan API + Simulator
- **`POST /api/rfid/scan`** — สแกน `epc_codes[]` แล้วทำงานครบวงจร (ห่อใน DB transaction):
  1. สร้าง `stock_transactions` (`sell`, qty −1) ต่อ tag ที่ยัง `active` → trigger ปรับ `stock_levels`
  2. อัปเดต `rfid_tags.status='sold'`, `eas_active=false`
  3. เตือนใกล้หมดอายุ (`exp_date <= CURRENT_DATE + 30`)
  4. เตือนสต็อกต่ำ (`qty_available < qty_min_alert`)
  - กันขายซ้ำ: tag ที่ขายแล้วคืน `action: "skipped"` (ไม่ทำสต็อกติดลบ)
  - response: `{ matched, unknown, warnings: { expired_soon, low_stock } }` (+ `sold_count`)
  - `src/controllers/rfid.controller.js`, `src/routes/rfid.routes.js`
  - ทดสอบแล้ว: ขาย 2 tag → stock 4→2, low_stock alert, สแกนซ้ำ → skipped ✅
- **`src/scripts/rfid_simulator.js`** — จำลองเครื่องอ่าน RFID
  - โหลด EPC จากฐานข้อมูล → สุ่ม 1–5 ชิ้น → POST ทุก 3 วินาที → Ctrl+C หยุด
  - ทดสอบแล้ว: สแกน + จับคู่ product ถูกต้อง ✅

### 6. Products & Stock API
**ไฟล์:** `product.controller.js` / `stock.controller.js` + routes (ลงทะเบียนใน `routes/index.js`)
- **`GET /api/products`** — ดูสินค้าทั้งหมด (พร้อม `count`)
- **`POST /api/products`** — เพิ่มสินค้าใหม่ (validate `sku`/`name`/`product_type`; sku ซ้ำ → 409)
- **`GET /api/products/:id`** — ดูรายชิ้น (ไม่เจอ → 404, uuid ผิดรูป → 400)
- **`GET /api/stock`** — join ชื่อสินค้า, แสดง `qty_total`/`qty_available`, ธง `low_stock` + `low_stock_count`
- ทดสอบแล้วครบทุก endpoint + error case ✅

### 7. Packing API
**ไฟล์:** `packing.controller.js` + routes; migration `003_add_packing_expected.sql` (เพิ่ม `expected_epc_codes text[]`)
- **`POST /api/packing/start`** — สร้าง session (`pending`) เก็บ expected EPC → คืน `packing_id`
- **`POST /api/packing/verify`** — เทียบ scanned vs expected → คืน `{ verified, matched, missing, extra }`
  - ถ้า `verified` (ครบพอดี ไม่ขาดไม่เกิน): session → `packed` + `is_verified`, บันทึก `pack` txn (−1) + tags → `sold` + `eas_active=false` (atomic)
- **`POST /api/packing/ship`** — ยืนยันส่งออก: session `packed` → `shipped` (state ผิด → 409)
- **`GET /api/packing/:packing_id`** — ดูสถานะ session
- ทดสอบแล้ว: mismatch → ไม่ผ่าน, match → packed + stock ลด + tags sold + EAS ปิด ✅

### 8. Register Tag + E2E Flow
- **`POST /api/rfid/tags`** — ลงทะเบียน tag (`active`) + รับเข้าคลัง (`receive` +1) แบบ atomic; `receive:false` = ลงทะเบียนอย่างเดียว; epc ซ้ำ → 409
- **`src/scripts/e2e_demo.js`** (`npm run demo:e2e`) — เดิน flow เต็ม (register→receive→pack→verify→ship) + assert ทุกขั้น + cleanup อัตโนมัติ
- ทดสอบแล้ว: ผ่านครบทุก assert ✅

### 9. Git + GitHub
- `git init` → commit แรก `initial: RFID schema + products + stock + scan API`
- ยืนยัน `.env` / `node_modules` ไม่ถูก track (มีแค่ `.env.example`)
- push ขึ้น GitHub repo `mcs-backend` แล้ว ✅

---

## 📁 โครงสร้างไฟล์ปัจจุบัน

```
mcs-backend/
├── server.js                 # Entry point + graceful shutdown
├── package.json              # scripts: start / dev / db:test / rfid:sim
├── .env / .env.example       # config (.env อยู่ใน .gitignore)
├── README.md
├── SETUP_LOG.md              # บันทึกการติดตั้ง
├── PROGRESS.md               # ไฟล์นี้
└── src/
    ├── app.js                # Express app
    ├── config/
    │   ├── index.js          # อ่านค่าจาก env
    │   └── db.js             # PostgreSQL pool
    ├── routes/
    │   ├── index.js          # /health, /rfid, /products, /stock
    │   ├── health.routes.js
    │   ├── rfid.routes.js
    │   ├── product.routes.js
    │   └── stock.routes.js
    ├── controllers/
    │   ├── health.controller.js
    │   ├── rfid.controller.js
    │   ├── product.controller.js
    │   └── stock.controller.js
    ├── middlewares/
    │   ├── errorHandler.js
    │   └── notFound.js
    ├── services/             # (ว่าง — business logic)
    ├── models/               # (ว่าง — data access)
    ├── utils/                # (ว่าง — helpers)
    └── scripts/
        ├── testConnection.js
        ├── 001_create_rfid_schema.sql
        ├── 002_seed_data.sql
        ├── 003_add_packing_expected.sql
        ├── 004_fix_thai_names.sql
        ├── runSql.js              # node SQL runner (UTF-8 safe บน Windows)
        ├── rfid_simulator.js
        └── e2e_demo.js
```

---

## 🔌 API Endpoints

| Method | Path | คำอธิบาย |
| --- | --- | --- |
| GET | `/api/health` | เช็ค service |
| GET | `/api/health/db` | เช็คการเชื่อมต่อ DB |
| POST | `/api/rfid/scan` | สแกน EPC → ขาย + อัปเดต status + warnings |
| GET | `/api/products` | ดูสินค้าทั้งหมด |
| POST | `/api/products` | เพิ่มสินค้าใหม่ |
| GET | `/api/products/:id` | ดูสินค้ารายชิ้น |
| GET | `/api/stock` | ยอดคงเหลือ + แจ้งเตือนสต็อกต่ำ |
| POST | `/api/rfid/tags` | ลงทะเบียน tag ใหม่ + รับเข้าคลัง (stock +) |
| POST | `/api/packing/start` | สร้าง packing session (เก็บ expected EPC) |
| POST | `/api/packing/verify` | เทียบ scanned vs expected → packed + pack txn |
| POST | `/api/packing/ship` | ยืนยันส่งออก (packed → shipped) |
| GET | `/api/packing/:packing_id` | ดูสถานะ packing session |

---

## 🔄 End-to-End Flow (ทดสอบครบด้วย `npm run demo:e2e`)

```
ลงทะเบียน Tag → รับเข้าคลัง (stock +)     POST /api/rfid/tags
      ↓
เริ่ม Packing Session                      POST /api/packing/start
      ↓
สแกนของบนโต๊ะแพค → verify ครบไหม           POST /api/packing/verify
      ↓
ยืนยัน → Stock หัก + Tag = sold (EAS off)  (อยู่ใน /verify)
      ↓
พร้อมส่งออก → shipped                      POST /api/packing/ship
```

`src/scripts/e2e_demo.js` เดินไล่ทั้ง flow ผ่าน HTTP + assert ทุกขั้น แล้วล้างข้อมูล demo อัตโนมัติ (ใช้ `--keep` เพื่อเก็บไว้)

---

## ▶️ คำสั่งใช้งาน

```powershell
cd mcs-backend

npm run dev        # เปิดเซิร์ฟเวอร์ (auto-reload)
npm start          # production
npm run db:test    # ทดสอบการเชื่อมต่อ DB
npm run rfid:sim   # รันตัวจำลอง RFID (ต้องเปิดเซิร์ฟเวอร์ก่อน)
```

รัน SQL scripts (จากโฟลเดอร์ `src/scripts`):
```powershell
$env:PGPASSWORD = "admin123"; $env:PGCLIENTENCODING = "UTF8"
Get-Content 001_create_rfid_schema.sql -Raw -Encoding UTF8 | & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h localhost -d mcs_backend -v ON_ERROR_STOP=1
```

---

## 🎯 ขั้นถัดไปที่แนะนำ (ยังไม่ได้ทำ)

1. **Packing flow** — ใช้ตาราง `packing_sessions` (verify → pack → ship)
2. **`qty_reserved` logic** — ปัจจุบัน trigger/scan ยังไม่แตะยอดจอง
3. **CRUD ที่เหลือ** — `PUT/DELETE /api/products`, endpoint สำหรับ `stock_transactions`
4. **API docs / test** — ไฟล์ `.http` หรือ Swagger, unit/integration test
5. **CI/CD** — GitHub Actions รัน lint/test อัตโนมัติ

### ✅ ทำเสร็จแล้ว (จากรายการเดิม)
- ~~ทำให้การสแกนมีผลจริง~~ → scan สร้าง sell txn + อัปเดต status + warnings แล้ว
- ~~API สินค้า/สต็อก~~ → `/api/products`, `/api/stock` แล้ว
- ~~git init + push~~ → ขึ้น GitHub แล้ว

---

## ⚠️ หมายเหตุ
- **รหัสผ่าน DB** (`admin123`) เก็บใน `.env` — อยู่ใน `.gitignore` แล้ว ไม่ถูก commit
- ภาษาไทยใน Windows console อาจแสดงเป็น `???` — พิมพ์ `chcp 65001` ก่อน หรือดูจาก API response (เป็น UTF-8 ถูกต้อง)
- **SQL ที่มีภาษาไทย ต้องรันผ่าน `node src/scripts/runSql.js <file>`** ห้ามใช้ `Get-Content | psql` (PowerShell pipe แปลงไทยเป็น `?` ก่อนถึง Postgres → ข้อมูลเสียถาวร) — pg ใช้ UTF8 อยู่แล้ว, ปัญหาอยู่ที่ pipe ไม่ใช่ connection
- ต้นเหตุที่ชื่อสินค้าเคยเป็น `?`: seed รอบแรกส่งผ่าน pipe → แก้ด้วย `004_fix_thai_names.sql` (รันผ่าน node runner) แล้ว
