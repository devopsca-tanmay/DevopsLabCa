'use strict';

const express = require('express');
const controller = require('../controllers/budgetController');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { validateBudget } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

router.get('/', asyncHandler(controller.list));
router.post('/', validate(validateBudget), asyncHandler(controller.create));
router.put('/:id', validate(validateBudget), asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
