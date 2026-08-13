-- TraxKey AI — schema v10
-- Distinguish a real guest booking from an owner-side calendar block.
-- Airbnb's iCal feed carries both: "Reserved" for an actual reservation,
-- "Airbnb (Not available)" for dates the owner blocked off. Both make the
-- unit unavailable, but only one means a person is physically in the unit,
-- and that's what changes maintenance urgency.

SET search_path TO traxkey;

ALTER TABLE bookings ADD COLUMN is_blocked boolean NOT NULL DEFAULT false;
