'use strict';

const ApiError = require('../utils/ApiError');

/** Terminal middleware for unmatched routes - turns them into a clean 404. */
function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

module.exports = notFound;
