-- v36: align plan codes with the tier names customers actually see
--
-- Found during end-to-end testing on 2026-08-18. The database and the
-- published pricing page disagreed on what two of the four tiers are called:
--
--     database        marketing (traxkey.ai/#pricing)
--     --------        ------------------------------
--     trial           Free
--     starter         Starter
--     growth          Growth
--     scale           Pro
--
-- Prices already matched ($0 / $99 / $249 / $549); only the names drifted.
--
-- This is being fixed now specifically because Stripe subscription billing
-- is the next piece of work. Wiring price IDs means mapping a customer-facing
-- tier name to a stored plan code, and "Pro" silently meaning 'scale' is
-- exactly the kind of mismatch that puts a paying customer on the wrong tier
-- and is painful to unpick afterwards. Cheaper to reconcile before that work
-- than during it.
--
-- The database moves rather than the marketing copy: the pricing page is
-- public, indexed and already linked to, while these codes are internal and
-- referenced in three places (this constraint, admin_concierge.PLAN_PRICES,
-- and the n8n admin metrics query).
--
-- NOT changed here: plan_status still defaults to 'trialing', so a Free-tier
-- account reads as plan='free', plan_status='trialing'. That is odd — the
-- pricing page says "no trial clock, free stays free at 1 unit" — and it
-- makes the admin dashboard's "On trial" count meaningless, since every new
-- signup lands in it. Left alone deliberately: whether paid tiers get a real
-- trial window is a billing decision that belongs with the Stripe work, not
-- a rename.

SET search_path TO traxkey, public;

-- Constraint first: the new values would violate the old CHECK.
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_plan_check;

UPDATE companies SET plan = 'free' WHERE plan = 'trial';
UPDATE companies SET plan = 'pro'  WHERE plan = 'scale';

ALTER TABLE companies ADD CONSTRAINT companies_plan_check
  CHECK (plan IN ('free', 'starter', 'growth', 'pro'));

-- Signup (n8n TraxKey-01-Auth "Create Company + Owner User") does not set
-- plan explicitly, so the column default is what every new account gets.
ALTER TABLE companies ALTER COLUMN plan SET DEFAULT 'free';
