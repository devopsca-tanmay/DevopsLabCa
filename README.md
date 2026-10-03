# FinTrack

A personal finance tracker built to demonstrate a complete, production-style
**DevOps delivery pipeline** — from a developer's commit to a live application
on AWS, with automated testing, containerisation, image scanning, health-gated
deployment and a documented rollback path.

The finance application is deliberately simple. The engineering around it is
the point:

```
Code → Git → GitHub → CI → Tests → Build → Docker → Security Scan
     → Registry → CD → AWS EC2 → Health Check → Live Application
```

---

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Running with Docker](#running-with-docker)
- [Running tests](#running-tests)
- [CI/CD pipeline](#cicd-pipeline)
- [Docker images and containers](#docker-images-and-containers)
- [AWS deployment](#aws-deployment)
- [Monitoring and logs](#monitoring-and-logs)
- [Rollback](#rollback)
- [Demonstration procedure](#demonstration-procedure)
- [Screenshots](#screenshots)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Contributors](#contributors)

---

## Overview

FinTrack lets a user record income and expenses, group them by category, set
monthly budgets, and see a dashboard summarising their position — balance,
savings rate, spending by category, income vs expenses over time, budget usage,
and a demonstration "financial health score".

**This is an academic demonstration project.** It performs no real banking, no
payments, no stock trading and no bank API integration. The health score is a
toy heuristic computed only from data the user typed into the app; it is not
financial advice.

---

## Features

| | Feature |
|---|---|
| 1 | Register a new account |
| 2 | Log in |
| 3 | Log out |
| 4 | Dashboard with totals, charts and score |
| 5 | Add income |
| 6 | Add expenses |
| 7 | Edit transactions |
| 8 | Delete transactions |
| 9 | View transaction history |
| 10 | Filter by type, category and date range |
| 11 | Create monthly budgets per category |
| 12 | View spending by category |
| 13 | View income vs expenses over time |
| 14 | Basic financial health score |

---

## Architecture

### Runtime (identical locally and on EC2)

```
                         Internet
                            |
                            v
                      :80  Nginx                  <-- the only published port
                            |
              +-------------+-------------+
              |                           |
              v  /                        v  /api
        React frontend              Node.js API
        (static, nginx)             (Express)
        container                   container
                                          |
                                          v
                                    PostgreSQL
                                    container
                                    (never published)
```

The backend and the database have **no published ports**. They are reachable
only by service name on the private `fintrack-net` Docker bridge network, so
the EC2 security group only ever needs port 80 (and 443 once TLS is added) open
to the world.

### Delivery pipeline

```
 Developer
     |  git push
     v
  GitHub
     |
     v
 GitHub Actions (CI)
     |
     +--------------------+--------------------+--------------------+
     |                    |                    |                    |
     v                    v                    v                    v
   Lint              Unit tests        Integration tests      Frontend build
  (backend +        (pure finance       (real PostgreSQL       (vite build)
   frontend)         + validators)       service container)
     |                    |                    |                    |
     +--------------------+----------+---------+--------------------+
                                     |
                              all four green?
                                     |
                      no  <----------+----------> yes
                       |                           |
                       v                           v
                 PIPELINE STOPS              Docker build
                 Nothing is pushed          (backend + frontend)
                 Nothing is deployed                |
                                                    v
                                            Trivy image scan
                                                    |
                                                    v
                                          Push to Docker Hub
                                       tags: <commit-sha> + latest
                                                    |
                                                    v
                                        GitHub Actions (CD)
                                       (only if CI succeeded)
                                                    |
                                                    v
                                              SSH to AWS EC2
                                                    |
                                     pull images -> migrate -> up -d
                                                    |
                                                    v
                                              Health checks
                                     container status + /health + /
                                                    |
                                   pass <-----------+-----------> fail
                                    |                               |
                                    v                               v
                             Deployment OK                Automatic rollback
                                                         to the previous SHA
```

A full-page diagram is in [`docs/architecture.md`](docs/architecture.md).

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 5, Tailwind CSS 3, React Router 6, Axios |
| Backend | Node.js 20, Express 4, JWT (`jsonwebtoken`), bcryptjs |
| Database | PostgreSQL 16 |
| Testing | Jest 29, Supertest 7 |
| Containers | Docker (multi-stage), Docker Compose v2 |
| CI/CD | GitHub Actions |
| Registry | Docker Hub (Amazon ECR notes in `docs/deployment.md`) |
| Scanning | Trivy |
| Hosting | AWS EC2 (Ubuntu) |
| Proxy | Nginx |

---

## Project structure

```
fintrack/
├── frontend/
│   ├── src/
│   │   ├── api/            axios client, JWT interceptors
│   │   ├── components/     Layout, charts, stat tiles, meters
│   │   ├── context/        AuthContext (session state)
│   │   ├── pages/          Login, Register, Dashboard, Transactions, Budgets
│   │   └── utils/          currency/date formatting
│   ├── Dockerfile          multi-stage: node build -> nginx serve
│   ├── nginx.conf          SPA fallback + asset caching (inside the container)
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── config/         env validation, pg pool, migration runner
│   │   ├── controllers/    request handling
│   │   ├── middleware/     auth, validation, request logging, error handler
│   │   ├── models/         parameterised SQL
│   │   ├── routes/         route definitions
│   │   ├── services/       financeService — all dashboard maths (pure)
│   │   ├── utils/          logger, ApiError, validators
│   │   ├── app.js          Express app (exported for Supertest)
│   │   └── server.js       listener + graceful shutdown
│   ├── tests/
│   │   ├── unit/           81 tests, no database
│   │   ├── integration/    61 tests against real PostgreSQL
│   │   └── helpers/        schema setup / reset harness
│   ├── Dockerfile          multi-stage, non-root, HEALTHCHECK
│   └── package.json
│
├── database/
│   ├── init.sql            schema, indexes, constraints
│   └── migrations/         forward-only, tracked in schema_migrations
│
├── nginx/
│   └── nginx.conf          edge reverse proxy (/ -> frontend, /api -> backend)
│
├── .github/workflows/
│   ├── ci.yml              lint, test, build, scan, push
│   └── cd.yml              deploy to EC2, verify, auto-rollback
│
├── scripts/
│   ├── ec2-setup.sh        one-time instance bootstrap
│   └── rollback.sh         manual rollback on the instance
│
├── docs/
│   ├── architecture.md     diagrams and component responsibilities
│   ├── devops.md           the pipeline, explained stage by stage
│   ├── testing.md          testing strategy and how to run it
│   └── deployment.md       AWS setup, secrets, rollback runbook
│
├── docker-compose.yml      LOCAL: builds images from source
├── docker-compose.prod.yml PRODUCTION: pulls pre-built images
├── .env.example            every variable, documented
├── .gitignore
└── .dockerignore
```

---

## Local setup

### Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- Node.js 20+ — only needed to run tests or the dev servers outside Docker

### Fastest path — everything in Docker

```bash
git clone <your-repo-url> fintrack
cd fintrack

cp .env.example .env
# Edit .env and set a real JWT_SECRET. Generate one with:
#   openssl rand -hex 32

docker compose up -d
```

Open **http://localhost**, register an account, and start adding transactions.

Verify the stack:

```bash
docker compose ps                  # all four services should read "healthy"
curl http://localhost/health       # {"status":"healthy",...}
```

### Seeding demo data

An empty account shows empty states, which is not what you want in a
screenshot. This populates a demo account through the REST API (not by writing
to the database directly, so it exercises the same path a real user does):

```bash
node scripts/seed-demo-data.js                  # against http://localhost
node scripts/seed-demo-data.js http://<EC2-IP>  # against a deployment
```

It creates `demo@fintrack.local` / `demo-password-123` with two months of
history — income ₹120,000, expenses ₹35,000, balance ₹85,000, a ~71% savings
rate — and budgets that deliberately span all three states (on track, close to
limit, over budget) so every part of the dashboard renders.

Tear down:

```bash
docker compose down        # stops containers, KEEPS the database volume
docker compose down -v     # also deletes the database volume
```

### Running the apps directly (for frontend hot reload)

```bash
# 1. Database only
docker compose up -d postgres

# 2. Backend
cd backend
npm install
cp ../.env.example .env
# point DATABASE_URL at localhost, not the "postgres" service name:
#   DATABASE_URL=postgresql://fintrack:<password>@localhost:5432/fintrack
npm run migrate
npm run dev                # http://localhost:5000

# 3. Frontend (separate terminal)
cd frontend
npm install
npm run dev                # http://localhost:5173, proxies /api to :5000
```

---

## Environment variables

Configuration is supplied entirely through environment variables — nothing
environment-specific is compiled into the code or committed to git.

`.env.example` is committed as the documented template. **`.env` itself is
gitignored and must never be committed.**

```bash
cp .env.example .env
```

| Variable | Used by | Example | Notes |
|---|---|---|---|
| `NODE_ENV` | backend | `production` | Suppresses stack traces in API responses |
| `PORT` | backend | `5000` | Container-internal only |
| `POSTGRES_USER` | postgres, backend | `fintrack` | |
| `POSTGRES_PASSWORD` | postgres, backend | *(secret)* | |
| `POSTGRES_DB` | postgres, backend | `fintrack` | |
| `POSTGRES_PORT` | compose (local) | `5432` | Bound to `127.0.0.1` only |
| `DATABASE_URL` | backend | `postgresql://user:pw@postgres:5432/fintrack` | Host is the **service name**, not `localhost` |
| `JWT_SECRET` | backend | *(secret)* | `openssl rand -hex 32`. Changing it invalidates every session |
| `JWT_EXPIRES_IN` | backend | `24h` | |
| `BCRYPT_ROUNDS` | backend | `10` | Cost factor for password hashing |
| `LOG_LEVEL` | backend | `info` | `error` / `warn` / `info` / `debug` |
| `VITE_API_URL` | frontend **build** | `/api` | Inlined by Vite at build time, not runtime |
| `REGISTRY` | compose (prod) | `docker.io/<user>` | Where images are pulled from |
| `IMAGE_TAG` | compose (prod) | `a81f23c` | **The rollback lever** — see [Rollback](#rollback) |
| `HTTP_PORT` | compose (local) | `80` | Change if port 80 is taken locally |

**How values reach each environment**

| Environment | Source |
|---|---|
| Local | `.env` in the repo root, read by Docker Compose |
| CI | Hard-coded throwaway values inside `ci.yml` (test database only) |
| Production | GitHub Secrets → written to `/opt/fintrack/.env` by `cd.yml` on every deploy |

`src/config/env.js` validates required variables **at boot** and refuses to
start if one is missing — so a misconfigured container fails its health check
immediately instead of erroring on the first user request.

---

## Running with Docker

```bash
docker compose up -d           # build and start everything
docker compose ps              # health status of all four services
docker compose logs -f backend # follow one service
docker compose down            # stop (database volume preserved)
```

| Service | Image | Published port | Health check |
|---|---|---|---|
| `nginx` | `nginx:1.27-alpine` | **80** | `GET /nginx-health` |
| `frontend` | built from `frontend/Dockerfile` | none | `GET /` |
| `backend` | built from `backend/Dockerfile` | none | `GET /health` |
| `postgres` | `postgres:16-alpine` | `127.0.0.1:5432` (local only) | `pg_isready` |

Startup is ordered by health, not by luck: the backend waits for postgres to
report **healthy** (`condition: service_healthy`), and nginx waits for both
application containers. That removes the classic "backend crashed because the
database wasn't ready yet" race.

---

## Running tests

```bash
cd backend

npm run test:unit          # 81 tests, no database needed
npm run test:integration   # 61 tests, needs PostgreSQL
npm test                   # everything
npm run test:coverage      # with a coverage report
```

Integration tests need a database:

```bash
docker compose up -d postgres
export DATABASE_URL="postgresql://fintrack:<password>@localhost:5432/fintrack"
export JWT_SECRET="any-test-value"
npm run test:integration
```

**142 tests total.**

| Suite | Tests | Needs a database? | What it proves |
|---|---|---|---|
| `unit/financeService` | 39 | No | Totals, savings rate, category grouping, monthly trend, budget usage, health score |
| `unit/validators` | 42 | No | Email, password, amount, date, month/year, payload validation |
| `integration/auth` | 11 | Yes | Register, login, `/me`, duplicate email, token rejection |
| `integration/transactions` | 21 | Yes | Full CRUD, filtering, cross-user isolation |
| `integration/budgets` | 12 | Yes | CRUD, unique-constraint conflicts |
| `integration/dashboard` | 8 | Yes | Aggregation end to end |
| `integration/health` | 9 | Yes | `/health` contract, 404s, malformed JSON |

Full detail in [`docs/testing.md`](docs/testing.md).

---

## CI/CD pipeline

### CI — `.github/workflows/ci.yml`

Triggers on every `push` and `pull_request`.

| Job | What it does | Fails the build when |
|---|---|---|
| `lint` | ESLint over backend and frontend | Any lint error |
| `unit-tests` | `npm run test:unit` | Any unit test fails |
| `integration-tests` | `npm run test:integration` against a PostgreSQL **service container** | Any integration test fails |
| `build-frontend` | `vite build` | The production bundle does not compile |
| `build-images` | Docker build → Trivy scan → push | A build fails, **or any job above failed** |

The first four jobs run **in parallel**; `build-images` declares
`needs: [lint, unit-tests, integration-tests, build-frontend]`. That `needs:`
line is the gate — if any one of them is red, the image job is skipped, nothing
is pushed to the registry, and CD never starts.

Images are pushed only on a push to `main` or `develop`, never from a pull
request, so registry credentials are never exposed to untrusted fork code.

### CD — `.github/workflows/cd.yml`

Triggered by `workflow_run` on the **completion of CI on `main`**, and gated on
`github.event.workflow_run.conclusion == 'success'`.

1. Resolve the image tag (the commit SHA CI built)
2. **Record the currently deployed tag** — the rollback target
3. SSH to EC2, write `/opt/fintrack/.env` from GitHub Secrets
4. `docker compose pull` — pre-built images, nothing is compiled on the server
5. Run database migrations before the new containers take traffic
6. `docker compose up -d`
7. **Verify**: every container healthy → `GET /health` returns `"status":"healthy"` → `"database":"up"` → frontend returns 200
8. On failure → **automatic rollback** to the recorded previous tag, then re-verify

---

## Docker images and containers

Two application images, both multi-stage.

**Backend** (`backend/Dockerfile`) — build context is the **repository root**,
because the image needs `database/migrations/` as well as `backend/`.

| Stage | Purpose |
|---|---|
| `deps` | `npm ci --omit=dev` from the lockfile — reproducible, no test tooling |
| `test` | Full dependencies + source, for running the suite inside the image |
| `final` | `node_modules` + `src` only, running as the non-root `node` user |

Hardening: non-root user, Alpine base (~130 MB vs ~1.1 GB), `HEALTHCHECK`
polling `/health`, exec-form `CMD` so Node is PID 1 and receives `SIGTERM`
directly for graceful shutdown.

**Frontend** (`frontend/Dockerfile`)

```
Stage 1  node:20-alpine  →  npm ci  →  vite build  →  /app/dist
Stage 2  nginx:1.27-alpine  →  serves /app/dist
```

The React **dev server is never used in production**. The shipped image
contains no Node.js runtime at all — only static files and nginx.

### Image tagging

Every build is pushed under two tags:

```
<user>/fintrack-backend:latest     # moving pointer, convenience
<user>/fintrack-backend:a81f23c    # immutable, the commit SHA
```

The SHA tag is what makes rollback possible: `a81f23c` identifies one exact
build forever, so "go back to the version that worked" is unambiguous.

### Image scanning

Trivy scans both images for `CRITICAL` and `HIGH` vulnerabilities in OS
packages and application dependencies, **before the push** — so a
known-vulnerable image is caught before it can reach the registry or the
server. Results are also uploaded as SARIF to the repository's Security tab.

The scan is configured with `exit-code: '0'` (report, do not block) and
`continue-on-error: true`. This is a deliberate trade-off for an academic
project: a CVE published overnight in a base image would otherwise block an
unrelated deployment, making the pipeline's behaviour depend on an external
database's contents rather than on this repository's code. A production team
would set `exit-code: '1'` and maintain a reviewed `.trivyignore`. The
rationale is spelled out in [`docs/devops.md`](docs/devops.md).

---

## AWS deployment

Target: a single EC2 instance (`t3.small` or larger recommended; `t2.micro`
works with the swap file the bootstrap script creates) running Ubuntu 22.04+.

```bash
# 1. Bootstrap the instance (once)
scp -i key.pem scripts/ec2-setup.sh ubuntu@<EC2-IP>:~
ssh -i key.pem ubuntu@<EC2-IP> 'bash ~/ec2-setup.sh'

# 2. Add the GitHub Secrets (table below)
# 3. Push to main — the pipeline deploys automatically
```

### Security group

| Port | Source | Why |
|---|---|---|
| 22 | **your IP only** | SSH for administration and the CD pipeline |
| 80 | `0.0.0.0/0` | Public HTTP |
| 443 | `0.0.0.0/0` | Once TLS is configured |
| 5432 | **never** | PostgreSQL is not published — it is reachable only on the internal Docker network |

### Required GitHub Secrets

Settings → Secrets and variables → Actions → *New repository secret*.

| Secret | Example | Used for |
|---|---|---|
| `DOCKERHUB_USERNAME` | `yourname` | Registry login; also the image namespace |
| `DOCKERHUB_TOKEN` | *(access token)* | Registry login — use a token, not your password |
| `EC2_HOST` | `13.234.x.x` | Deployment target |
| `EC2_USER` | `ubuntu` | SSH user |
| `EC2_SSH_KEY` | *(full private key)* | SSH authentication — the entire PEM, including header and footer lines |
| `POSTGRES_USER` | `fintrack` | Database credentials |
| `POSTGRES_PASSWORD` | *(strong password)* | Database credentials |
| `POSTGRES_DB` | `fintrack` | Database name |
| `JWT_SECRET` | `openssl rand -hex 32` | Token signing |

For Amazon ECR instead of Docker Hub you would use `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_REGION` and `ECR_REGISTRY`; the substitution is
documented in [`docs/deployment.md`](docs/deployment.md).

**No secret value appears anywhere in this repository.** They exist only in
GitHub Secrets and, at runtime, in `/opt/fintrack/.env` on the instance
(mode `600`, rewritten on every deploy).

---

## Monitoring and logs

The backend writes **one structured JSON line per request** to stdout:

```json
{"timestamp":"2026-10-03T10:30:12.481Z","level":"info","service":"fintrack-backend",
 "message":"request","method":"POST","route":"/api/transactions","status":201,
 "durationMs":42.18,"userId":7,"ip":"10.0.0.14"}
```

Each line carries the timestamp, HTTP method, route, status code, response time
and — for authenticated calls — the user id. Errors add the stack trace at
`error` level on stderr.

Nothing is written to a file inside the container: container filesystems are
ephemeral, so logs go to stdout where Docker captures them.

```bash
docker logs fintrack-backend              # all logs for the container
docker logs -f --tail 100 fintrack-backend
docker compose logs -f                    # every service, interleaved
docker compose ps                         # health status

# Only errors
docker logs fintrack-backend 2>&1 | grep '"level":"error"'

# Only slow requests (JSON lines parse directly with jq)
docker logs fintrack-backend 2>&1 | jq 'select(.durationMs > 100)'
```

Log volume is capped at 3 × 10 MB per container (`json-file` driver), so a
chatty container cannot fill the instance's root volume.

### Health endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | Full check — returns `"status":"healthy"` and verifies the database round-trip. Returns **503** if PostgreSQL is unreachable |
| `GET /health/live` | Liveness only; does not touch the database |
| `GET /nginx-health` | Proves the edge proxy itself is up |

```bash
curl http://localhost/health
```

```json
{
  "status": "healthy",
  "service": "fintrack-backend",
  "version": "a81f23c",
  "uptimeSeconds": 412,
  "timestamp": "2026-10-03T10:30:12.481Z",
  "checks": { "database": "up" }
}
```

The same endpoint is used by the Dockerfile `HEALTHCHECK`, by Compose's
`depends_on: condition: service_healthy`, and by the CD pipeline's verification
step — one contract, three consumers. `version` reports the deployed image tag,
which is how you confirm from outside the box that a deploy (or a rollback)
actually took effect.

---

## Rollback

Because every image carries an immutable commit-SHA tag, rolling back is
changing one variable and bringing the stack up again — no rebuild, no git
checkout, no `npm install`.

```
Version 2 (b72d91e)
      |
      v
 Deployment fails health check
      |
      v
 IMAGE_TAG=a81f23c
      |
      v
 docker compose up -d
      |
      v
 Health check passes
      |
      v
 Version 1 restored
```

**Automatic** — `cd.yml` records the currently deployed tag *before* touching
anything. If verification fails, it rewrites `IMAGE_TAG` to that value, brings
the stack back up, and re-checks health.

**Manual** — on the instance:

```bash
ssh -i key.pem ubuntu@<EC2-IP>
cd /opt/fintrack

./rollback.sh              # show the current version and the available ones
./rollback.sh a81f23c      # roll back, then verify health automatically
```

Or explicitly:

```bash
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=a81f23c/' .env
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
curl http://localhost/health
```

**The database is not rolled back.** The `pgdata` volume is untouched, which is
correct for additive migrations — older code simply ignores a new nullable
column. A destructive migration (dropping or renaming a column) cannot be
undone this way; see [`docs/deployment.md`](docs/deployment.md) for that case.

---

## Demonstration procedure

The full script, with expected output at each step, is in
[`docs/devops.md`](docs/devops.md). In brief:

**1. Show the running application** — open `http://<EC2-IP>`, log in, show the
dashboard.

**2. Make a visible change.** In `frontend/src/pages/Dashboard.jsx`:

```diff
- FinTrack Dashboard
+ FinTrack — Personal Finance Dashboard
```

```bash
git checkout -b feature/dashboard-heading
git add .
git commit -m "feat: update dashboard heading"
git push -u origin feature/dashboard-heading
```

Open a pull request into `main`, show CI running on the PR, merge it.

**3. Watch the pipeline** in the Actions tab: lint, unit tests, integration
tests and the frontend build run in parallel → Docker build → Trivy scan →
push to Docker Hub → CD pulls on EC2 → migrations → containers replaced →
health check passes.

**4. Refresh the live site.** The new heading is there.

**5. Demonstrate the gate.** Break a test deliberately — in
`backend/tests/unit/financeService.test.js`:

```diff
- expect(finance.calculateTotalIncome(sample)).toBe(120000);
+ expect(finance.calculateTotalIncome(sample)).toBe(90000);
```

Push it. CI goes red at `unit-tests`. `build-images` is **skipped** — no image
is built, nothing is pushed, CD does not run, and the live site is unchanged.
The CD workflow's `blocked` job states this explicitly in the Actions tab.

**6. Fix and push.** CI goes green, the deployment proceeds, the site updates.

**7. Demonstrate rollback.** `./rollback.sh <previous-sha>` on the instance and
show the old heading return.

---

## Screenshots

Capture these into `docs/screenshots/` for the report:

| # | Screenshot | Where |
|---|---|---|
| 1 | Repository home | GitHub |
| 2 | Branch list | GitHub → Branches |
| 3 | Pull request with CI checks | GitHub → Pull requests |
| 4 | **Successful** Actions run (all jobs green) | Actions tab |
| 5 | **Failed** Actions run (tests red, build skipped) | Actions tab |
| 6 | Test output in the logs | Actions → unit-tests job |
| 7 | `docker images` | Terminal |
| 8 | `docker compose ps` showing all healthy | Terminal |
| 9 | `docker compose up -d` output | Terminal |
| 10 | Image tags (`latest` + SHA) | Docker Hub |
| 11 | EC2 instance, running | AWS Console |
| 12 | Security group inbound rules | AWS Console |
| 13 | Deployment logs | Actions → CD job |
| 14 | `curl http://<EC2-IP>/health` | Terminal |
| 15 | Live application dashboard | Browser |
| 16 | Rollback: `./rollback.sh` output + old version live | Terminal + browser |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `JWT_SECRET must be set` on `docker compose up` | No `.env` in the repo root | `cp .env.example .env` and set a value |
| Backend container restarts in a loop | Cannot reach PostgreSQL | `docker compose logs backend`; confirm `DATABASE_URL` uses the **service name** `postgres`, not `localhost` |
| `/health` returns 503 with `"database":"down"` | PostgreSQL is down or still starting | `docker compose ps`; `docker compose logs postgres` |
| Port 80 already in use | Another local web server | Set `HTTP_PORT=8080` in `.env`, then browse to `http://localhost:8080` |
| Browser shows the old version after a deploy | Cached `index.html` | Hard refresh. `frontend/nginx.conf` already sends `no-store` for `index.html` and immutable caching only for fingerprinted assets |
| `npm test` fails with `ECONNREFUSED` | No database for the integration suite | `docker compose up -d postgres` and export `DATABASE_URL` |
| `docker compose build` fails with `rpc error: code = Unavailable desc = error reading from server: EOF` | The BuildKit worker was killed — almost always the host running out of memory, not a problem with the Dockerfile | Give Docker Desktop more memory (Settings → Resources → Memory, 4 GB+), close other heavy applications, then build one service at a time: `docker compose build backend` then `docker compose build frontend` |
| Frontend build hangs or dies during `vite build` | Same cause as above — the Vite/Rollup build is the most memory-hungry step | Build it on its own: `docker compose build frontend`. CI runners have ample memory and are unaffected |
| Jest crashes with `Zone Allocation failed - process out of memory` | Host RAM exhausted, not a test defect | Run the suites separately (`npm run test:unit`, then `npm run test:integration`) or add `node --max-old-space-size=512`. CI runners are unaffected |
| CD fails at `Permission denied (publickey)` | `EC2_SSH_KEY` is incomplete | Paste the **entire** private key, including the `-----BEGIN/END-----` lines |
| CD fails at `docker: permission denied` | Deploy user not in the `docker` group | Re-run `scripts/ec2-setup.sh`, then log out and back in |
| Deploy succeeded but the site is unreachable | Security group | Confirm inbound 80 is open to `0.0.0.0/0` |
| Database data vanished | `docker compose down -v` was run | `-v` deletes the volume. Use plain `down` to preserve it |

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | System and pipeline diagrams, component responsibilities, data model, request lifecycle |
| [`docs/devops.md`](docs/devops.md) | Version control, CI, containerisation, registry, CD, infrastructure, secrets, monitoring, rollback — the rationale for each decision |
| [`docs/testing.md`](docs/testing.md) | Testing strategy, what each suite covers, how to run and extend it |
| [`docs/deployment.md`](docs/deployment.md) | AWS setup step by step, every secret, ECR alternative, rollback runbook, disaster recovery |

---

## Contributors

| Name | Role |
|---|---|
| *(your name)* | Development, DevOps pipeline, documentation |

---

## Licence

Academic demonstration project. Not intended for production use and not a real
financial service.
