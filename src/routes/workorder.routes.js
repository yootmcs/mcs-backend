// ใบสั่งงานรวม (คั่ว + บรรจุ) เบิกจาก Store โรงคั่ว
const express = require('express');

const wo = require('../controllers/workorder.controller');

const router = express.Router();

router.post('/', wo.create);
router.get('/', wo.list);
router.get('/:id', wo.getById);
router.post('/:id/start', wo.start);
router.post('/:id/complete', wo.complete);
router.post('/:id/cancel', wo.cancel);

module.exports = router;
