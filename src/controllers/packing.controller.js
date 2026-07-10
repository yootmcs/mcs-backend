const { pool, query } = require('../config/db');

// POST /api/packing/start
// body: { order_ref, expected_epc_codes: [...], staff_id? }
// → สร้าง packing_sessions ใหม่ (เก็บ expected ไว้เทียบตอน verify) → คืน packing_id
exports.start = async (req, res, next) => {
  try {
    const { order_ref, expected_epc_codes: expected, staff_id } = req.body;

    if (!Array.isArray(expected) || expected.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'expected_epc_codes must be a non-empty array',
      });
    }

    const { rows } = await query(
      `INSERT INTO packing_sessions (order_ref, status, expected_epc_codes, staff_id)
       VALUES ($1, 'pending', $2, $3)
       RETURNING packing_id, order_ref, status, is_verified, expected_epc_codes, created_at`,
      [order_ref || null, expected, staff_id || null]
    );

    res.status(201).json({ status: 'ok', data: rows[0] });
  } catch (err) {
    next(err);
  }
};

// POST /api/packing/verify
// body: { packing_id, scanned_epc_codes: [...] }
// → เทียบ scanned vs expected; ถ้าครบพอดี (verified) → packed + pack txn + tags sold
exports.verify = async (req, res, next) => {
  const { packing_id: packingId, scanned_epc_codes: scannedCodes } = req.body;

  if (!packingId || !Array.isArray(scannedCodes)) {
    return res.status(400).json({
      status: 'error',
      message: 'packing_id and scanned_epc_codes[] are required',
    });
  }

  const client = await pool.connect();
  try {
    const { rows: sessions } = await client.query(
      `SELECT packing_id, order_ref, status, is_verified, staff_id, expected_epc_codes
         FROM packing_sessions
        WHERE packing_id = $1`,
      [packingId]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Packing session not found' });
    }
    const session = sessions[0];

    // เทียบรายการ (ใช้ Set กันซ้ำ)
    const expected = new Set(session.expected_epc_codes);
    const scanned = new Set(scannedCodes);

    const matched = [...scanned].filter((c) => expected.has(c));
    const missing = [...expected].filter((c) => !scanned.has(c));
    const extra = [...scanned].filter((c) => !expected.has(c));

    // verified = สแกนได้ครบ expected และไม่มีของเกิน
    const verified = missing.length === 0 && extra.length === 0;

    if (verified) {
      await client.query('BEGIN');

      await client.query(
        `UPDATE packing_sessions
            SET status = 'packed', is_verified = true, packed_at = now()
          WHERE packing_id = $1`,
        [packingId]
      );

      // บันทึก pack txn + set sold เฉพาะ tag ที่ยัง active (กันหักสต็อกซ้ำ)
      const { rows: tags } = await client.query(
        `SELECT tag_id, product_id
           FROM rfid_tags
          WHERE epc_code = ANY($1)
            AND status = 'active'
            AND product_id IS NOT NULL`,
        [matched]
      );

      for (const t of tags) {
        await client.query(
          `INSERT INTO stock_transactions
               (product_id, tag_id, txn_type, qty_change, note, staff_id)
           VALUES ($1, $2, 'pack', -1, $3, $4)`,
          [t.product_id, t.tag_id, `Packing verified (order ${session.order_ref || 'n/a'})`, session.staff_id || null]
        );
        await client.query(
          `UPDATE rfid_tags SET status = 'sold', eas_active = false WHERE tag_id = $1`,
          [t.tag_id]
        );
      }

      await client.query('COMMIT');
    }

    res.json({
      status: 'ok',
      packing_id: packingId,
      verified,
      matched,
      missing,
      extra,
      session_status: verified ? 'packed' : session.status,
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    if (err.code === '22P02') {
      return res.status(400).json({ status: 'error', message: 'Invalid packing_id format' });
    }
    next(err);
  } finally {
    client.release();
  }
};

// POST /api/packing/ship
// body: { packing_id }
// → เปลี่ยน session ที่ verified & packed แล้ว → 'shipped' (พร้อมส่งออก)
exports.ship = async (req, res, next) => {
  try {
    const { packing_id: packingId } = req.body;
    if (!packingId) {
      return res.status(400).json({ status: 'error', message: 'packing_id is required' });
    }

    const { rows } = await query(
      `UPDATE packing_sessions
          SET status = 'shipped'
        WHERE packing_id = $1 AND status = 'packed' AND is_verified = true
        RETURNING packing_id, order_ref, status, is_verified, packed_at`,
      [packingId]
    );

    if (rows.length === 0) {
      const { rows: existing } = await query(
        'SELECT status FROM packing_sessions WHERE packing_id = $1',
        [packingId]
      );
      if (existing.length === 0) {
        return res.status(404).json({ status: 'error', message: 'Packing session not found' });
      }
      return res.status(409).json({
        status: 'error',
        message: `cannot ship: session must be verified & packed (current status=${existing[0].status})`,
      });
    }

    res.json({ status: 'ok', data: rows[0] });
  } catch (err) {
    if (err.code === '22P02') {
      return res.status(400).json({ status: 'error', message: 'Invalid packing_id format' });
    }
    next(err);
  }
};

// GET /api/packing/:packing_id — ดูสถานะ packing session
exports.getById = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT packing_id, order_ref, status, is_verified,
              expected_epc_codes, staff_id, packed_at, created_at
         FROM packing_sessions
        WHERE packing_id = $1`,
      [req.params.packing_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Packing session not found' });
    }
    res.json({ status: 'ok', data: rows[0] });
  } catch (err) {
    if (err.code === '22P02') {
      return res.status(400).json({ status: 'error', message: 'Invalid packing_id format' });
    }
    next(err);
  }
};
