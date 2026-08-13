-- TraxKey AI — schema v14
-- Let a property manager route a specific resident's requests to a human.
--
-- Real need: a resident who over-reports, exaggerates urgency, or games the
-- system shouldn't have an AI auto-dispatching vendors on their say-so. The
-- operator knows who those people are; the AI can't and shouldn't guess.
--
-- This is deliberately a manual switch, not something the AI decides. Having
-- software silently label a tenant "abusive" based on request volume would
-- be both unfair and wrong, high request counts often just mean a badly
-- maintained unit.

SET search_path TO traxkey;

ALTER TABLE residents ADD COLUMN requires_human_review boolean NOT NULL DEFAULT false;
ALTER TABLE residents ADD COLUMN review_reason text;
ALTER TABLE residents ADD COLUMN flagged_at timestamptz;
ALTER TABLE residents ADD COLUMN flagged_by uuid REFERENCES users(id);

-- Requests from a flagged resident stop here instead of auto-dispatching.
ALTER TABLE maintenance_requests DROP CONSTRAINT maintenance_requests_status_check;
ALTER TABLE maintenance_requests ADD CONSTRAINT maintenance_requests_status_check CHECK (
  status IN ('submitted','triaged','needs_vendor','awaiting_approval','needs_human_review',
             'assigned','scheduled','in_progress','on_hold','completed','closed')
);
