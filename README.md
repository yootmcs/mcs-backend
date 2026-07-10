# mcs-backend

MCS CRM backend API — **Node.js + Express + PostgreSQL**.

## Requirements

- Node.js >= 18 (tested on v24)
- PostgreSQL >= 13 (tested on v17)

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env      # then edit DB credentials

# 3. Test the database connection
npm run db:test

# 4. Run the server
npm run dev               # auto-reload (node --watch)
npm start                 # production
```

Server starts at `http://localhost:3000`.

## Health check endpoints

| Method | Path              | Description                     |
| ------ | ----------------- | ------------------------------- |
| GET    | `/api/health`     | Service liveness                |
| GET    | `/api/health/db`  | PostgreSQL connectivity check   |

## Project structure

```
mcs-backend/
├── server.js                 # Entry point: HTTP server + graceful shutdown
├── .env / .env.example       # Environment configuration
├── src/
│   ├── app.js                # Express app: middleware + route wiring
│   ├── config/
│   │   ├── index.js          # Env-driven config object
│   │   └── db.js             # PostgreSQL connection pool (pg)
│   ├── routes/               # Route definitions (URL → controller)
│   ├── controllers/          # Request handlers
│   ├── services/             # Business logic (kept out of controllers)
│   ├── models/               # DB queries / data access
│   ├── middlewares/          # Cross-cutting middleware (errors, auth, ...)
│   ├── utils/                # Shared helpers
│   └── scripts/              # One-off scripts (e.g. db:test)
```

## Adding a new resource

1. `src/models/customer.model.js` — SQL queries
2. `src/services/customer.service.js` — business logic
3. `src/controllers/customer.controller.js` — HTTP handlers
4. `src/routes/customer.routes.js` — route definitions
5. Register it in `src/routes/index.js`
