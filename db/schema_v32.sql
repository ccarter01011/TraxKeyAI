-- v32: experiential STR / micro-resort mode
--
-- Multi-unit properties with shared amenities (5 acres, 7 cabins, one pool
-- and lake) fit TraxKey's property->units model structurally, but nothing
-- represents the amenity itself. A broken pool heater today has nowhere to
-- live except a maintenance ticket pinned to one unit, when it affects
-- every guest on the property.
--
-- rental_mode is per-property, not per-company: an operator can run some
-- standalone STR units and one resort-style compound in the same portfolio.
-- 'experiential' unlocks the Amenities tab and whole-property buyout
-- booking; 'standard' hides both so an ordinary single-unit property isn't
-- cluttered with concepts that don't apply to it.

SET search_path TO traxkey, public;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS rental_mode text
  NOT NULL DEFAULT 'standard'
  CHECK (rental_mode IN ('standard', 'experiential'));

CREATE TABLE IF NOT EXISTS amenities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name text NOT NULL,               -- "Main pool", "Lake dock", "Firepit"
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('pool', 'water', 'fire', 'sport', 'gathering', 'other')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'maintenance')),
  status_note text,                 -- "Heater being repaired, back Thursday"
  capacity integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS amenities_property_idx ON amenities (property_id);

-- A maintenance issue can now be tied to a shared amenity instead of one
-- unit. Exactly one of unit_id / amenity_id must be set, never both and
-- never neither: a request always belongs to something specific.
ALTER TABLE maintenance_requests ALTER COLUMN unit_id DROP NOT NULL;
ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS amenity_id uuid
  REFERENCES amenities(id) ON DELETE CASCADE;
ALTER TABLE maintenance_requests DROP CONSTRAINT IF EXISTS mr_unit_or_amenity;
ALTER TABLE maintenance_requests ADD CONSTRAINT mr_unit_or_amenity
  CHECK ((unit_id IS NOT NULL) <> (amenity_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS maintenance_requests_amenity_idx
  ON maintenance_requests (amenity_id) WHERE amenity_id IS NOT NULL;

-- Whole-property buyouts: a single reservation that blocks every unit on
-- the property for the date range, the common booking pattern for these
-- properties (weddings, retreats, reunions). Kept separate from
-- direct_reservations (which is always one unit) rather than overloading
-- that table with a nullable unit_id and a different conflict-checking
-- shape.
CREATE TABLE IF NOT EXISTS property_buyouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  guest_name text NOT NULL,
  guest_email text,
  checkin_date date NOT NULL,
  checkout_date date NOT NULL,
  total_rate numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (checkout_date > checkin_date)
);

CREATE INDEX IF NOT EXISTS property_buyouts_property_dates_idx
  ON property_buyouts (property_id, checkin_date, checkout_date)
  WHERE status = 'confirmed';
