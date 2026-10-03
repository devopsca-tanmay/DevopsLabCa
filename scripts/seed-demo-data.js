#!/usr/bin/env node
'use strict';

/**
 * Seeds a demo account with realistic data, so the dashboard and the
 * screenshots in docs/ show something meaningful rather than empty states.
 *
 * It talks to the REST API over HTTP - it does not touch the database
 * directly. That means it exercises the same code path a real user does, and
 * it works against any running instance: local compose, or the EC2 deployment.
 *
 *   node scripts/seed-demo-data.js                        # http://localhost
 *   node scripts/seed-demo-data.js http://<EC2-IP>        # a deployment
 *
 * The seeded figures are the ones used throughout the documentation:
 *   income 120,000 · expenses 35,000 · balance 85,000 · savings rate ~71%
 *
 * Safe to re-run: if the demo account already exists it logs in instead of
 * failing, though transactions will then accumulate.
 */

const BASE = (process.argv[2] || 'http://localhost').replace(/\/$/, '');

const DEMO_USER = {
  name: 'Demo User',
  email: 'demo@fintrack.local',
  password: 'demo-password-123',
};

// Two months of history so the income-vs-expenses chart has a trend to draw
// and the expense-growth component of the health score is meaningful.
const now = new Date();
const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

function day(monthStart, dayOfMonth) {
  const d = new Date(monthStart);
  d.setUTCDate(dayOfMonth);
  return d.toISOString().slice(0, 10);
}

const TRANSACTIONS = [
  // ---- previous month ----
  { type: 'income', amount: 95000, category: 'Salary', description: 'Monthly salary', transaction_date: day(lastMonth, 1) },
  { type: 'expense', amount: 18000, category: 'Rent', description: 'Rent', transaction_date: day(lastMonth, 3) },
  { type: 'expense', amount: 7200, category: 'Food', description: 'Groceries and eating out', transaction_date: day(lastMonth, 8) },
  { type: 'expense', amount: 3400, category: 'Transport', description: 'Fuel and cabs', transaction_date: day(lastMonth, 12) },
  { type: 'expense', amount: 5100, category: 'Bills', description: 'Electricity and internet', transaction_date: day(lastMonth, 15) },
  { type: 'expense', amount: 2800, category: 'Entertainment', description: 'Streaming and cinema', transaction_date: day(lastMonth, 20) },

  // ---- current month: totals 120,000 in / 35,000 out ----
  { type: 'income', amount: 100000, category: 'Salary', description: 'Monthly salary', transaction_date: day(thisMonth, 1) },
  { type: 'income', amount: 20000, category: 'Freelance', description: 'Freelance project', transaction_date: day(thisMonth, 6) },
  { type: 'expense', amount: 8000, category: 'Food', description: 'Groceries', transaction_date: day(thisMonth, 4) },
  { type: 'expense', amount: 4000, category: 'Transport', description: 'Commute', transaction_date: day(thisMonth, 7) },
  { type: 'expense', amount: 6500, category: 'Shopping', description: 'Clothing', transaction_date: day(thisMonth, 11) },
  { type: 'expense', amount: 9500, category: 'Bills', description: 'Utilities and phone', transaction_date: day(thisMonth, 14) },
  { type: 'expense', amount: 7000, category: 'Entertainment', description: 'Concert tickets', transaction_date: day(thisMonth, 18) },
];

// Deliberately mixed outcomes so the dashboard shows all three budget states:
// Food 8000/10000 = 80% warning, Transport 4000/5000 = 80% warning,
// Shopping 6500/5000 = 130% over, Bills 9500/12000 = 79% ok.
const BUDGETS = [
  { category: 'Food', amount: 10000 },
  { category: 'Transport', amount: 5000 },
  { category: 'Shopping', amount: 5000 },
  { category: 'Bills', amount: 12000 },
  { category: 'Entertainment', amount: 8000 },
].map((b) => ({
  ...b,
  month: now.getUTCMonth() + 1,
  year: now.getUTCFullYear(),
}));

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${method} ${path} returned non-JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }

  return { status: response.status, body: parsed };
}

async function main() {
  console.log(`Seeding demo data into ${BASE}\n`);

  // --- Confirm the API is actually up before doing anything else ----------
  const health = await call('/health');
  if (health.status !== 200 || health.body.status !== 'healthy') {
    throw new Error(
      `API is not healthy at ${BASE}/health (HTTP ${health.status}). ` +
        'Start the stack first: docker compose up -d'
    );
  }
  console.log(`  API healthy (version ${health.body.version || 'dev'}, database ${health.body.checks?.database})`);

  // --- Account ------------------------------------------------------------
  let token;
  const registered = await call('/api/auth/register', { method: 'POST', body: DEMO_USER });

  if (registered.status === 201) {
    token = registered.body.token;
    console.log(`  Registered ${DEMO_USER.email}`);
  } else if (registered.status === 409) {
    const loggedIn = await call('/api/auth/login', {
      method: 'POST',
      body: { email: DEMO_USER.email, password: DEMO_USER.password },
    });
    if (loggedIn.status !== 200) {
      throw new Error(
        `The demo account exists but the password did not match. ` +
          `Delete the user or use a fresh database.`
      );
    }
    token = loggedIn.body.token;
    console.log(`  Demo account already existed - logged in instead`);
  } else {
    throw new Error(`Registration failed (HTTP ${registered.status}): ${JSON.stringify(registered.body)}`);
  }

  // --- Transactions -------------------------------------------------------
  let created = 0;
  for (const transaction of TRANSACTIONS) {
    const result = await call('/api/transactions', { method: 'POST', body: transaction, token });
    if (result.status === 201) created += 1;
    else console.warn(`  ! transaction rejected (HTTP ${result.status}): ${JSON.stringify(result.body)}`);
  }
  console.log(`  Created ${created}/${TRANSACTIONS.length} transactions`);

  // --- Budgets ------------------------------------------------------------
  let budgets = 0;
  for (const budget of BUDGETS) {
    const result = await call('/api/budgets', { method: 'POST', body: budget, token });
    if (result.status === 201) budgets += 1;
    // 409 simply means this budget was seeded on an earlier run.
    else if (result.status !== 409) {
      console.warn(`  ! budget rejected (HTTP ${result.status}): ${JSON.stringify(result.body)}`);
    }
  }
  console.log(`  Created ${budgets}/${BUDGETS.length} budgets`);

  // --- Show the resulting dashboard --------------------------------------
  const dashboard = await call('/api/dashboard', { token });
  if (dashboard.status === 200) {
    const s = dashboard.body.summary;
    const h = dashboard.body.healthScore;
    console.log('\n  Dashboard now reads:');
    console.log(`    Total balance   ${s.balance.toLocaleString('en-IN')}`);
    console.log(`    Total income    ${s.totalIncome.toLocaleString('en-IN')}`);
    console.log(`    Total expenses  ${s.totalExpenses.toLocaleString('en-IN')}`);
    console.log(`    Savings rate    ${s.savingsRate}%`);
    console.log(`    Health score    ${h.score}/100 (${h.rating})`);
  }

  console.log(`\nDone. Log in at ${BASE} with:`);
  console.log(`  email:    ${DEMO_USER.email}`);
  console.log(`  password: ${DEMO_USER.password}`);
}

main().catch((err) => {
  console.error(`\nSeeding failed: ${err.message}`);
  process.exit(1);
});
