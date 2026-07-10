const service = require('../services/bom.service');
const handleDbError = require('../utils/handleDbError');

// POST /api/production/orders
exports.createOrder = async (req, res, next) => {
  try {
    const { order_no, bom_id, planned_qty } = req.body;
    if (!order_no || !bom_id || planned_qty == null) {
      return res.status(400).json({ status: 'error', message: 'order_no, bom_id, planned_qty are required' });
    }
    if (Number(planned_qty) <= 0) {
      return res.status(400).json({ status: 'error', message: 'planned_qty must be > 0' });
    }
    const data = await service.createOrder(req.body);
    res.status(201).json({ status: 'ok', data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

// GET /api/production/orders
exports.listOrders = async (req, res, next) => {
  try {
    const data = await service.listOrders();
    res.json({ status: 'ok', count: data.length, data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

// GET /api/production/orders/:id
exports.getOrder = async (req, res, next) => {
  try {
    const data = await service.getOrder(req.params.id);
    if (!data) return res.status(404).json({ status: 'error', message: 'production order not found' });
    res.json({ status: 'ok', data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

// POST /api/production/orders/:id/start
exports.start = async (req, res, next) => {
  try {
    const data = await service.startOrder(req.params.id);
    res.json({ status: 'ok', data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

// POST /api/production/orders/:id/complete
exports.complete = async (req, res, next) => {
  try {
    if (req.body.qty_produced == null) {
      return res.status(400).json({ status: 'error', message: 'qty_produced is required' });
    }
    const data = await service.completeOrder(req.params.id, req.body);
    res.json({ status: 'ok', data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};
