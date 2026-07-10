require('dotenv').config();

const app = require('./src/app');
const config = require('./src/config');
const { pool } = require('./src/config/db');

const server = app.listen(config.port, () => {
  console.log(`🚀 mcs-backend running on http://localhost:${config.port} [${config.env}]`);
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
