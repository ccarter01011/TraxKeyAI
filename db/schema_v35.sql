-- v35: derive unit occupancy instead of trusting units.status
--
-- Two related bugs, found during end-to-end testing on 2026-08-18.
--
-- 1. units.status defaulted to 'occupied'. A unit created with no lease, no
--    booking and no resident showed as OCCUPIED the moment it was saved,
--    which inflated occupancy on the Analytics page, on owner statements,
--    and in the Portfolio Assistant's vacant-unit count.
--
-- 2. Worse, the column was a one-way ratchet. checkout_turns.py and
--    lease_agent.py both set it to 'vacant', but NOTHING in the codebase
--    ever set it back to 'occupied'. A unit that turned over once was
--    counted vacant forever, so reported occupancy drifted permanently
--    downward and never recovered — on numbers TraxKey shows to owners.
--
-- The fix is to stop storing a fact that is already derivable. A unit is
-- occupied on a date if it has an active lease covering that date, or a
-- guest booking covering that night. Leases and bookings are the source of
-- truth; a denormalised flag maintained by hand in two places was always
-- going to drift from them.
--
-- Owner blocks deliberately do NOT count as occupied: a blocked night is
-- unavailable, not earning. Counting it as occupancy would flatter the
-- number, which is the opposite of what an owner statement is for.
--
-- checkout_date/end_date are exclusive on purpose, matching the calendar:
-- a guest leaving on the 5th does not occupy the night of the 5th.

SET search_path TO traxkey, public;

-- New units start vacant. Any code still reading the raw column (the n8n
-- Properties workflow, until its badge query is updated) is then at worst
-- stale rather than actively wrong on a brand-new unit.
ALTER TABLE units ALTER COLUMN status SET DEFAULT 'vacant';

CREATE OR REPLACE FUNCTION traxkey.unit_is_occupied(p_unit_id uuid, p_on date DEFAULT CURRENT_DATE)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM traxkey.leases l
      WHERE l.unit_id = p_unit_id
        AND l.status = 'active'
        AND l.start_date <= p_on
        AND (l.end_date IS NULL OR l.end_date >= p_on)
    )
    OR EXISTS (
      SELECT 1 FROM traxkey.bookings b
      WHERE b.unit_id = p_unit_id
        AND NOT b.is_blocked
        AND b.checkin_date <= p_on
        AND b.checkout_date > p_on
    )
    OR EXISTS (
      SELECT 1 FROM traxkey.direct_reservations dr
      WHERE dr.unit_id = p_unit_id
        AND dr.status = 'confirmed'
        AND dr.checkin_date <= p_on
        AND dr.checkout_date > p_on
    );
$$;

COMMENT ON FUNCTION traxkey.unit_is_occupied(uuid, date) IS
  'Occupancy derived from leases and bookings. Prefer this over units.status, '
  'which is a legacy denormalised flag that no code sets back to occupied.';

-- Realign existing rows so anything still reading the column agrees with the
-- derived answer at the moment of migration. This is a correction of state
-- the app itself got wrong, not a destructive change: it only rewrites a
-- status flag, and every row is recomputed from that unit's own leases and
-- bookings rather than being blanket-set to one value.
UPDATE units u
   SET status = CASE WHEN traxkey.unit_is_occupied(u.id) THEN 'occupied' ELSE 'vacant' END
 WHERE u.status IS DISTINCT FROM
       CASE WHEN traxkey.unit_is_occupied(u.id) THEN 'occupied' ELSE 'vacant' END;
