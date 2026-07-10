const express = require('express');

const packingController = require('../controllers/packing.controller');

const router = express.Router();

router.post('/start', packingController.start);
router.post('/verify', packingController.verify);
router.post('/ship', packingController.ship);
router.get('/:packing_id', packingController.getById);

module.exports = router;
