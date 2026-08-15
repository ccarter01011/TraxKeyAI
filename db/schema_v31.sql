-- v31: direct booking reservations + nightly pricing suggestions
--
-- Two things, kept deliberately separate from the existing iCal `bookings`
-- table (schema_v9), which is a read-only mirror of an external calendar
-- TraxKey has no control over. This is the opposite: reservations TraxKey
-- itself owns, on a channel that isn't Airbnb or Vrbo (a direct-booking
-- site, a phone reservation, a property's own website).
--
-- Pricing is vendor-agnostic on purpose. `source` records who produced a
-- given night's suggestion (heuristic today, pricelabs/beyond/wheelhouse
-- later) so swapping providers never rewrites history, and the UI never
-- needs to know which provider is live.

SET search_path TO traxkey, public;

CREATE TABLE IF NOT EXISTS direct_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  guest_name text NOT NULL,
  guest_email text,
  checkin_date date NOT NULL,
  checkout_date date NOT NULL,
  nightly_rate numeric(10,2) NOT NULL,   -- rate actually charged, locked at booking
  status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled')),
  source text NOT NULL DEFAULT 'direct', -- 'direct', 'phone', 'test'
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (checkout_date > checkin_date)
);

CREATE INDEX IF NOT EXISTS direct_reservations_unit_dates_idx
  ON direct_reservations (unit_id, checkin_date, checkout_date)
  WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS direct_reservations_company_idx
  ON direct_reservations (company_id);

-- One row per unit per night. Upserted by the pricing engine; a night with
-- no row simply hasn't been priced yet, which the UI treats as "use the
-- unit's base rate" rather than an error state.
CREATE TABLE IF NOT EXISTS unit_nightly_rates (
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  stay_date date NOT NULL,
  base_rate numeric(10,2) NOT NULL,
  suggested_rate numeric(10,2) NOT NULL,
  applied_rate numeric(10,2),            -- null until the operator accepts one
  source text NOT NULL DEFAULT 'heuristic'
    CHECK (source IN ('heuristic', 'manual', 'pricelabs', 'beyond', 'wheelhouse')),
  factors jsonb,                          -- what drove the suggestion, for display
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (unit_id, stay_date)
);

-- A base nightly rate per unit. What the pricing engine adjusts around.
ALTER TABLE units ADD COLUMN IF NOT EXISTS base_nightly_rate numeric(10,2);
