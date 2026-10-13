# Site returns 502 after a deploy or rollback recreates the app containers

- **Date:** 2026-10-13
- **Reported as:** CD run 38376984107 (manual deploy of `c035902`):
  `##[error]Health check failed. Last response: <no response>`, then in the rollback step
  `##[error]Rollback did not restore service. Manual intervention required - see docs/deployment.md.`
  `curl http://3.6.158.41/health` returned `502 Bad Gateway` from nginx.
- **Symptom:** All four containers reported `(healthy)` and `.env` said `IMAGE_TAG=30cf394`, but every request through nginx got 502.
  `docker ps` showed `fintrack-frontend` and `fintrack-backend` "Up 41 seconds" while `fintrack-nginx` was "Up 22 minutes": nginx had not been recreated.
- **Where:**
  - `nginx/nginx.conf:23-31` (old): `upstream fintrack_frontend { server frontend:80; }` / `upstream fintrack_backend { server backend:5000; }`
  - `.github/workflows/cd.yml`, Deploy step: `docker compose ... up -d --remove-orphans` (recreates the app containers, never touches nginx)
  - `.github/workflows/cd.yml`, rollback step, and `scripts/rollback.sh`: same `up -d`
- **Root cause:** nginx resolves the hostnames in an `upstream` block once, at startup, and proxies to those IPs for its whole life. A deploy or rollback recreates the frontend/backend containers, and Docker can give them new IPs on `fintrack-net`. nginx's own compose definition did not change, so compose left the old nginx running, and it kept forwarding to IPs that no longer existed.
- **Why it wasn't caught:**
  - Docker usually hands a recreated container its old IP back, so earlier deploys and the manual rollback on 2026-10-03 happened to work. The bug only appears when the IPs shift.
  - The only earlier failed deploy was the very first one, where the rollback step was skipped because there was no previous version. So this was the first real exercise of the rollback path.
  - The CD verification did catch it (good). But its own rollback recreates the containers the same way, so the rollback could not recover.
- **Fix:**
  1. `nginx/nginx.conf`: removed the `upstream` blocks. Added `resolver 127.0.0.11 valid=10s ipv6=off;` (Docker's embedded DNS) and put the targets in variables (`set $backend_upstream http://backend:5000;`, `proxy_pass $backend_upstream;`). A variable in `proxy_pass` makes nginx re-resolve the service name at request time, cached for at most 10 s, so it follows recreated containers. This fixes the cause in one place, so every path that recreates containers is covered: CD deploy, CD rollback, `rollback.sh` and manual compose. The alternative was "restart nginx after every `up -d`", which would have to be remembered in each path.
  2. `cd.yml`, Deploy step: added `docker exec fintrack-nginx nginx -t` and `nginx -s reload` after `up -d`. `nginx.conf` is bind-mounted, so compose never notices it changed. Without the reload, a config change, including this fix, would never be applied by a deploy. A broken config now fails the deploy, which triggers rollback.
- **Evidence:**
  - Restoring service by hand during the incident: `docker restart fintrack-nginx` was followed by `{"status":"healthy",...,"version":"30cf394",...,"checks":{"database":"up"}}` and `frontend 200`.
  - New config tested in a throwaway `nginx:1.27-alpine` container on `fintrack-net` (port 8081, then removed):
    ```
    nginx: configuration file /etc/nginx/nginx.conf test is successful
    {"status":"healthy","service":"fintrack-backend","version":"30cf394",...,"checks":{"database":"up"}}
    frontend 200
    api (no auth) 401
    ```
- **Blast radius:**
  - Every request path through the edge proxy: `/`, `/api/`, `/api/auth/` (rate limit unchanged) and `/health`.
  - `/health` keeps its URI: with a variable and no URI part, nginx forwards the original request URI.
  - Local `docker-compose.yml` uses the same `nginx.conf` and also runs on a user-defined network, so `127.0.0.11` resolves there too.
- **Still open:** Nothing functional. Keepalive connection pooling to the upstreams is not used, as before, so dropping the `upstream` blocks loses nothing.
- **Related:** none yet (first record in this folder).
