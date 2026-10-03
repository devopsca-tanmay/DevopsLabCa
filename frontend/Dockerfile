# =============================================================================
# FinTrack frontend image
# -----------------------------------------------------------------------------
# BUILD CONTEXT IS THE REPOSITORY ROOT (kept consistent with the backend image).
#
#   docker build -f frontend/Dockerfile -t fintrack-frontend:latest .
#
# Two stages:
#   build  - node, npm ci, vite build  -> produces static files in /app/dist
#   serve  - nginx serving those static files
#
# The React dev server is NEVER used in production. Vite's dev server is an
# unoptimised, unminified development tool. The shipped image contains only
# pre-built HTML/CSS/JS served by nginx - no Node.js runtime at all, which is
# why this image is ~50MB rather than several hundred.
# =============================================================================

# --- Stage 1: build the static bundle ----------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# Vite inlines import.meta.env at BUILD time, so this is a build argument
# rather than a runtime variable. It defaults to the relative path "/api"
# because the browser always reaches the backend through nginx on the same
# origin - which is what keeps this image identical in every environment.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build


# --- Stage 2: serve the bundle ------------------------------------------------
FROM nginx:1.27-alpine AS serve

# This nginx serves the SPA itself. The separate top-level nginx/ service is
# the edge reverse proxy that routes / here and /api to the backend.
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Only the build output is carried forward - no source, no node_modules.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
