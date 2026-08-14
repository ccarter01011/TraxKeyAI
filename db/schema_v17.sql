-- TraxKey AI — schema v17: Business Memory
--
-- Per-business rules the AI obeys. This is what "the AI learns my business"
-- actually means here: durable rows in Postgres read as facts, not model
-- fine-tuning and not model-side memory. Same discipline as everywhere else,
-- deterministic SQL decides, the LLM only ever classifies free text.
--
-- The seed already existed: companies.cost_approval_threshold is per-company
-- AI behaviour stored in a column. This generalises it to per-trade,
-- per-property, and per-unit, and adds the other rules operators actually ask
-- for.
--
-- HARD RULE, enforced by the CHECK below: rule_type is restricted to the four
-- kinds the engine genuinely enforces. Letting an operator save a rule the
-- code silently ignores would be worse than not having the feature, they
-- would believe a guardrail exists where none does. Adding a rule_type here
-- means adding its enforcement in agents/graph.py in the same change.

SET search_path TO traxkey;

CREATE TABLE business_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  rule_type text NOT NULL CHECK (rule_type IN (
    -- Dollar ceiling for auto-dispatch. Overrides
    -- companies.cost_approval_threshold for its scope. value = amount.
    'approval_threshold',
    -- Force a human decision regardless of cost. value = 'true'.
    'always_require_approval',
    -- No auto-dispatch inside this local-time window.
    -- value = 'HH:MM-HH:MM', evaluated in companies.timezone.
    'quiet_hours',
    -- This vendor gets the job for its trade regardless of ranking.
    -- value = vendors.id. Still subject to the approval rules above.
    'preferred_vendor'
  )),

  -- What the rule applies to. More specific scopes win, see
  -- agents/business_memory.py resolve() for the precedence order.
  scope text NOT NULL DEFAULT 'global'
    CHECK (scope IN ('global', 'trade', 'property', 'unit')),
  -- Trade name for scope='trade', a uuid as text for property/unit,
  -- NULL for global.
  scope_ref text,

  value text NOT NULL,
  -- Why the operator set it. Shown back to them, and to the concierge, so a
  -- rule set in March still makes sense in November.
  note text,

  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- A global rule has nothing to point at; every other scope must.
  CHECK ((scope = 'global' AND scope_ref IS NULL)
      OR (scope <> 'global' AND scope_ref IS NOT NULL))
);

-- One rule per (type, target). Re-setting a rule updates it rather than
-- stacking a second contradictory row, which would make behaviour depend on
-- row order.
CREATE UNIQUE INDEX business_memory_unique_target
  ON business_memory (company_id, rule_type, scope, COALESCE(scope_ref, ''));

CREATE INDEX business_memory_company_idx ON business_memory (company_id);
