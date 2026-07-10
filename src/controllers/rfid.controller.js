const { pool } = require('../config/db');

// POST /api/rfid/tags
// body: { epc_code, sku | product_id, tag_type?, lot_number?, mfd_date?, exp_date?, staff_id?, receive? }
// → ลงทะเบียน tag ใหม่ (status='active') และรับเข้าคลัง (receive, stock +1) แบบ atomic
//   receive=false เพื่อลงทะเบียนอย่างเดียวโดยไม่รับเข้าสต็อก
exports.registerTag = async (req, res, next) => {
  const {
    epc_code: epcCode,
    sku,
    product_id: productIdInput,
    tag_type: tagType,
    lot_number: lotNumber,
    mfd_date: mfdDate,
    exp_date: expDate,
    staff_id: staffId,
    receive,
  } = req.body;

  if (!epcCode) {
    return res.status(400).json({ status: 'error', message: 'epc_code is required' });
  }
  if (!sku && !productIdInput) {
    return res.status(400).json({ status: 'error', message: 'sku or product_id is required' });
  }
  const doReceive = receive !== false; // default true

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // หา product_id จาก sku ถ้าไม่ได้ส่ง product_id มา
    let productId = productIdInput;
    if (!productId) {
      const { rows } = await client.query('SELECT product_id FROM products WHERE sku = $1', [sku]);
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ status: 'error', message: `product not found: sku=${sku}` });
      }
      productId = rows[0].product_id;
    }

    const { rows: tagRows } = await client.query(
      `INSERT INTO rfid_tags
           (epc_code, product_id, tag_type, status, lot_number, mfd_date, exp_date, printed_at)
       VALUES ($1, $2, COALESCE($3, 'label'), 'active', $4, $5, $6, now())
       RETURNING tag_id, epc_code, product_id, tag_type, status, eas_active,
                 lot_number, mfd_date, exp_date, printed_at, created_at`,
      [epcCode, productId, tagType || null, lotNumber || null, mfdDate || null, expDate || null]
    );
    const tag = tagRows[0];

    if (doReceive) {
      await client.query(
        `INSERT INTO stock_transactions
             (product_id, tag_id, txn_type, qty_change, note, staff_id)
         VALUES ($1, $2, 'receive', 1, 'Tag registered + received', $3)`,
        [productId, tag.tag_id, staffId || null]
      );
    }

    await client.query('COMMIT');

    let stock = null;
    if (doReceive) {
      const { rows } = await client.query(
        'SELECT qty_total, qty_available FROM stock_levels WHERE product_id = $1',
        [productId]
      );
      stock = rows[0] || null;
    }

    res.status(201).json({ status: 'ok', data: { tag, received: doReceive, stock } });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    if (err.code === '23505') {
      return res.status(409).json({ status: 'error', message: `epc_code already exists: ${epcCode}` });
    }
    if (err.code === '23514') {
      return res.status(400).json({ status: 'error', message: 'invalid field value (check tag_type)' });
    }
    if (err.code === '22P02') {
      return res.status(400).json({ status: 'error', message: 'invalid uuid/date format' });
    }
    next(err);
  } finally {
    client.release();
  }
};

