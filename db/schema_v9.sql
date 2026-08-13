-- TraxKey AI — schema v9
-- iCal calendar sync for short-term rentals. Airbnb, Vrbo, and most STR
-- platforms publish a per-listing iCal feed, a public standard, no API key
-- and no partner agreement needed. This is what makes occupancy-aware
-- maintenance urgency possible: "a guest is in the unit right now and
-- checks out Thursday" is a different problem than the same issue in a
-- unit that's vacant for two weeks.

SET search_path TO traxkey;

CREATE TABLE unit_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'other' CHECK (source IN ('airbnb','vrbo','booking','direct','other')),
  ical_url text NOT NULL,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  calendar_id uuid NOT NULL REFERENCES unit_calendars(id) ON DELETE CASCADE,
  -- The iCal UID, stable per booking across syncs, so a re-sync updates
  -- rather than duplicates. Unique per calendar, not globally: two
  -- platforms can theoretically emit the same UID.
  external_uid text NOT NULL,
  checkin_date date NOT NULL,
  checkout_date date NOT NULL,
  guest_label text, -- iCal SUMMARY, often just "Reserved" on Airbnb
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (calendar_id, external_uid)
);

-- Occupancy lookups run on every maintenance request, keep them cheap.
CREATE INDEX bookings_unit_dates_idx ON bookings (unit_id, checkin_date, checkout_date);
