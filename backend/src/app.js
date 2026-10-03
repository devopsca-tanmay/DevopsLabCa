'use strict';

const express = require('express');
const cors = require('cors');

const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');
const healthRoutes = require('./routes/healthRoutes');
const apiRoutes = require('./routes');

const app = express();

// Behind nginx. Without this, req.ip logs the proxy address rather than the
// real client address from X-Forwarded-For.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// In production the frontend is served from the same origin through nginx, so
// CORS is only genuinely needed for local Vite dev on :5173.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  })
);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));

// Logs every request on completion, including /health.
app.use(requestLogger);

// Health lives at the root, OUTSIDE /api, because Docker, nginx and the CD
// pipeline all probe it directly.
app.use('/health', healthRoutes);

app.use('/api', apiRoutes);

app.get('/', (_req, res) => {
  res.json({ service: 'fintrack-backend', docs: '/api', health: '/health' });
});

// Order matters: unmatched route -> 404, then the central error handler.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
