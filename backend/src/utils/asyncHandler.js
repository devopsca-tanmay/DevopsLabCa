'use strict';

/**
 * Wraps an async route handler so a rejected promise is forwarded to the
 * Express error handler instead of becoming an unhandled rejection that
 * silently hangs the request (Express 4 does not await handlers).
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = asyncHandler;
