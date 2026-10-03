# Testing

**142 tests** — 81 unit, 61 integration — all running automatically in CI on
every push and pull request.

- [Strategy](#strategy)
- [Running the tests](#running-the-tests)
- [Unit tests](#unit-tests)
- [Integration tests](#integration-tests)
- [The test harness](#the-test-harness)
- [Tests in CI](#tests-in-ci)
- [Demonstrating that the gate works](#demonstrating-that-the-gate-works)
- [Coverage](#coverage)
- [Adding a test](#adding-a-test)
- [Troubleshooting](#troubleshooting)

---

## Strategy

Two layers, split along a line that makes each one fast at what it does:

```
  +--------------------------------------------------------------+
  |  INTEGRATION  (61 tests)                                      |
  |  supertest -> real Express app -> real PostgreSQL             |
  |                                                               |
  |  Proves the WIRING: routing, auth middleware, validation      |
  |  middleware, SQL, constraints, foreign keys, status codes,    |
  |  cross-user isolation.                                        |
  |  Nothing is mocked.                                           |
  +--------------------------------------------------------------+
  +--------------------------------------------------------------+
  |  UNIT  (81 tests)                                             |
  |  pure functions, no database, no HTTP, no I/O                 |
  |                                                               |
  |  Proves the LOGIC: every finance calculation and every        |
  |  validation rule, including edge cases that are awkward to    |
  |  reach through the API.                                       |
  |  Runs in well under a second.                                 |
  +--------------------------------------------------------------+
```

This split is possible because of one architectural decision:
**`src/services/financeService.js` imports nothing.** Every dashboard
calculation is a pure function of its arguments.

That is what lets the unit suite exhaustively test the arithmetic — zero
income, negative balances, floating-point drift, overspent budgets, missing
budgets — with no database at all, while the integration suite only has to
prove the pieces are connected correctly.

| | Unit | Integration |
|---|---|---|
| Count | 81 | 61 |
| Needs PostgreSQL | No | Yes |
| Runtime | < 1 s | ~10 s |
| CI job | `unit-tests` | `integration-tests` |
| Covers | `financeService`, `validators` | Routes, controllers, models, middleware, SQL |

---

## Running the tests

```bash
cd backend

npm run test:unit          # 81 tests, no setup required
npm run test:integration   # 61 tests, needs a database
npm test                   # everything
npm run test:coverage      # with a coverage report
```

### Setting up the database for integration tests

```bash
# From the repository root
docker compose up -d postgres

cd backend
export DATABASE_URL="postgresql://fintrack:<your-password>@localhost:5432/fintrack"
export JWT_SECRET="any-value-for-tests"
npm run test:integration
```

Or point at a throwaway container on a non-standard port, so your development
data is never touched:

```bash
docker run -d --name fintrack-test-pg \
  -e POSTGRES_USER=fintrack -e POSTGRES_PASSWORD=fintrack \
  -e POSTGRES_DB=fintrack_test \
  -p 55432:5432 postgres:16-alpine

cd backend
DATABASE_URL="postgresql://fintrack:fintrack@localhost:55432/fintrack_test" \
  npm run test:integration

docker rm -f fintrack-test-pg
```

---

## Unit tests

### `tests/unit/financeService.test.js` — 39 tests

| Group | What it checks |
|---|---|
| Income and expense totals | Sums the right rows; `0` not `NaN` on an empty ledger; coerces numeric strings from `NUMERIC` columns; `0.1 + 0.2` returns `0.3`; malformed rows ignored rather than thrown |
| Savings rate | `(income − expenses) / income`; `100%` when nothing is spent; **`0` not `Infinity` when income is zero**; clamped at `−100` when overspending |
| Category breakdown | Groups expenses, ignores income, sorts descending, percentages sum to 100 |
| Monthly trend | Buckets into `YYYY-MM` ascending; keeps the most recent N months; skips unparseable dates |
| Budget usage | Spent / remaining / percentage; `warning` at ≥ 80%; `over` past 100% with a negative remaining; the progress bar caps at 100 while the percentage does not; income never counts against a budget |
| Budget adherence | `100` when respected; decays with overspend; **`null`** when no budgets exist |
| Expense growth | Compares the two most recent months; `0` with one month of history; negative when spending falls |
| Health score | Band mapping; clamped to 0–100; budget weight redistributed when no budgets exist; carries the not-financial-advice disclaimer |
| `buildDashboard` | Returns every section; totals agree with the individual functions; a new account yields a valid empty dashboard; works with no arguments at all |

The dashboard figures are pinned to the exact values in the project
specification — ₹120,000 income, ₹35,000 expenses, ₹85,000 balance, 70.83%
savings rate — so a regression in the arithmetic fails loudly.

### `tests/unit/validators.test.js` — 42 tests

| Group | Notable cases |
|---|---|
| Email | Accepts subdomains and `+tag`; rejects missing `@`, missing TLD, embedded spaces, non-strings |
| Password | ≥ 8 characters; ≤ 128; rejects non-strings |
| Amount | Positive only; at most 2 decimals (`10.555` rejected); numeric strings accepted; `Infinity` and `NaN` rejected |
| Transaction type | Only `income` / `expense`; `"Income"` rejected (case-sensitive) |
| Date | **Rejects `2026-02-31` and `2025-02-29`** — real calendar validation, not a regex; accepts `2024-02-29` |
| Month / year | 1–12, 2000–2100; rejects fractions |
| Payload validators | Report **every** problem at once rather than stopping at the first; survive `{}` and `undefined` without throwing |

---

## Integration tests

Every test drives the real Express app through Supertest against real
PostgreSQL. Nothing is mocked.

### `tests/integration/auth.test.js` — 11 tests

- Registers a user and returns a JWT
- **Never returns the password or its hash** — asserts the plaintext does not
  appear anywhere in the response body
- Duplicate email → **409**
- Invalid payload → **400** listing all three problems
- Login succeeds with correct credentials
- Wrong password → **401**
- **Unknown email and wrong password return byte-identical responses**, so the
  endpoint cannot be used to enumerate registered addresses
- Email matching is case-insensitive
- `GET /me` returns the current user; rejects a missing header; rejects a
  forged token

### `tests/integration/transactions.test.js` — 21 tests

| Area | Cases |
|---|---|
| Create | Returns 201 with an id; defaults `transaction_date` to today; rejects negative amounts and unsupported types; requires auth |
| List | Returns all for the user; newest first; filters by type, category and date range; rejects an invalid filter; **returns nothing for a different user** |
| Get one | By id; 404 for a non-existent id |
| Update | Persists the change (verified by re-reading); **404 when the row belongs to another user**; 400 on an invalid payload |
| Delete | Removes the row (verified by re-reading); 404 for a non-existent id; **another user's delete returns 404 and the row survives** |

Cross-user isolation is tested on **read, update and delete** — the most
security-relevant property in the application.

### `tests/integration/budgets.test.js` — 12 tests

Create, list, update, delete; filtering by month/year; the
`UNIQUE (user_id, category, month, year)` constraint surfacing as **409**; the
same category allowed in a different month; cross-user isolation.

### `tests/integration/dashboard.test.js` — 8 tests

- Requires authentication
- A brand new account returns a complete, zeroed dashboard rather than an error
- Summary totals match the seeded ledger exactly
- Categories ranked largest first
- Budget usage correctly joins the Food budget against actual Food spending
- Health score present, in range, with its disclaimer
- Monthly trend present and shaped correctly
- **One user's dashboard is unaffected by another user's data**

### `tests/integration/health.test.js` — 9 tests

The `/health` contract is covered explicitly because three separate systems
depend on its exact shape — the Dockerfile `HEALTHCHECK`, Compose's
`depends_on: service_healthy`, and the CD pipeline's verification step. If its
shape changed silently, deployments would start failing for a reason that looks
unrelated.

- 200 with `"status":"healthy"` and `"service":"fintrack-backend"`
- Reports `checks.database` explicitly
- Includes uptime and a parseable timestamp
- Requires **no** authentication
- `/health/live` answers without touching the database
- `GET /api` lists the endpoints
- An unknown route returns a clean JSON 404, not an HTML error page
- Malformed JSON returns 400 rather than crashing the process
- The server does not advertise its framework (`x-powered-by` absent)

---

## The test harness

`tests/helpers/setup.js` handles the lifecycle:

```js
beforeAll(async () => { await helpers.createSchema(); });   // applies database/init.sql
beforeEach(async () => { await helpers.resetDatabase(); }); // TRUNCATE ... RESTART IDENTITY
afterAll(async () => { await helpers.closeDatabase(); });   // closes the pg pool
```

Design points:

- **The schema comes from `database/init.sql`** — the same file production
  uses. The tests therefore run against the real schema, including every
  `CHECK`, `UNIQUE` and foreign key. A hand-written test schema would let a
  constraint bug through.
- **`TRUNCATE ... RESTART IDENTITY CASCADE` between tests** — each test starts
  from a known-empty database with predictable ids, so tests cannot leak state
  into one another and can run in any order.
- **`BCRYPT_ROUNDS=4` in tests** — bcrypt is intentionally slow. Production
  uses 10; the test value keeps the suite fast without changing any behaviour
  under test.
- **`registerTestUser()`** registers through the real API, so every test starts
  from a genuinely authenticated state rather than a hand-forged token.
- **`--runInBand`** — tests share one database, so they run serially.

---

## Tests in CI

`.github/workflows/ci.yml` runs both suites on **every push and pull request**.

```
  push / pull_request
         |
   +-----+-----+-----------+--------------+
   |           |           |              |
  lint    unit-tests  integration-  build-frontend
                         tests
   |           |           |              |
   +-----+-----+-----+-----+--------------+
                     |
          needs: [all four]  <-- THE GATE
                     |
              build-images
```

The integration job gets a real PostgreSQL service container:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_USER: fintrack
      POSTGRES_PASSWORD: fintrack
      POSTGRES_DB: fintrack_test
    options: >-
      --health-cmd "pg_isready -U fintrack -d fintrack_test"
      --health-interval 10s
      --health-retries 5
```

GitHub Actions will not start the job's steps until that health check passes,
so the suite never races the database's first boot.

**If any test fails:** `build-images` is skipped → no image is built → nothing
is pushed → CD never runs → production is untouched.

The coverage report is uploaded as an artifact with `if: always()`, so it is
available even when a test failed — which is exactly when it is most useful.

---

## Demonstrating that the gate works

Break a test on purpose:

```diff
  // backend/tests/unit/financeService.test.js
- expect(finance.calculateTotalIncome(sample)).toBe(120000);
+ expect(finance.calculateTotalIncome(sample)).toBe(90000);
```

```bash
git checkout -b fix/demonstrate-ci-gate
git commit -am "test: introduce a failing assertion to demonstrate the CI gate"
git push -u origin fix/demonstrate-ci-gate
```

CI output:

```
  ● financeService - income and expense totals
    › calculateTotalIncome sums only income rows

    expect(received).toBe(expected)

    Expected: 90000
    Received: 120000

  Tests: 1 failed, 80 passed, 81 total
```

```
  unit-tests        FAILED
         |
         X
  build-images      SKIPPED
         |
         X  no image built
         X  nothing pushed to the registry
         X  CD never runs
         |
         v
  Production UNCHANGED
```

Then revert the assertion, push, and watch the whole chain run green through to
deployment.

---

## Coverage

```bash
cd backend
npm run test:coverage
open coverage/lcov-report/index.html
```

Coverage is **measured and reported, not enforced as a percentage threshold**.
A coverage number is easy to inflate with tests that execute code without
asserting anything meaningful. What matters here is that the parts carrying
real risk — the finance maths, the validators, auth, and cross-user isolation —
are covered by tests that assert specific, correct values.

---

## Adding a test

**A new calculation** → `tests/unit/financeService.test.js`. Keep the function
pure, and cover the empty input, the zero case and the boundary.

**A new endpoint** → a file in `tests/integration/`. At minimum assert:

1. the success path returns the right status and body
2. an invalid payload returns 400
3. an unauthenticated request returns 401
4. **another user's data is not reachable** (404, not 403)

```js
const helpers = require('../helpers/setup');
const request = require('supertest');
const app = require('../../src/app');

describe('My feature', () => {
  let auth;

  beforeAll(async () => { await helpers.createSchema(); });
  beforeEach(async () => {
    await helpers.resetDatabase();
    const user = await helpers.registerTestUser(request, app);
    auth = helpers.authHeader(user.token);
  });
  afterAll(async () => { await helpers.closeDatabase(); });

  test('does the thing', async () => {
    const res = await request(app).get('/api/my-feature').set(auth);
    expect(res.status).toBe(200);
  });
});
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:5432` | No database running | `docker compose up -d postgres` |
| `password authentication failed` | `DATABASE_URL` does not match the container's credentials | Check `.env` and the exported variable |
| `relation "users" does not exist` | Schema not applied | `createSchema()` runs in `beforeAll` — check `database/init.sql` is readable |
| Tests pass alone but fail together | Shared state | Confirm `resetDatabase()` is in `beforeEach`, and that `--runInBand` is set |
| `Jest did not exit one second after…` | The pg pool is still open | `--forceExit` is already set in the npm scripts |
| `FATAL ERROR: Zone Allocation failed - process out of memory` | **Host RAM exhausted — not a test defect** | Run the suites separately, or `node --max-old-space-size=512 node_modules/jest/bin/jest.js …`. CI runners have ample memory and are unaffected |
| Integration tests fail only in CI | Database not ready | The service container's `--health-cmd` already gates this; check the job log for the postgres container's status |
