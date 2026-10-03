'use strict';

const ApiError = require('../utils/ApiError');

/**
 * Adapts a pure validator from utils/validators.js into Express middleware.
 * Keeping the rules themselves pure means the unit test suite can check them
 * without spinning up a server.
 *
 * @param {(body:object) => {valid:boolean, errors:string[]}} validator
 */
function validate(validator) {
  return (req, _res, next) => {
    const { valid, errors } = validator(req.body || {});
    if (!valid) {
      return next(ApiError.badRequest('Validation failed', errors));
    }
    return next();
  };
}

module.exports = validate;
