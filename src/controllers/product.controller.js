const { query } = require('../config/db');

const PRODUCT_TYPES = ['consumable', 'serialized_equipment'];

// GET /api/products — ดูสินค้าทั้งหมด
exports.list = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT product_id, sku, name, product_type, price,
              packaging_type, is_active, created_at
         FROM products
        ORDER BY created_at DESC, sku`
    );
    res.json({ status: 'ok', count: rows.length, data: rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/products/:id — ดูสินค้ารายชิ้น
exports.getById = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT product_id, sku, name, product_type, price,
              packaging_type, is_active, created_at
         FROM products
        WHERE product_id = $1`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }
    res.json({ status: 'ok', data: rows[0] });
  } catch (err) {
    // uuid ผิดรูปแบบ -> 400 แทน 500
    if (err.code === '22P02') {
      return res.status(400).json({ status: 'error', message: 'Invalid product id format' });
    }
    next(err);
  }
};

// POST /api/products — เพิ่มสินค้าใหม่
exports.create = async (req, res, next) => {
  try {
    const { sku, name, product_type, price, packaging_type, is_active } = req.body;

    if (!sku || !name) {
      return res.status(400).json({ status: 'error', message: 'sku and name are required' });
    }
    if (product_type && !PRODUCT_TYPES.includes(product_type)) {
      return res.status(400).json({
        status: 'error',
        message: `product_type must be one of: ${PRODUCT_TYPES.join(', ')}`,
      });
    }

    const { rows } = await query(
      `INSERT INTO products (sku, name, product_type, price, packaging_type, is_active)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, true))
       RETURNING product_id, sku, name, product_type, price,
                 packaging_type, is_active, created_at`,
      [sku, name, product_type || null, price ?? null, packaging_type || null, is_active]
    );

    res.status(201).json({ status: 'ok', data: rows[0] });
  } catch (err) {
    // sku ซ้ำ (unique_violation) -> 409
    if (err.code === '23505') {
      return res.status(409).json({ status: 'error', message: `sku already exists: ${req.body.sku}` });
    }
    next(err);
  }
};
