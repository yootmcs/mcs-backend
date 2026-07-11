const express = require('express');

const wh = require('../controllers/warehouse.controller');

const router = express.Router();

// Materials
router.get('/materials', wh.listMaterials);
router.post('/materials', wh.createMaterial);

// Receipts (รับเข้า)
router.post('/receipts', wh.createReceipt);
router.get('/receipts', wh.listReceipts);
router.get('/receipts/:id', wh.getReceipt);

// Issues (จ่ายออก)
router.post('/issues', wh.createIssue);
router.get('/issues', wh.listIssues);
router.get('/issues/:id', wh.getIssue);

// Stock
router.get('/stock', wh.listStock);
router.get('/store-stock', wh.listStoreStock);

// Transfers (ใบเบิกโอน คลังกลาง ↔ Store)
router.post('/transfers', wh.createTransfer);
router.get('/transfers', wh.listTransfers);
router.get('/transfers/:id', wh.getTransfer);

module.exports = router;
