'use strict';

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const env = require('../config/env');

// Postgres SQLSTATE codes we translate into meaningful HTTP statuses rather
// than letting them surface as an opaque 500.
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';

/**
 * Central error handler. Must be registered LAST, after all routes.
 *
 * Two rules:
 *  1. An ApiError is a deliberate, client-facing error - return it as-is.
 *  2. Anything else is an unexpected bug - log the full stack server-side but
 *     return a generic message so stack traces and SQL never leak to clients.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let status = 500;
  let message = 'Internal server error';
  let details;

  if (err instanceof ApiError) {
    status = err.status;
    message = err.message;
    details = err.details;
  } else if (err.code === PG_UNIQUE_VIOLATION) {
    status = 409;
    message = 'That record already exists';
  } else if (err.code === PG_FOREIGN_KEY_VIOLATION) {
    status = 400;
    message = 'Referenced record does not exist';
  } else if (err.code === PG_CHECK_VIOLATION) {
    status = 400;
    message = 'A field failed a database constraint';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Request body is not valid JSON';
  }

  const logPayload = {
    method: req.method,
    route: req.originalUrl,
    status,
    error: err.message,
    code: err.code,
  };

  if (status >= 500) {
    logger.error('unhandled error', { ...logPayload, stack: err.stack });
  } else {
    logger.warn('request rejected', logPayload);
  }

  const body = { error: message };
  if (details) body.details = details;
  // Stack traces are a development aid only - never sent in production.
  if (!env.isProduction && status >= 500) body.stack = err.stack;

  res.status(status).json(body);
}

module.exports = errorHandler;
