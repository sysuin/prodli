-- ProdLi Pro: one subscription per user, kept up to date by Paddle's webhooks
-- (see src/billing.ts). users.plan is set from it ('pro' while active).
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'paddle',
  subscription_id TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL,      -- Paddle: active | trialing | past_due | paused | canceled
  price_id TEXT,
  billing_interval TEXT,     -- month | year
  period_end INTEGER,        -- end of the current billing period (ms)
  cancel_at INTEGER,         -- a scheduled cancellation takes effect then (ms), or NULL
  event_at INTEGER NOT NULL, -- occurred_at of the last event applied (ms), to ignore stale ones
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS subscriptions_customer ON subscriptions (customer_id);
