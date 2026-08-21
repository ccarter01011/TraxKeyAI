-- v43: free-tier upgrade nudge tracking
--
-- Same shape as leads.contacted_at (schema_v?? lead_followup.py): a single
-- timestamp that's null until the one nudge email goes out, so the chase
-- loop can tell "not yet due" from "already sent" without a separate table.

SET search_path TO traxkey, public;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS free_tier_nudge_sent_at timestamptz;
