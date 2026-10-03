'use strict';

const express = require('express');
const controller = require('../controllers/transactionController');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { validateTransaction } = require('../utils/validators');

const router = express.Router();

// Every transaction route requires a valid JWT.
router.use(authenticate);

router.get('/', asyncHandler(controller.list));
router.post('/', validate(validateTransaction), asyncHandler(controller.create));
router.get('/:id', asyncHandler(controller.getOne));
router.put('/:id', validate(validateTransaction), asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
