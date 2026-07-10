const express = require('express');

const rfidController = require('../controllers/rfid.controller');

const router = express.Router();

// POST /api/rfid/tags -> register a new tag (+ receive into stock)
router.post('/tags', rfidController.registerTag);

// POST /api/rfid/scan -> resolve scanned EPC codes to tags/products
router.post('/scan', rfidController.scan);

module.exports = router;
