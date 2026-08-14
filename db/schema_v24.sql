-- TraxKey AI — schema v24: STR supplies and checkout damage
--
-- Two remaining short-term rental gaps, both deliberately built on machinery
-- that already exists rather than as new subsystems.
--
-- SUPPLIES: cleaners are already vendors with a portal login. "Report what's
-- low" is a small addition to a relationship that exists, not a new app.
--
-- DAMAGE: an inspection of type 'turn' already exists and already holds
-- photos and conditions per item. Checkout damage is that, captured at
-- checkout and linked to the booking so it is attributable to a stay.

SET search_path TO traxkey;

-- What a unit should be stocked with, and how much triggers a reorder.
CREATE TABLE unit_supplies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  item text NOT NULL,
  par_level integer,              -- what "fully stocked" means for this unit
  current_level integer,
  reorder_at integer,             -- flag when current_level drops to this
  unit_label text,                -- 'rolls', 'sets', 'bottles'
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CHECK (length(trim(item)) > 0),
  UNIQUE (unit_id, item)
);

CREATE INDEX unit_supplies_unit_idx ON unit_supplies (unit_id);
-- The query that matters: what needs restocking.
CREATE INDEX unit_supplies_low_idx ON unit_supplies (unit_id)
  WHERE current_level IS NOT NULL AND reorder_at IS NOT NULL;

-- Damage found at checkout, tied to the stay it happened during.
-- Same deliberate limit as inspections: this records evidence, it does not
-- decide fault or compute a charge. Those are governed by platform policy
-- and local law, and getting one wrong is the operator's liability.
CREATE TABLE checkout_damage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  turn_id uuid REFERENCES turns(id) ON DELETE SET NULL,

  description text NOT NULL,
  photo_urls text[],
  estimated_cost numeric(10,2),
  -- Whether to pursue it is the operator's call, never inferred.
  claim_status text NOT NULL DEFAULT 'recorded'
    CHECK (claim_status IN ('recorded', 'claiming', 'resolved', 'dropped')),
  reported_by text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CHECK (length(trim(description)) > 0)
);

CREATE INDEX checkout_damage_company_idx ON checkout_damage (company_id, created_at DESC);
CREATE INDEX checkout_damage_unit_idx ON checkout_damage (unit_id);
