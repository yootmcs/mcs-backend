// เส้นทางโมดูลโรงคั่ว (roastery) — mount ที่ /api (ดู routes/index.js)
const express = require('express');

const c = require('../controllers/roastery.controller');

const router = express.Router();

// แดชบอร์ดภาพรวม
router.get('/roastery/summary', c.dashboardSummary);

// ซัพพลายเออร์
router.get('/suppliers', c.listSuppliers);
router.post('/suppliers', c.createSupplier);
router.patch('/suppliers/:id', c.updateSupplier);

// เบิกโอนล็อต green (คลังกลาง ↔ Store) — ต้องมาก่อน /green-lots/:id
router.get('/green-transfers', c.listGreenTransfers);
router.post('/green-transfers', c.createGreenTransfer);

// รับวัตถุดิบ / ล็อตสารกาแฟดิบ
router.get('/green-lots', c.listGreenLots);
router.post('/green-lots', c.createGreenLot);
router.get('/green-lots/:id', c.getGreenLot);
router.patch('/green-lots/:id', c.updateGreenLot);
router.delete('/green-lots/:id', c.deleteGreenLot);

// การคั่ว
router.get('/roast-batches', c.listRoastBatches);
router.post('/roast-batches', c.createRoastBatch);
router.get('/roast-batches/:id', c.getRoastBatch);
router.delete('/roast-batches/:id', c.deleteRoastBatch);

// บรรจุภัณฑ์
router.get('/packaging', c.listPackaging);
router.post('/packaging', c.createPackaging);
router.patch('/packaging/:id', c.updatePackaging);
router.delete('/packaging/:id', c.deletePackaging);

// คำสั่งซื้อ / ส่งออก
router.get('/sales-orders', c.listSalesOrders);
router.post('/sales-orders', c.createSalesOrder);
router.get('/sales-orders/:id', c.getSalesOrder);
router.patch('/sales-orders/:id/status', c.setSalesOrderStatus);
router.delete('/sales-orders/:id', c.deleteSalesOrder);

module.exports = router;
