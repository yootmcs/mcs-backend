const service = require('../services/bom.service');
const handleDbError = require('../utils/handleDbError');

const BOM_TYPES = ['roasting', 'packaging'];

// GET /api/bom
exports.list = async (req, res, next) => {
  try {
    const data = await service.listBoms();
    res.json({ status: 'ok', count: data.length, data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

// GET /api/bom/:id
exports.getById = async (req, res, next) => {
  try {
    const data = await service.getBom(req.params.id);
    if (!data) return res.status(404).json({ status: 'error', message: 'BOM not found' });
    res.json({ status: 'ok', data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};

// POST /api/bom
exports.create = async (req, res, next) => {
  try {
    const { code, name, bom_type, output_qty, output_unit, items } = req.body;
    if (!code || !name || output_qty == null || !output_unit) {
      return res.status(400).json({ status: 'error', message: 'code, name, output_qty, output_unit are required' });
    }
    if (bom_type && !BOM_TYPES.includes(bom_type)) {
      return res.status(400).json({ status: 'error', message: `bom_type must be one of: ${BOM_TYPES.join(', ')}` });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ status: 'error', message: 'items must be a non-empty array' });
    }
    if (items.some((it) => !it.material_id || it.qty_required == null || !it.unit)) {
      return res.status(400).json({ status: 'error', message: 'each item requires material_id, qty_required, unit' });
    }
    const data = await service.createBom(req.body);
    res.status(201).json({ status: 'ok', data });
  } catch (err) {
    handleDbError(err, res, next);
  }
};
