#!/usr/bin/env bash
# =============================================================================
# FinTrack - manual rollback
# -----------------------------------------------------------------------------
# Run ON THE EC2 INSTANCE, from /opt/fintrack:
#
#   ./rollback.sh                 # list versions and show the current one
#   ./rollback.sh a81f23c         # roll back to that image tag
#
# Why this is short: every image CI builds is tagged with its commit SHA, and
# those tags are immutable - `fintrack-backend:a81f23c` means the same bytes
# today as it did the day it was built. Rolling back is therefore just
# "point IMAGE_TAG at a previous SHA and bring the stack up again". There is no
# rebuild, no git checkout, and no npm install.
#
# The database is NOT rolled back. The pgdata volume is untouched by this
# script, which is correct for additive migrations (a new nullable column is
# simply ignored by older code). A destructive migration - dropping a column,
# renaming one - cannot be undone this way; see docs/deployment.md.
# =============================================================================

set -euo pipefail

COMPOSE_FILE=docker-compose.prod.yml
ENV_FILE=.env

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: ${ENV_FILE} not found. Run this from /opt/fintrack on the instance." >&2
  exit 1
fi

CURRENT=$(grep '^IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2 || echo unknown)
REGISTRY=$(grep '^REGISTRY=' "$ENV_FILE" | cut -d= -f2 || echo unknown)

# --- No argument: report the current state and the available versions --------
if [ $# -eq 0 ]; then
  echo "Currently deployed version: ${CURRENT}"
  echo ""
  echo "Images available locally on this instance:"
  docker images "${REGISTRY}/fintrack-backend" \
    --format '  {{.Tag}}\t(built {{.CreatedSince}}, {{.Size}})' | grep -v '^  latest' || true
  echo ""
  echo "Any tag still in the registry can also be used, even if it is not cached here."
  echo ""
  echo "Usage: $0 <image-tag>"
  exit 0
fi

TARGET="$1"

if [ "$TARGET" = "$CURRENT" ]; then
  echo "Version ${TARGET} is already deployed. Nothing to do."
  exit 0
fi

echo "============================================================"
echo " Rolling back"
echo "   from: ${CURRENT}"
echo "   to:   ${TARGET}"
echo "============================================================"

# Keep a record of what we rolled away from, so the operation is reversible.
cp "$ENV_FILE" "${ENV_FILE}.before-rollback"

sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${TARGET}/" "$ENV_FILE"

# ECR login tokens last 12 hours, so refresh it before pulling. The instance
# profile provides the credentials; nothing is read from disk.
if [[ "$REGISTRY" == *.dkr.ecr.*.amazonaws.com ]]; then
  REGION=$(echo "$REGISTRY" | cut -d. -f4)
  echo "==> Logging in to ${REGISTRY}"
  aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
fi

echo "==> Pulling ${TARGET} (no-op if it is already cached locally)"
if ! docker compose -f "$COMPOSE_FILE" pull; then
  echo "ERROR: could not pull ${TARGET}. Restoring ${CURRENT}." >&2
  mv "${ENV_FILE}.before-rollback" "$ENV_FILE"
  exit 1
fi

echo "==> Recreating containers"
docker compose -f "$COMPOSE_FILE" up -d

# --- Verify, exactly as the CD pipeline does ---------------------------------
echo "==> Verifying health"
for attempt in $(seq 1 24); do
  BODY=$(curl -fsS --max-time 5 http://localhost/health 2>/dev/null || echo "")
  if echo "$BODY" | grep -q '"status":"healthy"'; then
    echo ""
    echo "Rollback successful. ${TARGET} is serving:"
    echo "  ${BODY}"
    echo ""
    docker compose -f "$COMPOSE_FILE" ps
    rm -f "${ENV_FILE}.before-rollback"
    exit 0
  fi
  sleep 5
done

echo "" >&2
echo "ERROR: ${TARGET} did not become healthy within 2 minutes." >&2
echo "Backend logs:" >&2
docker logs --tail 60 fintrack-backend >&2 || true
echo "" >&2
echo "The previous .env was saved as ${ENV_FILE}.before-rollback" >&2
exit 1
