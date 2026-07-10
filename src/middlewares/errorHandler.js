const config = require('../config');

// Centralized error handler. Express recognizes it by its 4 arguments.
// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;

  if (config.env !== 'test') {
    console.error(err);
  }

  res.status(status).json({
    status: 'error',
    message: err.message || 'Internal Server Error',
    ...(config.env === 'development' && { stack: err.stack }),
  });
};
