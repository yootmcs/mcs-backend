const { query } = require('../config/db');

// GET /api/stock — ยอดคงเหลือทุกสินค้า พร้อมชื่อสินค้า + ธงแจ้งเตือนสต็อกต่ำ
exports.list = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.product_id,
              p.sku,
              p.name AS product_name,
              s.qty_total,
              s.qty_available,
              s.qty_reserved,
              s.qty_min_alert,
              (s.qty_available < s.qty_min_alert) AS low_stock,
              s.updated_at
         FROM stock_levels s
         JOIN products p USING (product_id)
        ORDER BY p.sku`
    );

    const lowStockCount = rows.filter((r) => r.low_stock).length;

    res.json({
      status: 'ok',
      count: rows.length,
      low_stock_count: lowStockCount,
      data: rows,
    });
  } catch (err) {
    next(err);
  }
};
