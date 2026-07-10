const express = require('express');

const healthController = require('../controllers/health.controller');

const router = express.Router();

// GET /api/health        -> service liveness
router.get('/', healthController.check);

// GET /api/health/db     -> database connectivity
router.get('/db', healthController.checkDb);

module.exports = router;
