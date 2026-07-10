require('dotenv').config();

const app = require('./src/app');
const config = require('./src/config');
const { pool } = require('./src/config/db');

// listen บน 0.0.0.0 เพื่อให้เครื่องอื่นใน LAN เข้าถึงได้ (ไม่ใช่แค่ localhost)
const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(config.port, HOST, () => {
  console.log(`🚀 mcs-backend running on http://${HOST}:${config.port} [${config.env}] — LAN accessible`);
});

// Graceful shutdown: close HTTP server, then drain the DB pool.
const shutdown = async (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    await pool.end();
    console.log('HTTP server closed and DB pool drained.');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
