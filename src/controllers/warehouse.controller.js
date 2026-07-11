const service = require('../services/warehouse.service');

const CATEGORIES = ['BEAN', 'POWDER', 'LEAF', 'SYRUP', 'CREAM', 'PKG'];
const ISSUE_TYPES = ['production', 'adjust', 'return', 'loss'];

// แปลง error ของ pg เป็น HTTP response ที่เหมาะสม
function handleDbError(err, res, next) {
  if (err.code === '23505') {
    return res.status(409).json({ status: 'error', message: err.detail || 'duplicate key' });
  }
  // 23514 = check_violation (สต็อกไม่พอจาก trigger, หรือ CHECK constraint)
  if (err.code === '23514') {
    return res.status(400).json({ status: 'error', message: err.message });
  }
  if (err.code === '23503') {
    return res.status(400).json({ status: 'error', message: 'invalid reference (material_id ไม่ถูกต้อง)' });
  }
  if (err.code === '22P02') {
    return res.status(400).json({ status: 'error', message: 'invalid uuid/number format' });
  }
  return next(err);
}

// ---- Materials ----
exports.listMaterials = async (req, res, next) => {
  try {
    const { category } = req.query;
    if (category && !CATEGORIES.includes(category)) {
      return res.status(400).json({ status: 'error', message: `category must be one of: ${CATEGORIES.join(', ')}` });
    }
    const data = await service.listMaterials(category);
    res.json({ status: 'ok', count: data.length, data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

exports.createMaterial = async (req, res, next) => {
  try {
    const { code, name, category, unit } = req.body;
    if (!code || !name || !unit) {
      return res.status(400).json({ status: 'error', message: 'code, name, unit are required' });
    }
    if (category && !CATEGORIES.includes(category)) {
      return res.status(400).json({ status: 'error', message: `category must be one of: ${CATEGORIES.join(', ')}` });
    }
    const data = await service.createMaterial(req.body);
    res.status(201).json({ status: 'ok', data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

// ---- Receipts ----
exports.createReceipt = async (req, res, next) => {
  try {
    const { receipt_no, items } = req.body;
    if (!receipt_no) {
      return res.status(400).json({ status: 'error', message: 'receipt_no is required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ status: 'error', message: 'items must be a non-empty array' });
    }
    if (items.some((it) => !it.material_id || it.qty_received == null)) {
      return res.status(400).json({ status: 'error', message: 'each item requires material_id and qty_received' });
    }
    const data = await service.createReceipt(req.body);
    res.status(201).json({ status: 'ok', data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

exports.listReceipts = async (req, res, next) => {
  try {
    const data = await service.listReceipts();
    res.json({ status: 'ok', count: data.length, data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

exports.getReceipt = async (req, res, next) => {
  try {
    const data = await service.getReceipt(req.params.id);
    if (!data) return res.status(404).json({ status: 'error', message: 'receipt not found' });
    res.json({ status: 'ok', data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

// ---- Issues ----
exports.createIssue = async (req, res, next) => {
  try {
    const { issue_no, issue_type, items } = req.body;
    if (!issue_no) {
      return res.status(400).json({ status: 'error', message: 'issue_no is required' });
    }
    if (issue_type && !ISSUE_TYPES.includes(issue_type)) {
      return res.status(400).json({ status: 'error', message: `issue_type must be one of: ${ISSUE_TYPES.join(', ')}` });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ status: 'error', message: 'items must be a non-empty array' });
    }
    if (items.some((it) => !it.material_id || it.qty_issued == null)) {
      return res.status(400).json({ status: 'error', message: 'each item requires material_id and qty_issued' });
    }
    const data = await service.createIssue(req.body);
    res.status(201).json({ status: 'ok', data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

exports.listIssues = async (req, res, next) => {
  try {
    const data = await service.listIssues();
    res.json({ status: 'ok', count: data.length, data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

exports.getIssue = async (req, res, next) => {
  try {
    const data = await service.getIssue(req.params.id);
    if (!data) return res.status(404).json({ status: 'error', message: 'issue not found' });
    res.json({ status: 'ok', data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

// ---- Stock ----
exports.listStock = async (req, res, next) => {
  try {
    const data = await service.listStock();
    const lowStockCount = data.filter((r) => r.low_stock).length;
    res.json({ status: 'ok', count: data.length, low_stock_count: lowStockCount, data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

// ---- Store stock (คลังที่ 2 ของโรงคั่ว) ----
exports.listStoreStock = async (req, res, next) => {
  try {
    const data = await service.listStoreStock();
    const lowStockCount = data.filter((r) => r.low_stock).length;
    res.json({ status: 'ok', count: data.length, low_stock_count: lowStockCount, data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

// ---- Transfers (ใบเบิกโอน คลังกลาง ↔ Store) ----
const LOCATIONS = ['central', 'store'];

exports.createTransfer = async (req, res, next) => {
  try {
    const { transfer_no, from_location, to_location, items } = req.body;
    if (!transfer_no) {
      return res.status(400).json({ status: 'error', message: 'transfer_no is required' });
    }
    if (from_location && !LOCATIONS.includes(from_location)) {
      return res.status(400).json({ status: 'error', message: `from_location must be one of: ${LOCATIONS.join(', ')}` });
    }
    if (to_location && !LOCATIONS.includes(to_location)) {
      return res.status(400).json({ status: 'error', message: `to_location must be one of: ${LOCATIONS.join(', ')}` });
    }
    if (from_location && to_location && from_location === to_location) {
      return res.status(400).json({ status: 'error', message: 'from_location และ to_location ต้องต่างกัน' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ status: 'error', message: 'items must be a non-empty array' });
    }
    if (items.some((it) => !it.material_id || it.qty == null || Number(it.qty) <= 0)) {
      return res.status(400).json({ status: 'error', message: 'each item requires material_id and qty > 0' });
    }
    const data = await service.createTransfer(req.body);
    res.status(201).json({ status: 'ok', data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

exports.listTransfers = async (req, res, next) => {
  try {
    const data = await service.listTransfers();
    res.json({ status: 'ok', count: data.length, data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

exports.getTransfer = async (req, res, next) => {
  try {
    const data = await service.getTransfer(req.params.id);
    if (!data) return res.status(404).json({ status: 'error', message: 'transfer not found' });
    res.json({ status: 'ok', data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};
