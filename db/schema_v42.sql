-- v42: real Suppliers, same shape as invoice_customers (schema_v29)
--
-- ordered_items.supplier used to be free text (schema_v23 deliberately
-- scoped out "no supplier catalogue" - see that file's docstring). That
-- meant no reuse, no per-supplier lateness history, and every order retyped
-- the same name and email. This reverses that scope decision: a supplier is
-- now a real row, referenced by FK, mirroring how invoice_customers already
-- works for the billing side (schema_v29) - a company-level default contact
-- + auto-chase setting, with a nullable per-order override that inherits
-- the supplier's default when left null.

SET search_path TO traxkey, public;

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_email text,
  cc_email text,
  contact_phone text,
  auto_email_enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(name)) > 0),
  UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS suppliers_company_idx ON suppliers (company_id, name);

-- Backfill: one supplier row per distinct name already typed on an ordered
-- item, carrying over the most recently used contact email for that name.
-- ON CONFLICT DO NOTHING since two differently-cased/spaced typings of the
-- same real supplier would otherwise collide on the UNIQUE(company_id, name)
-- constraint - those stay as separate supplier rows post-migration; merging
-- near-duplicate free-text names is an operator cleanup task, not something
-- this migration can safely guess at.
INSERT INTO suppliers (company_id, name, contact_email)
SELECT DISTINCT ON (oi.company_id, oi.supplier)
  oi.company_id, oi.supplier, oi.supplier_email
FROM ordered_items oi
WHERE oi.supplier IS NOT NULL AND length(trim(oi.supplier)) > 0
ORDER BY oi.company_id, oi.supplier, oi.created_at DESC
ON CONFLICT (company_id, name) DO NOTHING;

ALTER TABLE ordered_items ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;

UPDATE ordered_items oi
SET supplier_id = s.id
FROM suppliers s
WHERE s.company_id = oi.company_id AND s.name = oi.supplier AND oi.supplier_id IS NULL;

CREATE INDEX IF NOT EXISTS ordered_items_supplier_idx ON ordered_items (supplier_id) WHERE supplier_id IS NOT NULL;

-- auto_email_enabled becomes an override (null = inherit the supplier's
-- default), same as invoices.auto_email_enabled already works against
-- invoice_customers.auto_email_enabled. Existing rows keep their current
-- explicit true/false rather than being reset to "inherit" - no behavior
-- change for anything already on file.
ALTER TABLE ordered_items ALTER COLUMN auto_email_enabled DROP NOT NULL;
ALTER TABLE ordered_items ALTER COLUMN auto_email_enabled DROP DEFAULT;

-- Free-text supplier name/email are superseded by the supplier_id join.
ALTER TABLE ordered_items DROP COLUMN IF EXISTS supplier;
ALTER TABLE ordered_items DROP COLUMN IF EXISTS supplier_email;
