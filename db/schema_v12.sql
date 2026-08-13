-- TraxKey AI — schema v12
-- Connects calendar sync to the turn engine: a guest checkout automatically
-- opens a cleaning turn. This is where the two halves of the STR story meet,
-- occupancy data becomes operational work, and it's the piece Breezeway
-- charges $19.99/unit for.

SET search_path TO traxkey;

ALTER TABLE turns ADD COLUMN turn_type text NOT NULL DEFAULT 'move_out'
  CHECK (turn_type IN ('move_out','cleaning'));
ALTER TABLE turns ADD COLUMN auto_created boolean NOT NULL DEFAULT false;

-- When the unit must be ready. For a cleaning turn this is the next guest's
-- check-in, which is what makes same-day turnarounds visible as the hard
-- deadlines they actually are.
ALTER TABLE turns ADD COLUMN deadline_at date;

-- Which booking's checkout opened this turn. Prevents opening a second turn
-- for the same checkout on every subsequent worker pass.
ALTER TABLE turns ADD COLUMN triggered_by_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX turns_triggered_by_booking_idx ON turns (triggered_by_booking_id)
  WHERE triggered_by_booking_id IS NOT NULL;
