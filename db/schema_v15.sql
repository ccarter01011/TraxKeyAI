-- TraxKey AI — schema v15: Leases
--
-- The first piece of the platform build (see PLATFORM-ROADMAP.md). A prospect
-- told us we were "not even at the base level of competitors" and they were
-- right: we tracked maintenance but had no idea when anyone's lease ended.
--
-- Scope note, deliberate: we record the rent AMOUNT but never collect it, and
-- there is no ledger, no balance, no payment table. Rent collection and trust
-- accounting carry real legal and compliance exposure and stay out of TraxKey
-- permanently. Operators keep using whatever already moves their money.

SET search_path TO traxkey;

CREATE TABLE leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,

  start_date date NOT NULL,
  -- NULL end_date means month-to-month. It is a real and common arrangement,
  -- not missing data, so the renewal agent must skip these rather than treat
  -- them as expired.
  end_date date,

  rent_amount numeric(10,2),
  deposit_amount numeric(10,2),
  rent_due_day smallint NOT NULL DEFAULT 1 CHECK (rent_due_day BETWEEN 1 AND 28),
  -- How much notice the resident owes before leaving. Drives when the renewal
  -- agent has to start the conversation.
  notice_days smallint NOT NULL DEFAULT 30,

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','ended')),

  -- Renewal is tracked on the lease it would replace, not as a separate row,
  -- until the resident accepts. On acceptance a new lease row is created and
  -- this one moves to 'ended'. That keeps history honest: every lease row is
  -- a term that actually existed.
  renewal_status text
    CHECK (renewal_status IN ('none','offered','accepted','declined','no_response')),
  renewal_offered_at timestamptz,
  renewal_rent_amount numeric(10,2),
  renewal_notes text,

  ended_at date,
  end_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK (end_date IS NULL OR end_date > start_date)
);

-- A unit can only have one lease actually in force at a time. Overlapping
-- active leases are always a data error and they would make every occupancy
-- and renewal calculation wrong, so the database refuses them outright.
CREATE UNIQUE INDEX leases_one_active_per_unit
  ON leases (unit_id) WHERE status = 'active';

CREATE INDEX leases_unit_idx ON leases (unit_id);
-- The renewal agent's main query: fixed-term leases ending soon.
CREATE INDEX leases_expiry_idx ON leases (end_date)
  WHERE status = 'active' AND end_date IS NOT NULL;

-- Residents belong to a lease once one exists. Nullable because short-term
-- rental guests are residents with check-in/check-out dates and no lease at
-- all, and because existing rows predate this table.
ALTER TABLE residents
  ADD COLUMN lease_id uuid REFERENCES leases(id) ON DELETE SET NULL;

CREATE INDEX residents_lease_idx ON residents (lease_id);

-- Same audit pattern as maintenance_events: every state change leaves a row,
-- so "why did this lease end" is always answerable.
CREATE TABLE lease_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  content text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lease_events_lease_idx ON lease_events (lease_id, created_at DESC);
