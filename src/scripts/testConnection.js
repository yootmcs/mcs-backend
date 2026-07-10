// Standalone script to verify the PostgreSQL connection.
// Usage: npm run db:test
require('dotenv').config();

const { pool } = require('../config/db');
const config = require('../config');

(async () => {
  console.log(`Connecting to ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database} ...`);
  try {
    const { rows } = await pool.query('SELECT NOW() AS now, version() AS version');
    console.log('✅ Connected successfully.');
    console.log('   Server time:', rows[0].now);
    console.log('   Version:', rows[0].version);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
