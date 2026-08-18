-- Adds a real audit trail for supplier and customer email replies, the same
-- pattern maintenance_events already gave maintenance_requests, extended to
-- the two chase loops that never had one: ordered_items (supplier chase)
-- and invoices (customer chase).
--
-- This is the DB half of fixing a real bug: every chase email sent by
-- vendor_chase.py and invoice_chase.py had no reply_to set, so a reply from
-- a vendor, supplier, or customer bounced. It looked answered on their end
-- and never reached TraxKey. See n8n-workflows/TraxKey-18-Inbound-Reply.json
-- for the workflow that reads these once inbound receiving is live, and
-- agents/vendor_chase.py + agents/invoice_chase.py for the reply_to fix.
--
-- Reply matching uses plus-addressing (reply+mr-<uuid>@notify.traxkey.ai,
-- oi- or inv- for the other two), not fuzzy sender/subject matching, so
-- which record a reply belongs to is never a guess.
--
-- invoice_events deliberately never lets an inbound reply set
-- invoices.status or paid_on, even for a reply that claims payment was
-- sent. See invoice_chase.py's own module docstring: "TraxKey chases; it
-- never collects." A self-reported email is not proof of payment.

SET search_path TO traxkey, public;

CREATE TABLE ordered_item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ordered_item_id uuid NOT NULL REFERENCES ordered_items(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  content text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  content text,
  created_at timestamptz NOT NULL DEFAULT now()
);
