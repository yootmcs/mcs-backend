const { Pool } = require('pg');
const config = require('./index');

// Single shared connection pool for the whole app.
const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: config.db.max,
  idleTimeoutMillis: config.db.idleTimeoutMillis,
  connectionTimeoutMillis: config.db.connectionTimeoutMillis,
  client_encoding: 'UTF8',
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
  process.exit(-1);
});

// Thin helper so callers don't need to touch the pool directly.
const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
