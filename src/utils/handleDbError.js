// แปลง error (ทั้ง httpErr ที่มี statusCode และ pg error code) เป็น HTTP response
module.exports = function handleDbError(err, res, next) {
  if (err.statusCode) {
    return res.status(err.statusCode).json({ status: 'error', message: err.message, ...(err.data || {}) });
  }
  if (err.code === '23505') return res.status(409).json({ status: 'error', message: err.detail || 'duplicate key' });
  if (err.code === '23514') return res.status(400).json({ status: 'error', message: err.message }); // check_violation
  if (err.code === '23503') return res.status(400).json({ status: 'error', message: 'invalid reference (foreign key)' });
  if (err.code === '22P02') return res.status(400).json({ status: 'error', message: 'invalid uuid/number format' });
  return next(err);
};
