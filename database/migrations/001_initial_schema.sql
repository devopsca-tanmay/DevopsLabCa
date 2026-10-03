-- 001_initial_schema.sql
-- Idempotent re-statement of database/init.sql so that an existing database
-- (one whose volume was created before init.sql existed) can be brought to the
-- same shape.  Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(120)  NOT NULL,
    email         VARCHAR(255)  NOT NULL UNIQUE,
    password_hash VARCHAR(255)  NOT NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS transactions (
    id               SERIAL PRIMARY KEY,
    user_id          INTEGER        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type             VARCHAR(10)    NOT NULL CHECK (type IN ('income', 'expense')),
    amount           NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    category         VARCHAR(60)    NOT NULL,
    description      TEXT,
    transaction_date DATE           NOT NULL DEFAULT CURRENT_DATE,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date     ON transactions (user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_category ON transactions (user_id, category);
CREATE INDEX IF NOT EXISTS idx_transactions_user_type     ON transactions (user_id, type);

CREATE TABLE IF NOT EXISTS budgets (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    category   VARCHAR(60)    NOT NULL,
    amount     NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    month      SMALLINT       NOT NULL CHECK (month BETWEEN 1 AND 12),
    year       SMALLINT       NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    created_at TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_budget_per_category_month UNIQUE (user_id, category, month, year)
);
CREATE INDEX IF NOT EXISTS idx_budgets_user_period ON budgets (user_id, year, month);
