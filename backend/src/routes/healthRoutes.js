'use strict';

const express = require('express');
const controller = require('../controllers/healthController');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// Deliberately unauthenticated: Docker, nginx and the CD pipeline all need to
// reach it without credentials. It exposes no user data.
router.get('/', asyncHandler(controller.health));
router.get('/live', controller.liveness);

module.exports = router;
