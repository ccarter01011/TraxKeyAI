-- TraxKey AI — schema v18: Inspections
--
-- Move-in, move-out, and periodic condition records. The gap this closes:
-- turns already track vacant-to-ready and maintenance already dispatches
-- repairs, but nothing recorded what condition a unit was actually in. That
-- is the evidence a deposit dispute turns on, and without it the operator is
-- arguing from memory.
--
-- Deliberate scope limit, and it matters: TraxKey records condition and
-- surfaces differences between a move-in and a move-out. It does NOT compute
-- what to withhold from a deposit, and it never will. Deposit deductions are
-- governed by state law with strict itemisation and timing rules that vary by
-- jurisdiction, and getting one wrong is a real legal liability for the
-- operator. Same reasoning that keeps trust accounting out of the product.
-- Evidence, not adjudication.

SET search_path TO traxkey;

CREATE TABLE inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,

  inspection_type text NOT NULL CHECK (inspection_type IN ('move_in', 'move_out', 'periodic', 'turn')),

  -- Links the condition record to the tenancy it belongs to, which is what
  -- makes a move-in and move-out comparable later. Nullable: a periodic
  -- inspection or an STR turn has no lease.
  lease_id uuid REFERENCES leases(id) ON DELETE SET NULL,
  -- Links to the turn it was done as part of, when it was.
  turn_id uuid REFERENCES turns(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),

  performed_by uuid REFERENCES users(id),
  notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inspections_unit_idx ON inspections (unit_id, created_at DESC);
CREATE INDEX inspections_company_idx ON inspections (company_id, created_at DESC);
CREATE INDEX inspections_lease_idx ON inspections (lease_id);

-- One row per thing looked at. A fixed checklist would be wrong: a studio and
-- a four bedroom house do not have the same rooms, and an STR turn checks
-- different things than an annual move-out. The operator's own items are the
-- checklist.
CREATE TABLE inspection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,

  area text NOT NULL,           -- 'Kitchen', 'Bedroom 1', 'Exterior'
  item text NOT NULL,           -- 'Countertops', 'Carpet', 'Windows'

  condition text NOT NULL CHECK (condition IN ('good', 'fair', 'poor', 'damaged', 'missing')),
  notes text,
  photo_urls text[],

  -- Set only on a move_out item, and only by a person. See the note at the
  -- top of this file: software records the condition, a human decides whether
  -- something is damage or ordinary wear. That call has legal consequences
  -- and varies by jurisdiction, so it is never inferred.
  beyond_normal_wear boolean,

  -- A repair opened from this item, so the inspection and the work stay
  -- linked without duplicating the maintenance engine.
  maintenance_request_id uuid REFERENCES maintenance_requests(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inspection_items_inspection_idx ON inspection_items (inspection_id);
-- Powers the move-in vs move-out comparison: same area+item across two
-- inspections of the same unit.
CREATE INDEX inspection_items_area_item_idx ON inspection_items (inspection_id, area, item);
