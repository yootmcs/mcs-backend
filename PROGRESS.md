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
- **`POST /api/rfid/scan`** — รับ `epc_codes[]` แล้วค้นหา tag/product (แยก matched / unknown)
  - `src/controllers/rfid.controller.js`, `src/routes/rfid.routes.js`
- **`src/scripts/rfid_simulator.js`** — จำลองเครื่องอ่าน RFID
  - โหลด EPC จากฐานข้อมูล → สุ่ม 1–5 ชิ้น → POST ทุก 3 วินาที → Ctrl+C หยุด
  - ทดสอบแล้ว: สแกน + จับคู่ product ถูกต้อง ✅

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
    │   ├── index.js          # /health, /rfid
    │   ├── health.routes.js
    │   └── rfid.routes.js
    ├── controllers/
    │   ├── health.controller.js
    │   └── rfid.controller.js
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
        └── rfid_simulator.js
```

---

## 🔌 API Endpoints

| Method | Path | คำอธิบาย |
| --- | --- | --- |
| GET | `/api/health` | เช็ค service |
| GET | `/api/health/db` | เช็คการเชื่อมต่อ DB |
| POST | `/api/rfid/scan` | ค้นหา EPC → tag/product |

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

1. **ทำให้การสแกนมีผลจริง** — `/api/rfid/scan` ตอนนี้เป็นแค่ read-only lookup
   - สแกนแล้วสร้าง `stock_transactions` (ขาย/นับสต็อก)
   - เปลี่ยน `rfid_tags.status` → `sold`
   - เช็ค EAS / แจ้งเตือนสินค้าใกล้หมดอายุ
2. **API สินค้า/สต็อก** — `/api/products`, `/api/stock` (CRUD)
3. **Packing flow** — ใช้ตาราง `packing_sessions`
4. **`qty_reserved` logic** — ปัจจุบัน trigger ยังไม่แตะยอดจอง
5. **git init** — โฟลเดอร์ยังไม่ใช่ git repo

---

## ⚠️ หมายเหตุ
- **รหัสผ่าน DB** (`admin123`) เก็บใน `.env` — อยู่ใน `.gitignore` แล้ว ไม่ถูก commit
- ภาษาไทยใน Windows console อาจแสดงเป็น `???` — พิมพ์ `chcp 65001` ก่อน หรือดูจาก API response (เป็น UTF-8 ถูกต้อง)
- โฟลเดอร์โปรเจกต์มีอักขระไทยในพาธ → เวลารัน `psql -f` ตรงๆ จะ error ให้ pipe ผ่าน stdin แทน
