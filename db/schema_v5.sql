-- TraxKey AI — schema v5
-- Two new maintenance_requests statuses for the AI Maintenance Coordinator:
-- needs_vendor (no vendor on file for that trade, needs a human to assign
-- one manually) and awaiting_approval (quoted cost is over the company's
-- threshold, paused for a human to approve before dispatch).

SET search_path TO traxkey;

ALTER TABLE maintenance_requests DROP CONSTRAINT maintenance_requests_status_check;
ALTER TABLE maintenance_requests ADD CONSTRAINT maintenance_requests_status_check CHECK (
  status IN ('submitted','triaged','needs_vendor','awaiting_approval','assigned','scheduled','in_progress','on_hold','completed','closed')
);
