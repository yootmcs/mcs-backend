# mcs-backend — บันทึกการติดตั้ง (Setup Log)

> โปรเจกต์ Web App Backend สำหรับ MCS CRM
> **Stack:** Node.js + Express + PostgreSQL
> วันที่ตั้งค่า: 2026-07-10

---

## สภาพแวดล้อม (Environment)

| รายการ | เวอร์ชัน |
| --- | --- |
| Node.js | v24.18.0 |
| npm | 11.16.0 |
| PostgreSQL | 17.10 (service: `postgresql-x64-17`) |
| OS | Windows 11 Enterprise |

> หมายเหตุ: `psql` ถูกเพิ่มเข้า **user PATH** แล้ว (`C:\Program Files\PostgreSQL\17\bin`)

---

## สรุปสิ่งที่ทำ (Checklist)

| ขั้นตอน | สถานะ |
| --- | --- |
| สร้างโครงสร้างโปรเจกต์ Express + PostgreSQL | ✅ |
| ติดตั้ง dependencies (90 packages, 0 vulnerabilities) | ✅ |
| เซิร์ฟเวอร์บูต + `/api/health` ตอบ 200 | ✅ |
| ตั้งรหัสผ่าน `.env` + สร้าง DB `mcs_backend` | ✅ |
| เชื่อมต่อ PostgreSQL 17.10 ผ่าน `/api/health/db` | ✅ |

---

## โครงสร้างโฟลเดอร์ (Project Structure)

```
mcs-backend/
├── server.js              # Entry point + graceful shutdown
├── .env / .env.example    # ค่า config (.env อยู่ใน .gitignore แล้ว)
├── package.json
├── README.md
├── SETUP_LOG.md           # ไฟล์นี้
└── src/
    ├── app.js             # Express app (helmet, cors, morgan, routes)
    ├── config/
    │   ├── index.js       # อ่านค่าจาก env
    │   └── db.js          # PostgreSQL connection pool (pg)
    ├── routes/            # health.routes.js + index.js
    ├── controllers/       # health.controller.js
    ├── services/          # (business logic — ว่างไว้)
    ├── models/            # (data access — ว่างไว้)
    ├── middlewares/       # errorHandler.js, notFound.js
    ├── utils/             # (helper — ว่างไว้)
    └── scripts/           # testConnection.js
```

---

## ค่า Config ฐานข้อมูล (`.env`)

```env
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=mcs_backend
DB_USER=postgres
DB_PASSWORD=admin123      # ⚠️ อยู่ใน .gitignore — ไม่ถูก commit
DB_POOL_MAX=10
```

---

## คำสั่งใช้งาน (Commands)

```powershell
cd mcs-backend

npm install        # ติดตั้ง dependencies
npm run db:test    # ทดสอบการเชื่อมต่อฐานข้อมูล
npm run dev        # รันแบบ auto-reload (node --watch)
npm start          # รันแบบ production
```

เซิร์ฟเวอร์รันที่: `http://localhost:3000`

---

## Endpoints ที่มีตอนนี้

| Method | Path | คำอธิบาย |
| --- | --- | --- |
| GET | `/api/health` | เช็คว่า service ทำงาน (liveness) |
| GET | `/api/health/db` | เช็คการเชื่อมต่อฐานข้อมูล |

ผลทดสอบล่าสุด:

```json
// GET /api/health
{ "status": "ok", "service": "mcs-backend", "timestamp": "2026-07-10T06:37:34Z" }

// GET /api/health/db
{ "status": "ok", "db": "connected", "version": "PostgreSQL 17.10 ..." }
```

---

## ขั้นถัดไปที่แนะนำ (Next Steps)

1. **สร้าง migration/schema** จาก `DB_Schema.pdf` ที่มีอยู่ (customers, orders ฯลฯ)
2. **ทำ CRUD resource แรก** (เช่น `/api/customers`) ตามแพตเทิร์น model → service → controller → route
3. **เพิ่ม git** (`git init`) — ปัจจุบันโฟลเดอร์ยังไม่ใช่ git repo

### วิธีเพิ่ม resource ใหม่
1. `src/models/<name>.model.js` — SQL queries
2. `src/services/<name>.service.js` — business logic
3. `src/controllers/<name>.controller.js` — HTTP handlers
4. `src/routes/<name>.routes.js` — route definitions
5. ลงทะเบียนใน `src/routes/index.js`
