'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

/**
 * Verifies the `Authorization: Bearer <token>` header and attaches
 * `req.user = { id, email }` for downstream handlers.
 *
 * Every protected route scopes its queries by `req.user.id`, so a valid token
 * for user A can never read or mutate user B's rows.
 */
function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError' ? 'Token expired, please log in again' : 'Invalid token';
    return next(ApiError.unauthorized(message));
  }
}

/** Issues a signed JWT. `sub` is the user id. */
function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

module.exports = { authenticate, signToken };
