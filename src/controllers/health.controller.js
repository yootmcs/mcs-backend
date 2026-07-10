const { query } = require('../config/db');

// Basic liveness check.
exports.check = (req, res) => {
  res.json({
    status: 'ok',
    service: 'mcs-backend',
    timestamp: new Date().toISOString(),
  });
};

// Verifies the app can actually reach PostgreSQL.
exports.checkDb = async (req, res, next) => {
  try {
    const result = await query('SELECT NOW() AS now, version() AS version');
    res.json({
      status: 'ok',
      db: 'connected',
      now: result.rows[0].now,
      version: result.rows[0].version,
    });
  } catch (err) {
    next(err);
  }
};
