-- ===========================================================================
-- FinTrack - database bootstrap
-- ---------------------------------------------------------------------------
-- This file is mounted into /docker-entrypoint-initdb.d/ in the postgres
-- container.  Postgres runs every .sql file in that directory exactly once,
-- the first time the data volume is empty.  Because the volume is persistent
-- (pgdata), re-running `docker compose up` does NOT re-run this script.
--
-- For schema evolution after the first boot use database/migrations/*.sql,
-- applied by the backend's migration runner (`npm run migrate`).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(120)  NOT NULL,
    email         VARCHAR(255)  NOT NULL UNIQUE,
    -- bcrypt hash only. Plain-text passwords are never stored or logged.
    password_hash VARCHAR(255)  NOT NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Lookup on every login request.
CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
    id               SERIAL PRIMARY KEY,
    user_id          INTEGER        NOT NULL
                       REFERENCES users (id) ON DELETE CASCADE,
    type             VARCHAR(10)    NOT NULL
                       CHECK (type IN ('income', 'expense')),
    amount           NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    category         VARCHAR(60)    NOT NULL,
    description      TEXT,
    transaction_date DATE           NOT NULL DEFAULT CURRENT_DATE,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- The dashboard and the history screen both filter by user + date range.
CREATE INDEX IF NOT EXISTS idx_transactions_user_date
    ON transactions (user_id, transaction_date DESC);
-- Category breakdown chart.
CREATE INDEX IF NOT EXISTS idx_transactions_user_category
    ON transactions (user_id, category);
-- Income-vs-expense aggregation.
CREATE INDEX IF NOT EXISTS idx_transactions_user_type
    ON transactions (user_id, type);

-- ---------------------------------------------------------------------------
-- budgets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budgets (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER        NOT NULL
                 REFERENCES users (id) ON DELETE CASCADE,
    category   VARCHAR(60)    NOT NULL,
    amount     NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    month      SMALLINT       NOT NULL CHECK (month BETWEEN 1 AND 12),
    year       SMALLINT       NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    created_at TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    -- One budget per category per month per user.
    CONSTRAINT uq_budget_per_category_month
        UNIQUE (user_id, category, month, year)
);

CREATE INDEX IF NOT EXISTS idx_budgets_user_period
    ON budgets (user_id, year, month);

-- ---------------------------------------------------------------------------
-- schema_migrations - tracks which migration files have been applied
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
