-- v29: ordered-item email prefs + invoice/AR tracking
--
-- TraxKey tracks and chases; it never moves funds. Invoices here carry an
-- amount so the operator can see what is outstanding, but there is no
-- payment processing, no trust accounting, and no card ever touches this.
-- Marking an invoice paid is a bookkeeping note the operator makes.

SET search_path TO traxkey, public;

-- Ordered items: who else to copy on a supplier nudge, and whether to nudge
-- at all. Null cc_email means nobody copied; auto_email_enabled off means the
-- operator chases this one by hand.
ALTER TABLE ordered_items ADD COLUMN IF NOT EXISTS cc_email text;
ALTER TABLE ordered_items ADD COLUMN IF NOT EXISTS auto_email_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE ordered_items ADD COLUMN IF NOT EXISTS supplier_email text;
ALTER TABLE ordered_items ADD COLUMN IF NOT EXISTS chase_count integer NOT NULL DEFAULT 0;
ALTER TABLE ordered_items ADD COLUMN IF NOT EXISTS last_chased_at timestamptz;

CREATE INDEX IF NOT EXISTS ordered_items_chase_idx
  ON ordered_items (status, last_chased_at)
  WHERE status = 'ordered' AND auto_email_enabled;

-- Customers an invoice can be billed to. Separate from residents/owners on
-- purpose: an operator may bill an owner, a resident, or an outside party.
CREATE TABLE IF NOT EXISTS invoice_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  cc_email text,
  auto_email_enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_customers_company_idx
  ON invoice_customers (company_id, name);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES invoice_customers(id) ON DELETE CASCADE,
  invoice_number text NOT NULL,
  amount numeric(12,2) NOT NULL,
  issued_on date NOT NULL DEFAULT CURRENT_DATE,
  due_on date NOT NULL,
  paid_on date,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','paid','cancelled')),
  -- Per-invoice override of the customer default. Null means inherit.
  cc_email text,
  auto_email_enabled boolean,
  chase_count integer NOT NULL DEFAULT 0,
  last_chased_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_unique
  ON invoices (company_id, invoice_number);
CREATE INDEX IF NOT EXISTS invoices_company_idx
  ON invoices (company_id, status, due_on);
CREATE INDEX IF NOT EXISTS invoices_chase_idx
  ON invoices (status, due_on, last_chased_at)
  WHERE status = 'open';

-- Per-company override of the chase cadence, same pattern as
-- companies.chase_after_hours and cost_approval_threshold. Null = code default.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS invoice_chase_after_days integer;
