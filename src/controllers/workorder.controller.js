const service = require('../services/workorder.service');
const handleDbError = require('../utils/handleDbError');

const bad = (res, message) => res.status(400).json({ status: 'error', message });

// POST /api/work-orders
exports.create = async (req, res, next) => {
  try {
    const { work_no, roast_bom_id, pack_bom_id, green_lot_id, planned_roast_qty, planned_pack_qty } = req.body;
    if (!work_no || !roast_bom_id || !pack_bom_id) {
      return bad(res, 'work_no, roast_bom_id, pack_bom_id are required');
    }
    if (!green_lot_id) return bad(res, 'green_lot_id is required (เลือกล็อตเมล็ดที่จะคั่ว)');
    if (planned_roast_qty == null || Number(planned_roast_qty) <= 0) return bad(res, 'planned_roast_qty must be > 0');
    if (planned_pack_qty == null || Number(planned_pack_qty) <= 0) return bad(res, 'planned_pack_qty must be > 0');
    const data = await service.createOrder(req.body);
    res.status(201).json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

// GET /api/work-orders
exports.list = async (req, res, next) => {
  try {
    const data = await service.listOrders();
    res.json({ status: 'ok', count: data.length, data });
  } catch (err) { handleDbError(err, res, next); }
};

// GET /api/work-orders/finished-lots?product_id= — ล็อตถุงสำเร็จ + สายเลือดตามรอย
exports.finishedLots = async (req, res, next) => {
  try {
    const data = await service.listFinishedLots(req.query.product_id || null);
    res.json({ status: 'ok', count: data.length, data });
  } catch (err) { handleDbError(err, res, next); }
};

// GET /api/work-orders/:id
exports.getById = async (req, res, next) => {
  try {
    const data = await service.getOrder(req.params.id);
    if (!data) return res.status(404).json({ status: 'error', message: 'work order not found' });
    res.json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

// POST /api/work-orders/:id/start
exports.start = async (req, res, next) => {
  try {
    const data = await service.startOrder(req.params.id);
    res.json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

// POST /api/work-orders/:id/complete
exports.complete = async (req, res, next) => {
  try {
    if (req.body.roast_produced == null) return bad(res, 'roast_produced is required');
    if (req.body.pack_produced == null) return bad(res, 'pack_produced is required');
    const data = await service.completeOrder(req.params.id, req.body);
    res.json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

// POST /api/work-orders/:id/cancel
exports.cancel = async (req, res, next) => {
  try {
    const data = await service.cancelOrder(req.params.id);
    res.json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};
