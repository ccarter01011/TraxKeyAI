-- TraxKey AI — schema v23: ordered items
--
-- The one idea worth taking from TraxSail AI, narrowed hard.
--
-- TraxSail chases purchase orders with suppliers. Full procurement (multi
-- line POs, terms, EDI) does not belong in property management and porting
-- it would make TraxKey unfocused while it is still catching up on core
-- features. But the SHAPE of the problem is identical and does occur here:
-- something was ordered, it has an expected date, the supplier slips, and
-- there is a consequence.
--
-- Here the consequence is concrete and costs money: a water heater or a box
-- of flooring that arrives late is a unit that is not ready, which is either
-- a vacant night or a guest arriving into a half-finished turn.
--
-- Scope limit: this tracks an item, an expected date, and what it blocks.
-- It is not procurement. No terms, no approvals workflow, no supplier
-- catalogue, no invoices.

SET search_path TO traxkey;

CREATE TABLE ordered_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  description text NOT NULL,
  supplier text,
  reference text,                      -- order or PO number, free text
  cost numeric(10,2),

  ordered_on date NOT NULL DEFAULT CURRENT_DATE,
  expected_on date,
  received_on date,

  -- What it blocks. Both nullable: an item can be stock for no particular
  -- job. When either is set, lateness has a real deadline to be late against.
  unit_id uuid REFERENCES units(id) ON DELETE SET NULL,
  turn_id uuid REFERENCES turns(id) ON DELETE SET NULL,
  maintenance_request_id uuid REFERENCES maintenance_requests(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('ordered', 'received', 'cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK (length(trim(description)) > 0),
  CHECK (received_on IS NULL OR received_on >= ordered_on)
);

CREATE INDEX ordered_items_company_idx ON ordered_items (company_id, status);
-- The query that matters: what is outstanding and late.
CREATE INDEX ordered_items_late_idx ON ordered_items (expected_on)
  WHERE status = 'ordered';
CREATE INDEX ordered_items_turn_idx ON ordered_items (turn_id) WHERE turn_id IS NOT NULL;
