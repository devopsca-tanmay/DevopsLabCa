'use strict';

// Loads .env when present. In Docker the variables are injected by compose /
// the CD pipeline, so a missing .env file is normal and not an error.
require('dotenv').config();

/**
 * Reads a required variable, failing fast at boot rather than at first request.
 * A container that cannot be configured correctly should refuse to start so the
 * deployment health check catches it immediately.
 */
function required(name, fallbackInNonProd) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV !== 'production' && fallbackInNonProd !== undefined) {
    return fallbackInNonProd;
  }
  throw new Error(
    `Missing required environment variable: ${name}. ` +
      'See .env.example for the full list.'
  );
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),

  databaseUrl: required(
    'DATABASE_URL',
    'postgresql://fintrack:fintrack@localhost:5432/fintrack'
  ),

  jwtSecret: required('JWT_SECRET', 'dev_only_insecure_secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),

  logLevel: process.env.LOG_LEVEL || 'info',

  get isProduction() {
    return this.nodeEnv === 'production';
  },
  get isTest() {
    return this.nodeEnv === 'test';
  },
};

module.exports = env;