// POST /api/rfid/scan
// Body: { epc_codes: string[], reader_id?: string, staff_id?: string }
//
// เมื่อสแกน EPC:
//   1. สร้าง stock_transactions (sell, qty_change=-1) สำหรับทุก tag ที่ "ยังขายได้" (status='active')
//   2. อัปเดต rfid_tags -> status='sold', eas_active=false
//   3. เตือนสินค้าใกล้หมดอายุ (ภายใน 30 วัน)
//   4. เตือนสต็อกต่ำ (qty_available < qty_min_alert)
//
// หมายเหตุ: tag ที่ status ไม่ใช่ 'active' อยู่แล้ว จะไม่ถูกขายซ้ำ (กันสต็อกติดลบ)
//           แต่ยังคืนใน matched พร้อม action: 'skipped'
exports.scan = async (req, res, next) => {
  const { epc_codes: epcCodes, reader_id: readerId, staff_id: staffId } = req.body;

  if (!Array.isArray(epcCodes) || epcCodes.length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'epc_codes must be a non-empty array',
    });
  }

  const client = await pool.connect();
  try {
    // 1) ค้นหา tag ที่สแกนเจอ + ข้อมูลสินค้า + ธงใกล้หมดอายุ (ภายใน 30 วัน)
    const { rows: tags } = await client.query(
      `SELECT t.tag_id,
              t.epc_code,
              t.status,
              t.tag_type,
              t.eas_active,
              t.exp_date,
              (t.exp_date IS NOT NULL AND t.exp_date <= CURRENT_DATE + 30) AS expiring_soon,
              p.product_id,
              p.sku,
              p.name AS product_name
         FROM rfid_tags t
         LEFT JOIN products p ON p.product_id = t.product_id
        WHERE t.epc_code = ANY($1)`,
      [epcCodes]
    );

    const matchedCodes = new Set(tags.map((t) => t.epc_code));
    const unknown = epcCodes.filter((c) => !matchedCodes.has(c));

    // ขายได้เฉพาะ tag ที่ยัง active และผูกกับสินค้า
    const sellable = tags.filter((t) => t.status === 'active' && t.product_id);
    const soldTagIds = new Set(sellable.map((t) => t.tag_id));

    // 2) ขาย + อัปเดต status แบบ atomic (trigger จะปรับ stock_levels ให้เอง)
    await client.query('BEGIN');
    for (const t of sellable) {
      await client.query(
        `INSERT INTO stock_transactions
             (product_id, tag_id, txn_type, qty_change, note, staff_id)
         VALUES ($1, $2, 'sell', -1, $3, $4)`,
        [t.product_id, t.tag_id, `RFID scan sell (reader ${readerId || 'n/a'})`, staffId || readerId || null]
      );
      await client.query(
        `UPDATE rfid_tags
            SET status = 'sold', eas_active = false
          WHERE tag_id = $1`,
        [t.tag_id]
      );
    }
    await client.query('COMMIT');

    // 3) เตือนใกล้หมดอายุ (คำนวณจาก snapshot ก่อนขาย ซึ่งไม่กระทบ exp_date)
    const expiredSoon = tags
      .filter((t) => t.expiring_soon)
      .map((t) => ({
        epc_code: t.epc_code,
        sku: t.sku,
        product_name: t.product_name,
        exp_date: t.exp_date,
      }));

    // 4) เตือนสต็อกต่ำ — เช็คสินค้าที่เกี่ยวข้องกับการสแกนครั้งนี้
    const productIds = [...new Set(tags.map((t) => t.product_id).filter(Boolean))];
    let lowStock = [];
    if (productIds.length) {
      const { rows } = await client.query(
        `SELECT p.sku,
                p.name AS product_name,
                s.qty_available,
                s.qty_min_alert
           FROM stock_levels s
           JOIN products p USING (product_id)
          WHERE s.product_id = ANY($1)
            AND s.qty_available < s.qty_min_alert`,
        [productIds]
      );
      lowStock = rows;
    }

    // ประกอบ matched (สะท้อนสถานะหลังขาย)
    const matched = tags.map((t) => {
      const sold = soldTagIds.has(t.tag_id);
      return {
        epc_code: t.epc_code,
        sku: t.sku,
        product_name: t.product_name,
        status: sold ? 'sold' : t.status,
        eas_active: sold ? false : t.eas_active,
        action: sold ? 'sold' : 'skipped',
        exp_date: t.exp_date,
      };
    });

    res.json({
      status: 'ok',
      reader_id: readerId || null,
      scanned: epcCodes.length,
      sold_count: sellable.length,
      matched,
      unknown,
      warnings: {
        expired_soon: expiredSoon,
        low_stock: lowStock,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // กลับรายการถ้ายังค้างอยู่กลาง transaction
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore rollback error */
    }
    next(err);
  } finally {
    client.release();
  }
};
