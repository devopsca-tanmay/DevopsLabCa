# Architecture

- [Full pipeline diagram](#full-pipeline-diagram)
- [Runtime architecture](#runtime-architecture)
- [Local development topology](#local-development-topology)
- [AWS production topology](#aws-production-topology)
- [Component responsibilities](#component-responsibilities)
- [Backend layering](#backend-layering)
- [Data model](#data-model)
- [Request lifecycle](#request-lifecycle)
- [Network and trust boundaries](#network-and-trust-boundaries)

---

## Full pipeline diagram

```
                              Developer
                                  |
                              git commit
                                  |
                                  v
                                 Git
                            (feature branch)
                                  |
                              git push
                                  |
                                  v
                               GitHub
                                  |
                          pull request -> develop -> main
                                  |
                                  v
                          GitHub Actions (CI)
                                  |
          +-----------+-----------+-----------+-----------+
          |           |           |           |
          v           v           v           v
       Lint      Unit tests  Integration  Frontend
     (backend +  (no DB,      tests        build
      frontend)   pure fns)  (PostgreSQL   (vite)
                             service)
          |           |           |           |
          +-----------+-----+-----+-----------+
                            |
                     ALL FOUR GREEN?
                            |
              no  <---------+---------> yes
               |                         |
               v                         v
        PIPELINE STOPS            Docker Build
        - no image built                |
        - nothing pushed         +------+------+
        - CD never runs          |             |
        - production untouched   v             v
                           Frontend        Backend
                            image           image
                               |             |
                               +------+------+
                                      |
                                      v
                              Security Scan
                                 (Trivy)
                            CRITICAL + HIGH
                                      |
                                      v
                              Docker Registry
                               (Docker Hub)
                                      |
                        tags: :latest  +  :<commit-sha>
                                      |
                                      v
                          GitHub Actions (CD)
                      (workflow_run, only if CI == success)
                                      |
                                 SSH to EC2
                                      |
                        write .env from GitHub Secrets
                                      |
                              docker compose pull
                                      |
                             run DB migrations
                                      |
                              docker compose up -d
                                      |
                                      v
                                AWS EC2 Instance
                                      |
                                    Nginx
                                   /     \
                                  /       \
                                 v         v
                            Frontend     Backend
                            container    container
                                             |
                                             v
                                        PostgreSQL
                                         container
                                             |
                                        pgdata volume
                                      |
                                      v
                              Health Verification
                      containers healthy + /health + / returns 200
                                      |
                     pass <-----------+-----------> fail
                      |                               |
                      v                               v
              Deployment Successful          Automatic Rollback
                                            IMAGE_TAG = previous SHA
                                            docker compose up -d
                                            re-verify health
```

---

## Runtime architecture

```
                            Internet
                               |
                               |  :80 (the only open application port)
                               v
                     +-------------------+
                     |   Nginx (edge)    |   reverse proxy
                     +-------------------+
                               |
                 +-------------+--------------+
                 |  /                         |  /api
                 v                            v
     +-----------------------+    +-----------------------+
     |  Frontend container   |    |  Backend container    |
     |  nginx + static build |    |  Node.js + Express    |
     |  (no Node at runtime) |    |  non-root user        |
     +-----------------------+    +-----------------------+
                                              |
                                              |  postgres:5432
                                              v
                                  +-----------------------+
                                  |  PostgreSQL container |
                                  |  no published port    |
                                  +-----------------------+
                                              |
                                              v
                                     +-----------------+
                                     | pgdata volume   |  persistent
                                     +-----------------+

     All four containers share the private bridge network `fintrack-net`
     and address each other by service name via Docker's embedded DNS.
```

**Why nginx sits in front of both.** The browser only ever talks to one origin.
That means:

- The React bundle calls `/api/...` as a **relative** path, so no backend
  hostname is compiled into it and the same image works in every environment.
- CORS is a non-issue in production — same origin.
- The backend needs no published port, so it cannot be reached from the
  internet at all.

---

## Local development topology

```
                        Docker Compose
                   (docker-compose.yml — BUILDS from source)
                              |
       +----------------+-----+------+----------------+
       |                |            |                |
       v                v            v                v
    nginx           frontend      backend         postgres
   :80 -> host    built image   built image    pgdata volume
                                                 :5432 -> 127.0.0.1 only

   Startup order is enforced by health, not by sleep:
       postgres  --(healthy: pg_isready)-->  backend
       backend   --(healthy: /health)   -->  nginx
       frontend  --(healthy: GET /)     -->  nginx
```

One command brings the whole thing up:

```bash
docker compose up -d
```

---

## AWS production topology

```
                            Internet
                               |
                               v
        +----------------------------------------------+
        |  Security Group                              |
        |    22  <- administrator IP only              |
        |    80  <- 0.0.0.0/0                          |
        |   443  <- 0.0.0.0/0 (once TLS is configured) |
        |  5432  <- NOT OPEN. Not published at all.    |
        +----------------------------------------------+
                               |
                               v
        +----------------------------------------------+
        |  AWS EC2 Instance (Ubuntu 22.04+)            |
        |                                              |
        |   /opt/fintrack/                             |
        |     docker-compose.prod.yml   <- synced by CD|
        |     nginx/nginx.conf          <- synced by CD|
        |     database/                 <- synced by CD|
        |     .env                      <- written by CD from Secrets (0600)
        |                                              |
        |   +--------------------------------------+   |
        |   |  Nginx container        :80 -> host  |   |
        |   +--------------------------------------+   |
        |             |                    |           |
        |             v                    v           |
        |   +-----------------+  +------------------+  |
        |   | Frontend        |  | Backend          |  |
        |   | (pulled image)  |  | (pulled image)   |  |
        |   +-----------------+  +------------------+  |
        |                                 |            |
        |                                 v            |
        |                        +------------------+  |
        |                        | PostgreSQL       |  |
        |                        +------------------+  |
        |                                 |            |
        |                        +------------------+  |
        |                        | pgdata volume    |  |
        |                        | survives deploys |  |
        |                        +------------------+  |
        +----------------------------------------------+
```

**The application source code is never on the instance.** Only the compose
file, the nginx config and the SQL are synced. The application itself arrives
as pre-built images pulled from the registry — the exact artifacts CI tested.

---

## Component responsibilities

| Component | Responsibility | Does **not** do |
|---|---|---|
| **Edge nginx** | TLS termination point, routing `/` and `/api`, security headers, rate limiting on `/api/auth/` | Serve files itself; hold application state |
| **Frontend container** | Serve the compiled React bundle, SPA fallback, asset cache headers | Run Node; talk to the database |
| **Backend container** | REST API, JWT issue/verify, validation, SQL, dashboard aggregation | Serve HTML; store session state |
| **PostgreSQL container** | Durable storage, constraints, indexes | Business logic (no stored procedures) |
| **pgdata volume** | Survive container replacement | Get recreated on deploy |

---

## Backend layering

```
  HTTP request
       |
       v
  routes/          declares the path + which middleware runs
       |
       v
  middleware/      authenticate -> validate -> (handler) -> errorHandler
       |
       v
  controllers/     reads req, calls models/services, shapes the response
       |
       +-------------------+
       |                   |
       v                   v
  models/            services/
  parameterised      financeService —
  SQL only           PURE functions,
       |             no db, no req
       v
  config/db.js       pg connection pool
       |
       v
  PostgreSQL
```

The rule that matters: **`services/financeService.js` imports nothing.** Every
dashboard calculation — totals, savings rate, category grouping, monthly trend,
budget usage, health score — is a pure function of its arguments.

That is why the unit suite (81 tests) runs in under a second with no database,
and why the integration suite only needs to prove the *wiring*, not re-test the
arithmetic.

---

## Data model

```
  +---------------------------+
  |  users                    |
  +---------------------------+
  |  id            SERIAL  PK |
  |  name          VARCHAR    |
  |  email         VARCHAR UQ |
  |  password_hash VARCHAR    |   <- bcrypt only, never plain text
  |  created_at    TIMESTAMPTZ|
  +---------------------------+
          |                |
          | 1:N            | 1:N
          |  ON DELETE     |  ON DELETE
          |  CASCADE       |  CASCADE
          v                v
  +----------------------+   +--------------------------+
  |  transactions        |   |  budgets                 |
  +----------------------+   +--------------------------+
  | id          SERIAL PK|   | id         SERIAL     PK |
  | user_id     FK ----->|   | user_id    FK -----------|
  | type        CHECK    |   | category   VARCHAR       |
  |   income|expense     |   | amount     NUMERIC  > 0  |
  | amount      NUMERIC>0|   | month      1..12         |
  | category    VARCHAR  |   | year       2000..2100    |
  | description TEXT     |   | created_at TIMESTAMPTZ   |
  | transaction_date DATE|   +--------------------------+
  | created_at  TIMESTAMPTZ|   UNIQUE (user_id, category, month, year)
  | updated_at  TIMESTAMPTZ|   <- added by migration 002
  +----------------------+
```

### Indexes and why each exists

| Index | Supports |
|---|---|
| `idx_users_email` on `LOWER(email)` | Every login — case-insensitive lookup |
| `idx_transactions_user_date` | History screen and date-range filters |
| `idx_transactions_user_category` | Category breakdown chart |
| `idx_transactions_user_type` | Income-vs-expense aggregation |
| `idx_budgets_user_period` | Dashboard budget join for the current month |

### Constraints that enforce correctness in the database

- `type IN ('income','expense')` — the API validates this too, but the database
  is the last line of defence.
- `amount > 0` on both tables — a negative transaction is expressed by `type`,
  never by a negative number.
- `UNIQUE (user_id, category, month, year)` on budgets — one budget per
  category per month. A duplicate raises SQLSTATE `23505`, which the error
  handler maps to **409 Conflict** rather than a 500.
- `ON DELETE CASCADE` — deleting a user removes their data, with no orphan rows.

### Schema evolution

`database/init.sql` runs **once**, when the postgres data directory is empty.
It never re-runs on an existing volume. Everything after that is a numbered
file in `database/migrations/`, applied by `npm run migrate`:

- forward-only, in filename order
- each inside its own transaction, so a failure leaves no partial schema
- recorded in `schema_migrations`, so re-running is a no-op

CD runs migrations **before** the new containers take traffic, using the new
image — so the migration code always matches the application code.

---

## Request lifecycle

Tracing `POST /api/transactions` end to end:

```
 1. Browser          axios POST /api/transactions
                     Authorization: Bearer <jwt>
                           |
 2. Edge nginx       matches /api/ -> proxy to backend:5000
                     adds X-Forwarded-For, X-Real-IP
                           |
 3. requestLogger    starts a high-resolution timer
                           |
 4. authenticate     verifies the JWT signature and expiry
                     sets req.user = { id, email }
                     invalid -> 401, never reaches the controller
                           |
 5. validate         validateTransaction(req.body) — a PURE function
                     invalid -> 400 with every problem listed at once
                           |
 6. controller       transactionController.create
                           |
 7. model            INSERT ... VALUES ($1,$2,...) RETURNING ...
                     scoped to req.user.id — parameterised, never
                     string-interpolated
                           |
 8. PostgreSQL       CHECK constraints enforce type and amount
                           |
 9. response         201 { transaction: {...} }
                           |
10. requestLogger    on 'finish': writes one JSON line with method,
                     route, status, durationMs, userId
                           |
11. errorHandler     (only if anything threw) ApiError -> its status;
                     anything else -> generic 500, stack logged
                     server-side, never sent to the client
```

**Cross-user isolation** is enforced at step 7, not in the controller: every
query carries `WHERE user_id = $n`. A valid token for user A simply cannot
match user B's rows, and a request for someone else's transaction returns 404
(not 403) so the API cannot be used to confirm that another user's record id
exists.

---

## Network and trust boundaries

```
  ===================== UNTRUSTED (the internet) =====================
                               |
                               |  only :80 / :443
                               v
  --------------------- EDGE (nginx container) ----------------------
    - terminates the public connection
    - adds security headers, rate-limits /api/auth/
    - the only container with a published port
                               |
  ------------------ INTERNAL (fintrack-net bridge) ------------------
    frontend:80        backend:5000        postgres:5432
    - no published ports
    - reachable only by service name from inside the network
    - a container escape is required to reach postgres at all
                               |
  --------------------------- STATE ----------------------------------
    pgdata volume — the only thing that survives a deploy
```

| Boundary | Control |
|---|---|
| Internet → edge | Security group: 22 (admin IP), 80, 443. Nothing else |
| Edge → backend | Internal network only; backend publishes no port |
| Backend → database | Internal network only; credentials from env, never in code |
| Client → API | JWT required on every route except `/health` |
| User → user's data | Every query scoped by `user_id` |
| Container → host | Backend runs as the non-root `node` user |
| Repo → secrets | `.env` and `*.pem` are gitignored; real values only in GitHub Secrets |
