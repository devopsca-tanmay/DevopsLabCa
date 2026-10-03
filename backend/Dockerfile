# =============================================================================
# FinTrack backend image
# -----------------------------------------------------------------------------
# BUILD CONTEXT IS THE REPOSITORY ROOT, not backend/. The image needs both
# backend/ and database/migrations/ (the migration runner reads the .sql files
# from inside the image), and a COPY can never reach outside its context.
#
# Build with:
#   docker build -f backend/Dockerfile -t fintrack-backend:latest .
#
# Stages:
#   deps  - production dependencies only, resolved from the lockfile
#   test  - full dependencies + tests; used by CI, never shipped
#   final - slim runtime: node_modules + src, running as a non-root user
#
# Alpine keeps the image near ~130MB instead of ~1.1GB for the full node image.
# Smaller images push and pull faster, which directly shortens both deployment
# and rollback time on EC2.
# =============================================================================

# --- Stage 1: production dependencies ----------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Manifests first: this layer is cached and only invalidated when the
# dependency set changes, so ordinary source edits skip the install entirely.
COPY backend/package.json backend/package-lock.json ./

# `npm ci` installs exactly what the lockfile pins - reproducible, unlike
# `npm install`, which may resolve newer versions. --omit=dev keeps jest,
# eslint and supertest out of the runtime image.
RUN npm ci --omit=dev && npm cache clean --force


# --- Stage 2: test image (CI can run the suite inside the image) -------------
FROM node:20-alpine AS test

WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
COPY database/ ./database/
# Build this stage explicitly:
#   docker build -f backend/Dockerfile --target test -t fintrack-backend:test .
CMD ["npm", "test"]


# --- Stage 3: runtime --------------------------------------------------------
FROM node:20-alpine AS final

# curl backs the HEALTHCHECK below and the CD pipeline's verification step.
RUN apk add --no-cache curl

ENV NODE_ENV=production \
    PORT=5000

WORKDIR /app

# node:alpine ships an unprivileged `node` user (uid 1000). Running as root in
# a container means a container escape begins with root on the host, so the
# process drops privileges before it ever binds a port.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node backend/package.json ./
COPY --chown=node:node backend/src ./src
COPY --chown=node:node database ./database

USER node

EXPOSE 5000

# Docker derives the container's health status from this probe. docker compose
# gates dependent services on it and the CD pipeline reads the same status.
# start-period gives the pg pool time to connect before failures are counted.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:5000/health || exit 1

# Exec form so node is PID 1 and receives SIGTERM directly - server.js handles
# it and drains in-flight requests during a deploy.
CMD ["node", "src/server.js"]
