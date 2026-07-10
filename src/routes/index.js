const express = require('express');

const healthRoutes = require('./health.routes');
const rfidRoutes = require('./rfid.routes');
const productRoutes = require('./product.routes');
const stockRoutes = require('./stock.routes');
const packingRoutes = require('./packing.routes');
const warehouseRoutes = require('./warehouse.routes');

const router = express.Router();

router.use('/health', healthRoutes);
router.use('/rfid', rfidRoutes);
router.use('/products', productRoutes);
router.use('/stock', stockRoutes);
router.use('/packing', packingRoutes);
router.use('/warehouse', warehouseRoutes);

// Register additional resource routes here, e.g.:
// router.use('/customers', require('./customer.routes'));

module.exports = router;
