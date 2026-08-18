-- v38: unit limits per plan tier
--
-- Found during end-to-end testing on 2026-08-18: nothing enforced unit
-- counts. A Free account, advertised as "your first unit", accepted six units
-- with no limit, warning, or prompt. The pricing page sells tiers by unit
-- count and the product ignored that entirely.
--
-- The limits live here rather than in application code because unit creation
-- happens in exactly one place (the n8n Insert Unit node) while the numbers
-- are read in several (the guard, the Properties page usage meter, the admin
-- view). One definition keeps them from drifting the way the plan names did
-- before schema_v36.
--
-- Limits are the top of each published band on traxkey.ai/#pricing:
--   Free    1 unit
--   Starter 2-15    -> 15
--   Growth  16-50   -> 50
--   Pro     51-150  -> 150
--
-- An unknown plan returns NULL, which company_can_add_unit treats as
-- unlimited. Failing open is deliberate: a plan code this function has not
-- been taught about should never be the thing that stops a paying customer
-- from adding a unit. A limit that is too loose is a billing conversation; a
-- limit that is wrongly too tight is a support ticket and a churned account.

SET search_path TO traxkey, public;

CREATE OR REPLACE FUNCTION traxkey.plan_unit_limit(p_plan text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_plan
           WHEN 'free'    THEN 1
           WHEN 'starter' THEN 15
           WHEN 'growth'  THEN 50
           WHEN 'pro'     THEN 150
           ELSE NULL
         END;
$$;

COMMENT ON FUNCTION traxkey.plan_unit_limit(text) IS
  'Max units for a plan, matching the bands published on traxkey.ai/#pricing. '
  'NULL means no enforced limit.';

CREATE OR REPLACE FUNCTION traxkey.company_unit_count(p_company_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT count(u.id)::int
  FROM traxkey.units u
  JOIN traxkey.properties p ON p.id = u.property_id
  WHERE p.company_id = p_company_id;
$$;

CREATE OR REPLACE FUNCTION traxkey.company_can_add_unit(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    traxkey.company_unit_count(p_company_id)
      < traxkey.plan_unit_limit((SELECT plan FROM traxkey.companies WHERE id = p_company_id)),
    true   -- unknown plan or no limit: allow
  );
$$;

COMMENT ON FUNCTION traxkey.company_can_add_unit(uuid) IS
  'False when the company is at its plan unit limit. Enforced in the n8n '
  'Insert Unit node, which is the only write path for units.';
