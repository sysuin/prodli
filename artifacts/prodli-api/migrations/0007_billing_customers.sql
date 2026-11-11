-- ProdLi Pro moves from Paddle to Dodo Payments (src/billing.ts). Each user who
-- starts a checkout gets a Dodo customer; this links it to the ProdLi account so
-- webhooks can be matched even without metadata.
CREATE TABLE IF NOT EXISTS billing_customers (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'dodo',
  customer_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
