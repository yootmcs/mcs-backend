const express = require('express');

const stockController = require('../controllers/stock.controller');

const router = express.Router();

router.get('/', stockController.list);

module.exports = router;
