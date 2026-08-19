-- v39: Stripe billing columns + plan_status default fix
--
-- Adds the three columns the Stripe checkout/webhook workflow needs to
-- track a company's subscription. Nothing here creates or charges a
-- subscription; it only gives the DB somewhere to record what Stripe
-- reports.
--
-- plan_status defaulted to 'trialing', a leftover from before Free/paid
-- tiers existed. A Free-tier company isn't trialing anything, it's just on
-- the free plan, so the default is now 'active'. Flagged during the
-- 2026-08-18 end-to-end test sweep to be resolved alongside the Stripe
-- build rather than patched separately.
--
-- The two existing companies (Sunset Property Management, Coastal Test
-- Properties) were manually bumped to the 'starter' plan before Stripe
-- existed, to test unit-limit enforcement, and have no real Stripe
-- subscription behind them. Marked 'active' here (grandfathered) and
-- renamed with a TEST suffix so they read unambiguously as test accounts,
-- never as real paying customers, anywhere they show up in the app or an
-- admin view.

SET search_path TO traxkey, public;

ALTER TABLE companies
  ADD COLUMN stripe_customer_id text,
  ADD COLUMN stripe_subscription_id text,
  ADD COLUMN cancelled_at timestamptz;

ALTER TABLE companies
  ALTER COLUMN plan_status SET DEFAULT 'active';

UPDATE companies
SET plan_status = 'active',
    name = name || ' (TEST)'
WHERE id IN ('ad12cc61-1e7b-4a12-b9a6-5f55f7eef41b', '25825bc5-d463-447f-87f9-b7282ef029a8')
  AND name NOT LIKE '%(TEST)';
