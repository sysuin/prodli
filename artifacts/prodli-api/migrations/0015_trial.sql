-- 14-day Pro trial for new accounts (reverse trial: full Pro, no card, then the
-- free plan). Set once when the account is created; existing accounts stay NULL.
-- users.plan stays 'free' during the trial: the effective plan is computed in
-- src/accounts.ts (toUser), so a trial never looks like a subscription.
ALTER TABLE users ADD COLUMN trial_ends_at INTEGER;
