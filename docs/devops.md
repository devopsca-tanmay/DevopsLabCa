# DevOps

How code becomes a running application, and why each decision was made that way.

- [1. Version control](#1-version-control)
- [2. Continuous integration](#2-continuous-integration)
- [3. Containerisation](#3-containerisation)
- [4. Registry](#4-registry)
- [5. Image security scanning](#5-image-security-scanning)
- [6. Continuous deployment](#6-continuous-deployment)
- [7. Infrastructure](#7-infrastructure)
- [8. Secrets management](#8-secrets-management)
- [9. Monitoring, logging and health checks](#9-monitoring-logging-and-health-checks)
- [10. Rollback](#10-rollback)
- [11. Demonstration script](#11-demonstration-script)

---

## 1. Version control

### Branching model

```
  feature/auth ---------+
  feature/transactions -+
  feature/budgets ------+---> develop ---> main ---> Production
  feature/dashboard ----+        ^           |
  devops/docker --------+        |           +--> CD deploys
  devops/cicd ----------+        |
                                 |
                          integration branch:
                          CI runs, images push,
                          but nothing deploys
```

| Branch | Purpose | CI | Images pushed | Deploys |
|---|---|---|---|---|
| `main` | Production. Always deployable | Yes | Yes | **Yes** |
| `develop` | Integration of completed features | Yes | Yes | No |
| `feature/*` | One feature at a time | Yes | No | No |
| `devops/*` | Pipeline and infrastructure work | Yes | No | No |

Branches in this repository:

```
main
develop
feature/auth
feature/transactions
feature/budgets
feature/dashboard
devops/docker
devops/cicd
```

### Workflow

```
  git checkout develop
  git checkout -b feature/transactions
  ... work ...
  git commit -m "feat: add transaction API"
  git push -u origin feature/transactions
        |
        v
  Pull request -> develop
        |
    CI runs on the PR
        |
   green? --no--> fix and push again
        |
       yes
        |
      merge
        |
  develop -> PR -> main
        |
    CI runs again
        |
       merge
        |
    CD deploys to EC2
```

### Commit convention

Conventional-commit prefixes make history scannable and group related work:

```
feat:   a user-visible capability      feat: add budget management
fix:    a defect repair                fix: resolve transaction validation
test:   tests only                     test: add transaction integration tests
build:  build/packaging                build: add backend Dockerfile
ci:     CI pipeline                    ci: add automated testing workflow
cd:     deployment pipeline            cd: add EC2 deployment
docs:   documentation                  docs: add architecture diagram
chore:  housekeeping                   chore: add gitignore
```

### What is deliberately never committed

`.gitignore` blocks all of these, and it was the project's first commit —
before any secret could exist to be committed by accident:

```
.env            node_modules/     *.pem
.env.*          dist/             *.key
AWS creds       coverage/         docker-credentials.json
```

Only `.env.example` is tracked — the documented template, with placeholder
values.

> **If a secret is ever committed, rotate it.** Deleting it in a later commit
> does not remove it from history, and GitHub's history is public on a public
> repository. Rotate the credential, then clean history if needed.

### Branch protection on `main`

Settings → Branches → Add rule for `main`:

- Require a pull request before merging
- Require status checks to pass: `Lint`, `Unit tests`, `Integration tests`,
  `Build frontend`
- Require branches to be up to date before merging
- Do not allow bypassing the above

Effect: broken code **cannot** reach `main`, and since CD triggers only on
`main`, it cannot reach production.

```
  Feature branch -> Pull request -> CI -> Tests pass -> Merge -> main -> CD
                                     |
                                   fail
                                     |
                              merge is blocked
```

---

## 2. Continuous integration

**File:** `.github/workflows/ci.yml` · **Triggers:** every `push` and
`pull_request`

### Job graph

```
  push / pull_request
         |
   +-----+-----+-----------+--------------+
   |           |           |              |
   v           v           v              v
 lint    unit-tests  integration-   build-frontend
                        tests
   |           |           |              |
   +-----+-----+-----+-----+--------------+
                     |
          needs: [all four]
                     |
                     v
              build-images
         docker build -> trivy -> push
```

The first four jobs are independent, so they run **in parallel** — a lint error
surfaces in about 30 seconds instead of after a five-minute serial chain.

`build-images` declares `needs: [lint, unit-tests, integration-tests,
build-frontend]`. **That one line is the quality gate.** If any job is red,
`build-images` is skipped: no image is built, nothing reaches the registry, and
CD — which keys off CI's conclusion — never starts.

### Stages

| Stage | Command | Fails when |
|---|---|---|
| Checkout | `actions/checkout@v4` | — |
| Set up Node | `actions/setup-node@v4` with npm cache | — |
| Install | `npm ci` | The lockfile and `package.json` disagree |
| Lint | `npm run lint` (both apps) | Any ESLint error |
| Unit tests | `npm run test:unit` | Any of 81 tests fails |
| Integration tests | `npm run test:integration` | Any of 61 tests fails |
| Frontend build | `npm run build` | The bundle does not compile |
| Docker build | `docker/build-push-action` | Either Dockerfile fails |
| Security scan | Trivy | *(reports; see §5)* |
| Push | `docker/build-push-action` | Registry rejects the push |

### Why `npm ci` and not `npm install`

`npm ci` installs **exactly** what `package-lock.json` pins and fails if the
lockfile is out of sync with `package.json`. `npm install` may silently resolve
newer versions, which means CI could test a different dependency set than the
one that ships. Reproducibility is the whole point.

### The PostgreSQL service container

```yaml
services:
  postgres:
    image: postgres:16-alpine
    options: >-
      --health-cmd "pg_isready -U fintrack -d fintrack_test"
      --health-interval 10s
      --health-retries 5
```

GitHub Actions starts this alongside the job and **will not run the steps until
the health check passes** — so the test suite never races the database's first
boot. The integration tests then run against real PostgreSQL with nothing
mocked, which is what makes them meaningful: they exercise the actual SQL, the
`CHECK` constraints, the `UNIQUE` constraint and the foreign keys.

### Caching

`actions/setup-node` caches `~/.npm` keyed on the lockfiles, and the Docker
builds use GitHub Actions cache (`cache-from: type=gha`). Repeat runs that do
not change dependencies skip most of the install and build work.

---

## 3. Containerisation

### Why Docker here

| Problem | How containers solve it |
|---|---|
| "Works on my machine" | The image carries the OS packages, the Node runtime and the dependencies. The thing that ran in CI is the thing that runs on EC2 |
| Deployment drift | The artifact is immutable. Nothing is installed or compiled on the server |
| Dependency conflicts | Each service has its own filesystem |
| Slow, risky rollback | Re-running a previous image is seconds, not a rebuild |
| Onboarding | `docker compose up -d` instead of a page of setup instructions |

### Backend image

Build context is the **repository root** — the image needs
`database/migrations/` as well as `backend/`, and a `COPY` can never reach
outside its context.

```
Stage deps   node:20-alpine
             COPY package.json package-lock.json   <- manifests FIRST
             npm ci --omit=dev                     <- cached layer

Stage test   full dependencies + source + tests    <- CI only, never shipped

Stage final  node:20-alpine
             COPY --from=deps node_modules
             COPY src, database
             USER node                             <- non-root
             HEALTHCHECK curl /health
             CMD ["node", "src/server.js"]         <- exec form
```

Decisions worth naming:

- **Manifests copied before source.** Docker caches layers; copying
  `package.json` first means an ordinary source edit does not re-run
  `npm install`.
- **`--omit=dev`.** Jest, ESLint and Supertest have no business in a runtime
  image — less to ship, smaller attack surface.
- **Alpine.** ~130 MB instead of ~1.1 GB. Smaller images push and pull faster,
  which directly shortens both deployment and rollback time.
- **Non-root `USER node`.** If a container is compromised, the attacker starts
  as an unprivileged user rather than root.
- **Exec-form `CMD`.** Node becomes PID 1 and receives `SIGTERM` directly, so
  `server.js` can drain in-flight requests during a deploy. The shell form
  would swallow the signal.
- **`HEALTHCHECK`.** Docker, Compose and the CD pipeline all read the resulting
  status.

### Frontend image

```
Stage build  node:20-alpine -> npm ci -> vite build -> /app/dist
Stage serve  nginx:1.27-alpine -> serves /app/dist
```

**The React dev server is never used in production.** Vite's dev server is an
unoptimised development tool. The shipped image contains no Node.js runtime at
all — only pre-built static files and nginx, which is why it is ~50 MB.

`VITE_API_URL` is a **build argument**, not a runtime variable, because Vite
inlines `import.meta.env` at build time. It defaults to the relative path
`/api`, so no backend hostname is ever compiled in and one image works
everywhere.

### Compose: two files, one deliberate difference

| | `docker-compose.yml` | `docker-compose.prod.yml` |
|---|---|---|
| Images | **`build:`** from source | **`image:`** pulled from the registry |
| Where | Developer machine | EC2 |
| Postgres port | `127.0.0.1:5432` | **not published** |
| Restart policy | `unless-stopped` | `always` |
| Log caps | default | `3 × 10 MB` per container |

The production file has **no `build:` key anywhere**, and that is the point:

```
  Build in CI  ->  Store artifact in registry  ->  Deploy that artifact
```

rather than

```
  SSH in  ->  git pull  ->  npm install  ->  npm build     <-- NOT this
```

Building on the server would produce a *different* artifact from the one the
tests passed against, and would make deployment depend on the npm registry
being reachable at deploy time.

### Health-ordered startup

```yaml
depends_on:
  postgres:
    condition: service_healthy
```

`condition: service_healthy` waits for the health check to pass, not merely for
the container to exist. That removes the classic "backend crashed because the
database wasn't ready" race without a single `sleep`.

### Persistence

```yaml
volumes:
  pgdata:
    name: fintrack-pgdata
```

A named volume outlives container replacement. Every deploy destroys and
recreates the containers; `pgdata` is untouched, so data survives deploys and
rollbacks alike. Only `docker compose down -v` destroys it.

---

## 4. Registry

Amazon ECR is the artifact store. Every CI build on `main`/`develop` pushes two
tags pointing at the same image:

```
<registry>/fintrack-backend:latest      moving pointer — convenience
<registry>/fintrack-backend:a81f23c     immutable — the commit SHA
<registry>/fintrack-frontend:latest
<registry>/fintrack-frontend:a81f23c

<registry> = <account>.dkr.ecr.ap-south-1.amazonaws.com
```

**Why the SHA tag matters.** `latest` means "whatever was built most recently",
which is useless for rollback — it changes under you. `a81f23c` identifies one
exact build forever, so:

- "Which version is live?" has an exact answer (`GET /health` reports it)
- "Go back to the version that worked" is unambiguous
- The image that was tested is provably the image that is running

```
  deploy v2 (b72d91e)  ->  fails  ->  IMAGE_TAG=a81f23c  ->  up -d  ->  restored
```

### Authentication without stored keys

CI assumes the `fintrack-github-actions` IAM role with GitHub's OIDC token
(`aws-actions/configure-aws-credentials` + `aws-actions/amazon-ecr-login`).
The role's trust policy only accepts this repository's `main` and `develop`
pushes and the `production` environment, so a pull request cannot push.
The EC2 instance pulls with its own read-only instance profile. The full flow
is in [`deployment.md`](deployment.md#how-ecr-authentication-works).

---

## 5. Image security scanning

```
  Build image  ->  Trivy scan  ->  review findings  ->  Push to registry
```

Trivy inspects a built image for known vulnerabilities in:

- OS packages from the Alpine base layer
- application dependencies in `node_modules`

It runs **after the build but before the push**, so a known-vulnerable image is
caught before it can reach the registry — let alone the server. Findings are
also uploaded as SARIF and appear in the repository's **Security** tab.

### Purpose

Dependencies are the largest practical attack surface in a Node application.
A transitive package three levels down can carry a critical CVE that no one on
the team has heard of. Scanning makes that visible on **every commit**, as a
normal part of the build, rather than during an incident.

### Configuration, and an honest trade-off

```yaml
severity: CRITICAL,HIGH
ignore-unfixed: true
exit-code: '0'          # report, do not fail the build
continue-on-error: true
```

- `ignore-unfixed: true` — a vulnerability with no available patch is noise in
  a gate. It cannot be acted on today.
- `exit-code: '0'` — findings are **reported, not blocking**.
- `continue-on-error: true` — a Trivy CDN outage cannot break an unrelated
  deployment.

This is a deliberate choice for an academic project. With `exit-code: '1'`, a
CVE published overnight in `node:20-alpine` would block a deployment of code
that did not change, and the pipeline's behaviour would depend on an external
database's contents rather than on this repository — making the build
non-reproducible and the demonstration fragile.

**A production team should set `exit-code: '1'`** and maintain a reviewed
`.trivyignore` with a documented justification and expiry per entry. The
mechanism is identical; only the threshold changes.

---

## 6. Continuous deployment

**File:** `.github/workflows/cd.yml`

### The gate

```yaml
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
    branches: [main]

jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success'
```

CD cannot run unless CI finished **successfully on `main`**. A failing test
leaves CI red, `conclusion != 'success'`, and the deploy job never starts. The
companion `blocked` job runs in that case and writes an explicit note in the
Actions summary, so the gate is *visible* rather than an unexplained absence.

### Sequence

```
 1. Checkout the exact commit CI tested (workflow_run.head_sha)
 2. Resolve the image tag (that commit's SHA)
 3. Install the SSH key from GitHub Secrets (ephemeral, runner-only)
 4. RECORD THE CURRENTLY DEPLOYED TAG     <- the rollback target
 5. scp compose file, nginx config, SQL   <- NOT application source
 6. SSH:
      write /opt/fintrack/.env from Secrets (umask 077)
      docker login
      docker compose pull                 <- pre-built, CI-tested images
      start postgres, wait for healthy
      npm run migrate                     <- before new code takes traffic
      docker compose up -d
      docker image prune (keeps tagged images, incl. the rollback target)
 7. VERIFY
 8. On failure -> automatic rollback -> re-verify
```

Step 4 is what makes step 8 possible, and it happens **before** anything is
touched.

### Verification — the part that makes it a deployment rather than a hope

Running the commands is not success. Three checks define it:

```
  1. Container health
     every container reports "healthy" (or "running"), with a 30-attempt
     timeout; on failure the backend logs are dumped into the job output

  2. Application health, from OUTSIDE the instance
     GET http://<EC2-HOST>/health  must return "status":"healthy"
     -> proves security group + nginx + backend + postgres all work.
        A check from inside the box would prove none of that.
     and                            must return "database":"up"
     -> an API that is up but cannot reach its database is a failed deploy
     The response also reports "version", confirming the NEW image is serving

  3. Frontend
     GET http://<EC2-HOST>/  must return 200
```

Any failure fails the job, which triggers the rollback step.

### Why SSH deployment

For a single-instance academic demonstration, SSH is the right level of
complexity: it is transparent, every step is visible in the workflow log, and
it needs no additional AWS services. The production-grade alternatives — ECS,
CodeDeploy, a blue/green ALB target group swap — add managed infrastructure
that would obscure the pipeline rather than illuminate it.

---

## 7. Infrastructure

Single EC2 instance, Ubuntu 22.04+, `t3.small` recommended (`t2.micro` works
with the 2 GB swap file `scripts/ec2-setup.sh` creates).

```
  EC2 instance
    Docker Engine + Compose v2      <- installed from Docker's apt repo,
                                       not Ubuntu's (which ships compose v1)
    /opt/fintrack/                  <- deploy directory, mode 750
      docker-compose.prod.yml
      nginx/nginx.conf
      database/
      .env                          <- mode 600, rewritten each deploy
    4 containers + 1 volume
```

### Security group

| Port | Source | Rationale |
|---|---|---|
| 22 | **administrator IP only** | SSH. Open to `0.0.0.0/0` invites constant brute force |
| 80 | `0.0.0.0/0` | Public HTTP |
| 443 | `0.0.0.0/0` | Once TLS is configured |
| 5432 | **never opened** | PostgreSQL publishes no port at all — the compose file has no `ports:` for it, so it is unreachable from outside regardless of the security group |

Two independent layers keep the database private: no published port, and no
firewall rule. Either alone would be sufficient; both is correct.

### Disk protection

Containers write logs forever by default, and a full root volume takes down the
whole stack in a way that is confusing to debug. Two caps:

- `logging: max-size 10m, max-file 3` per container in the compose file
- `docker image prune -f --filter "until=168h"` after each deploy — removes
  untagged layers while keeping tagged images, including the rollback target

---

## 8. Secrets management

### The rule

**No secret value exists anywhere in this repository**, in any branch, in any
commit, in any history.

### Where each value lives

| Environment | Source | Protection |
|---|---|---|
| Local | `.env` in the repo root | Gitignored. `.env.example` is the committed template |
| CI | Throwaway literals in `ci.yml` | They secure nothing — a test database that exists for 90 seconds |
| Production | GitHub Secrets → `/opt/fintrack/.env` | Encrypted at rest by GitHub, masked in logs, written with `umask 077` |

### Required GitHub Secrets

| Secret | Purpose | How to obtain |
|---|---|---|
| `AWS_ROLE_ARN` | IAM role assumed via OIDC to push to / resolve ECR | Output of `scripts/aws-provision.sh` |
| `EC2_HOST` | Deployment target | EC2 console → public IPv4 |
| `EC2_USER` | SSH user | `ubuntu` on Ubuntu AMIs |
| `EC2_SSH_KEY` | SSH authentication | The **entire** `.pem`, including `-----BEGIN/END-----` lines |
| `POSTGRES_USER` | Database | Your choice |
| `POSTGRES_PASSWORD` | Database | `openssl rand -base64 24` |
| `POSTGRES_DB` | Database | `fintrack` |
| `JWT_SECRET` | Token signing | `openssl rand -hex 32` |

For ECR, add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
`ECR_REGISTRY`.

### How they reach the application

```
  GitHub Secrets  (encrypted, never printed)
        |
        |  injected as env vars into the workflow run
        v
  cd.yml  ->  ssh  ->  cat > /opt/fintrack/.env   (umask 077, mode 600)
        |
        v
  docker compose reads .env
        |
        v
  container environment
        |
        v
  src/config/env.js validates at boot — refuses to start if one is missing
```

GitHub masks secret values in workflow logs automatically. `env.js` failing
fast at boot means a misconfigured container fails its health check
immediately, rather than erroring on the first user request.

### Additional safeguards

- Passwords are stored as **bcrypt hashes only** — the column is
  `password_hash`, and `userModel` selects it exclusively for the login
  comparison.
- The login endpoint returns an identical response for "unknown email" and
  "wrong password", so it cannot be used to enumerate registered addresses.
- `errorHandler` never sends a stack trace in production.
- Every SQL query is parameterised — no user input is ever interpolated into
  SQL text.

---

## 9. Monitoring, logging and health checks

### Structured logging

One JSON line per request, to stdout:

```json
{"timestamp":"2026-10-03T10:30:12.481Z","level":"info","service":"fintrack-backend",
 "message":"request","method":"POST","route":"/api/transactions","status":201,
 "durationMs":42.18,"userId":7,"ip":"10.0.0.14"}
```

Carrying: timestamp · method · route · status · response time · user id · IP.
Errors add the stack at `error` level on stderr.

Design choices:

- **stdout, never a file.** Container filesystems are ephemeral; a log file
  inside a container disappears with it. Docker captures stdout, so
  `docker logs` just works.
- **JSON, not free text.** Any future log shipper (CloudWatch, Loki, ELK) can
  parse it with no application change, and `jq` works today.
- **`/health` logs at `debug`.** Docker polls it every 30 s; at `info` it would
  bury real traffic.
- **No dependency.** The logger is ~30 lines. Winston or Pino would be the
  production choice; here, fewer dependencies means a smaller image and less to
  scan.

### Viewing logs

```bash
docker logs fintrack-backend
docker logs -f --tail 100 fintrack-backend
docker compose logs -f
docker compose ps

docker logs fintrack-backend 2>&1 | grep '"level":"error"'
docker logs fintrack-backend 2>&1 | jq 'select(.durationMs > 100)'
docker logs fintrack-backend 2>&1 | jq 'select(.status >= 400)'
```

### Health checks — one endpoint, three consumers

| Consumer | How it uses `/health` |
|---|---|
| Dockerfile `HEALTHCHECK` | Sets the container's health status |
| Compose `depends_on` | Gates dependent services on `service_healthy` |
| CD pipeline | **Fails the deployment** if it does not return healthy |

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

It **verifies the database round-trip** (`SELECT 1`) rather than just answering
200 — a backend that cannot reach PostgreSQL is not serving, and should not be
reported as healthy. If the database is unreachable it returns **503** with
`"status":"unhealthy"`, which both Docker and the CD verification step treat as
a failure.

`GET /health/live` is liveness only (no database), and `GET /nginx-health`
proves the edge proxy is up independently of the backend.

---

## 10. Rollback

### Why it is simple here

Because images carry immutable SHA tags, rollback is changing one variable:

```
  Version 2 (b72d91e)
        |
        v
  Deployment fails health check
        |
        v
  IMAGE_TAG = a81f23c
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

No rebuild. No `git checkout`. No `npm install`. The previous image is still in
the registry — and usually still in the instance's local cache — byte for byte
as it was when it was healthy.

### Automatic

`cd.yml` records the deployed tag before touching anything. On verification
failure it rewrites `IMAGE_TAG`, brings the stack up, and re-checks health,
reporting either `::notice::Rollback successful` or an explicit call for manual
intervention.

### Manual

```bash
ssh -i key.pem ubuntu@<EC2-IP>
cd /opt/fintrack

./rollback.sh                # current version + available versions
./rollback.sh a81f23c        # roll back and verify
```

Or by hand:

```bash
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=a81f23c/' .env
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
curl http://localhost/health
```

Or from GitHub: **Actions → CD → Run workflow**, entering the tag.

### Version bookkeeping

| Question | Where to look |
|---|---|
| What is live? | `curl http://<host>/health` → `version` |
| What was live before? | `/opt/fintrack/.env.before-rollback`, or the CD job summary |
| What can I roll back to? | `./rollback.sh` with no arguments, or the ECR image list |

### The limit, stated plainly

**The database is not rolled back.** The `pgdata` volume is untouched. That is
correct for additive migrations — older code ignores a new nullable column.

It is **not** sufficient for a destructive migration (dropping or renaming a
column): the old image would query a column that no longer exists. For those,
either write a reversing migration or restore from a `pg_dump` backup. See
`docs/deployment.md`.

---

## 11. Demonstration script

### Part 1 — a successful deployment

**Show the current state.** Open `http://<EC2-IP>`, log in, show the dashboard
heading: *"FinTrack Dashboard"*.

**Make the change.** In `frontend/src/pages/Dashboard.jsx`:

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

Open a PR into `main`. Show CI running **on the pull request**, and the merge
button blocked until checks pass. Merge it.

**Follow the pipeline** in the Actions tab:

```
  lint · unit-tests · integration-tests · build-frontend   (parallel, green)
            |
       build-images
            |
     docker build (backend + frontend)
            |
        Trivy scan
            |
     push :latest and :<sha>
            |
          CD starts
            |
   ssh -> pull -> migrate -> up -d
            |
   container health -> /health -> frontend 200
            |
     Deployment successful
```

**Refresh the live site.** The new heading is there.

Point out: *nobody logged into the server; nothing was built on it; the exact
image the tests passed against is the image now serving.*

### Part 2 — the gate (the important half)

**Break a test deliberately.** In
`backend/tests/unit/financeService.test.js`:

```diff
- expect(finance.calculateTotalIncome(sample)).toBe(120000);
+ expect(finance.calculateTotalIncome(sample)).toBe(90000);
```

```bash
git checkout -b fix/demonstrate-ci-gate
git commit -am "test: introduce a failing assertion to demonstrate the CI gate"
git push -u origin fix/demonstrate-ci-gate
```

**Show what happens:**

```
  GitHub Actions
        |
        v
    unit-tests
        |
        X  FAILED
        |
        Expected: 90000
        Received: 120000
        |
        v
  build-images  -> SKIPPED
        |
        X  no image built
        X  nothing pushed to the registry
        X  CD never runs
        |
        v
  Production is UNCHANGED
```

Refresh the live site — still the previous version, serving normally. Then show
the CD workflow's `blocked` job stating the deployment was intentionally
skipped.

**Fix it:**

```bash
git commit -am "fix: correct the expected income total"
git push
```

CI green → build → scan → registry → deploy → health check → live.

### Part 3 — rollback

```bash
ssh -i key.pem ubuntu@<EC2-IP>
cd /opt/fintrack
./rollback.sh                # note the current SHA, pick the previous one
./rollback.sh <previous-sha>
```

Watch it pull, recreate, and verify health. Refresh the browser — the old
heading is back. Then roll forward again to leave the demo in its final state.

### What to emphasise

| Point | Evidence to show |
|---|---|
| Tests gate deployment | The failed run with `build-images` skipped |
| The artifact is immutable | ECR showing both `latest` and the SHA tag |
| Nothing is built on the server | `docker-compose.prod.yml` has no `build:` key |
| Deployment is verified, not assumed | The health-check step in the CD log |
| Rollback is fast and documented | `./rollback.sh` running live |
| Secrets are never in the repo | `.gitignore` + the GitHub Secrets page |
| Data survives deployment | Transactions still present after the deploy |
