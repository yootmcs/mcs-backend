const express = require('express');

const rfidController = require('../controllers/rfid.controller');

const router = express.Router();

// POST /api/rfid/scan -> resolve scanned EPC codes to tags/products
router.post('/scan', rfidController.scan);

module.exports = router;
