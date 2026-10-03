'use strict';

const express = require('express');
const controller = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { validateRegistration, validateLogin } = require('../utils/validators');

const router = express.Router();

router.post('/register', validate(validateRegistration), asyncHandler(controller.register));
router.post('/login', validate(validateLogin), asyncHandler(controller.login));
router.get('/me', authenticate, asyncHandler(controller.me));

module.exports = router;
