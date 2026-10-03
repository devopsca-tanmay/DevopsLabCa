'use strict';

const bcrypt = require('bcryptjs');
const userModel = require('../models/userModel');
const { signToken } = require('../middleware/auth');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const env = require('../config/env');

/**
 * POST /api/auth/register
 * Hashes the password with bcrypt before it ever reaches the database.
 */
async function register(req, res) {
  const { name, email, password } = req.body;

  if (await userModel.emailExists(email)) {
    throw ApiError.conflict('An account with that email already exists');
  }

  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
  const user = await userModel.create({ name, email, passwordHash });

  logger.info('user registered', { userId: user.id });

  res.status(201).json({ user, token: signToken(user) });
}

/**
 * POST /api/auth/login
 * Returns the same generic message for "no such user" and "wrong password" so
 * the endpoint cannot be used to enumerate which emails are registered.
 */
async function login(req, res) {
  const { email, password } = req.body;

  const record = await userModel.findByEmailWithHash(email);
  if (!record) {
    logger.warn('login failed - unknown email');
    throw ApiError.unauthorized('Invalid email or password');
  }

  const matches = await bcrypt.compare(password, record.password_hash);
  if (!matches) {
    logger.warn('login failed - bad password', { userId: record.id });
    throw ApiError.unauthorized('Invalid email or password');
  }

  // Strip the hash before the record goes anywhere near the response.
  const user = {
    id: record.id,
    name: record.name,
    email: record.email,
    created_at: record.created_at,
  };

  logger.info('user logged in', { userId: user.id });

  res.status(200).json({ user, token: signToken(user) });
}

/**
 * GET /api/auth/me
 * Used by the frontend on page load to restore a session from a stored token.
 */
async function me(req, res) {
  const user = await userModel.findById(req.user.id);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  res.status(200).json({ user });
}

module.exports = { register, login, me };
