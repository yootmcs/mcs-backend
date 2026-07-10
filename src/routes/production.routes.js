const express = require('express');

const production = require('../controllers/production.controller');

const router = express.Router();

router.post('/orders', production.createOrder);
router.get('/orders', production.listOrders);
router.get('/orders/:id', production.getOrder);
router.post('/orders/:id/start', production.start);
router.post('/orders/:id/complete', production.complete);

module.exports = router;
