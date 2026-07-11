const service = require('../services/roastery.service');
const handleDbError = require('../utils/handleDbError');

const PROCESS_METHODS = ['washed', 'natural', 'honey', 'other'];
const ROAST_LEVELS = ['light', 'medium-light', 'medium', 'medium-dark', 'dark'];
const CURRENCIES = ['THB', 'USD', 'EUR', 'JPY'];
const ORDER_STATUS = ['pending', 'packing', 'shipped'];

const bad = (res, message) => res.status(400).json({ status: 'error', message });

// ============ Suppliers ============
exports.listSuppliers = async (req, res, next) => {
  try {
    const data = await service.listSuppliers();
    res.json({ status: 'ok', count: data.length, data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.createSupplier = async (req, res, next) => {
  try {
    if (!req.body.name) return bad(res, 'name is required');
    const data = await service.createSupplier(req.body);
    res.status(201).json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.updateSupplier = async (req, res, next) => {
  try {
    const data = await service.updateSupplier(req.params.id, req.body);
    res.json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

// ============ Green coffee lots (รับวัตถุดิบ) ============
exports.listGreenLots = async (req, res, next) => {
  try {
    const data = await service.listGreenLots();
    res.json({ status: 'ok', count: data.length, data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.getGreenLot = async (req, res, next) => {
  try {
    const data = await service.getGreenLot(req.params.id);
    if (!data) return res.status(404).json({ status: 'error', message: 'green lot not found' });
    res.json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.createGreenLot = async (req, res, next) => {
  try {
    const { origin, weight_kg, process_method } = req.body;
    if (!origin) return bad(res, 'origin is required');
    if (weight_kg == null || Number(weight_kg) <= 0) return bad(res, 'weight_kg must be > 0');
    if (process_method && !PROCESS_METHODS.includes(process_method)) {
      return bad(res, `process_method must be one of: ${PROCESS_METHODS.join(', ')}`);
    }
    const data = await service.createGreenLot(req.body);
    res.status(201).json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.updateGreenLot = async (req, res, next) => {
  try {
    const { process_method } = req.body;
    if (process_method && !PROCESS_METHODS.includes(process_method)) {
      return bad(res, `process_method must be one of: ${PROCESS_METHODS.join(', ')}`);
    }
    const data = await service.updateGreenLot(req.params.id, req.body);
    res.json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.deleteGreenLot = async (req, res, next) => {
  try {
    await service.deleteGreenLot(req.params.id);
    res.json({ status: 'ok' });
  } catch (err) { handleDbError(err, res, next); }
};

// ============ Roasting (คั่ว) ============
exports.listRoastBatches = async (req, res, next) => {
  try {
    const data = await service.listRoastBatches();
    res.json({ status: 'ok', count: data.length, data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.getRoastBatch = async (req, res, next) => {
  try {
    const data = await service.getRoastBatch(req.params.id);
    if (!data) return res.status(404).json({ status: 'error', message: 'roast batch not found' });
    res.json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.createRoastBatch = async (req, res, next) => {
  try {
    const { lot_id, green_weight_in, roasted_weight_out, roast_level } = req.body;
    if (!lot_id) return bad(res, 'lot_id is required');
    if (green_weight_in == null || Number(green_weight_in) <= 0) return bad(res, 'green_weight_in must be > 0');
    if (roasted_weight_out == null || Number(roasted_weight_out) <= 0) return bad(res, 'roasted_weight_out must be > 0');
    if (Number(roasted_weight_out) > Number(green_weight_in)) {
      return bad(res, 'roasted_weight_out ต้องไม่เกิน green_weight_in');
    }
    if (roast_level && !ROAST_LEVELS.includes(roast_level)) {
      return bad(res, `roast_level must be one of: ${ROAST_LEVELS.join(', ')}`);
    }
    const data = await service.createRoastBatch(req.body);
    res.status(201).json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.deleteRoastBatch = async (req, res, next) => {
  try {
    await service.deleteRoastBatch(req.params.id);
    res.json({ status: 'ok' });
  } catch (err) { handleDbError(err, res, next); }
};

// ============ Packaging (บรรจุภัณฑ์) ============
exports.listPackaging = async (req, res, next) => {
  try {
    const data = await service.listPackaging();
    res.json({ status: 'ok', count: data.length, data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.createPackaging = async (req, res, next) => {
  try {
    if (!req.body.name) return bad(res, 'name is required');
    if (req.body.quantity == null) return bad(res, 'quantity is required');
    const data = await service.createPackaging(req.body);
    res.status(201).json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.updatePackaging = async (req, res, next) => {
  try {
    // ปรับจำนวนแบบเพิ่ม/ลด (+1, -1) ถ้าส่ง delta มา; ไม่งั้นแก้ไขฟิลด์ปกติ
    if (req.body.delta != null) {
      const data = await service.adjustPackaging(req.params.id, Number(req.body.delta));
      return res.json({ status: 'ok', data });
    }
    const data = await service.updatePackaging(req.params.id, req.body);
    res.json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.deletePackaging = async (req, res, next) => {
  try {
    await service.deletePackaging(req.params.id);
    res.json({ status: 'ok' });
  } catch (err) { handleDbError(err, res, next); }
};

// ============ Sales orders (คำสั่งซื้อ/ส่งออก) ============
exports.listSalesOrders = async (req, res, next) => {
  try {
    const data = await service.listSalesOrders();
    res.json({ status: 'ok', count: data.length, data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.getSalesOrder = async (req, res, next) => {
  try {
    const data = await service.getSalesOrder(req.params.id);
    if (!data) return res.status(404).json({ status: 'error', message: 'sales order not found' });
    res.json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.createSalesOrder = async (req, res, next) => {
  try {
    const { customer, currency, status } = req.body;
    // รองรับทั้งแบบล็อตเดียว (batch_id + quantity_kg) และหลายล็อต (allocations[])
    let { allocations } = req.body;
    if (!allocations && req.body.batch_id) {
      allocations = [{ batch_id: req.body.batch_id, qty_kg: req.body.quantity_kg }];
    }
    if (!customer) return bad(res, 'customer is required');
    if (!Array.isArray(allocations) || allocations.length === 0) {
      return bad(res, 'ต้องระบุ allocations (หรือ batch_id + quantity_kg) อย่างน้อย 1 รายการ');
    }
    if (allocations.some((a) => !a.batch_id || a.qty_kg == null || Number(a.qty_kg) <= 0)) {
      return bad(res, 'แต่ละ allocation ต้องมี batch_id และ qty_kg > 0');
    }
    if (currency && !CURRENCIES.includes(currency)) {
      return bad(res, `currency must be one of: ${CURRENCIES.join(', ')}`);
    }
    if (status && !ORDER_STATUS.includes(status)) {
      return bad(res, `status must be one of: ${ORDER_STATUS.join(', ')}`);
    }
    const data = await service.createSalesOrder({ ...req.body, allocations });
    res.status(201).json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.setSalesOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!ORDER_STATUS.includes(status)) {
      return bad(res, `status must be one of: ${ORDER_STATUS.join(', ')}`);
    }
    const data = await service.setSalesOrderStatus(req.params.id, status);
    res.json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};

exports.deleteSalesOrder = async (req, res, next) => {
  try {
    await service.deleteSalesOrder(req.params.id);
    res.json({ status: 'ok' });
  } catch (err) { handleDbError(err, res, next); }
};

// ============ Dashboard ============
exports.dashboardSummary = async (req, res, next) => {
  try {
    const data = await service.dashboardSummary();
    res.json({ status: 'ok', data });
  } catch (err) { handleDbError(err, res, next); }
};
