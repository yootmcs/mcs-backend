const express = require('express');

const bom = require('../controllers/bom.controller');

const router = express.Router();

router.get('/', bom.list);
router.post('/', bom.create);
router.get('/:id', bom.getById);

module.exports = router;
