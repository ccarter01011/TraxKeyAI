-- TraxKey AI — schema v27: vendor chase
--
-- The gap: TraxKey emails a vendor when it dispatches, then nothing. If that
-- vendor never confirms, never schedules, and never shows up, the request
-- sits at 'scheduled' indefinitely and the operator finds out when the
-- tenant calls again, angrier.
--
-- This is TraxSail AI's core loop applied to property work: chase the party
-- who hasn't responded. Deliberately operations, not money. TraxKey still
-- never touches invoices or payments.

SET search_path TO traxkey;

-- How many times we've nudged, and when. On the request rather than a
-- separate table because it is strictly per-request state with no history
-- worth keeping beyond the event log, which already records each nudge.
ALTER TABLE maintenance_requests ADD COLUMN chase_count integer NOT NULL DEFAULT 0;
ALTER TABLE maintenance_requests ADD COLUMN last_chased_at timestamptz;
-- Set when the vendor confirms or starts work, which stops the chase.
ALTER TABLE maintenance_requests ADD COLUMN vendor_acknowledged_at timestamptz;

-- The query the chase runs every pass.
CREATE INDEX mr_chase_idx ON maintenance_requests (status, last_chased_at)
  WHERE status = 'scheduled' AND vendor_acknowledged_at IS NULL;

-- Per-company override for how long to wait. Falls back to the constants in
-- agents/vendor_chase.py when unset, same pattern as cost_approval_threshold.
ALTER TABLE companies ADD COLUMN chase_after_hours integer;
