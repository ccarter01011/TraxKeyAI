-- TraxKey AI — schema v20: resident notification log
--
-- Closes the biggest hole in the product: a resident or guest filed a
-- request and then heard nothing, ever. The tenant portal literally promised
-- "we'll text you with updates, including who's coming and when" while
-- nothing in the system contacted them. Vendors got emailed, operators got
-- alerts, residents got silence.
--
-- This table exists for exactly one reason: the UNIQUE constraint. The
-- worker polls, so without a record of what has already been sent it would
-- re-email every resident on every pass. Sending a stranger the same
-- "your plumber is on the way" email every 15 minutes would be worse than
-- sending nothing.

SET search_path TO traxkey;

CREATE TABLE resident_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,

  notification_type text NOT NULL
    CHECK (notification_type IN ('received', 'dispatched', 'completed')),

  -- Email only today. SMS is on the roadmap and will reuse this same log,
  -- which is why the channel is recorded rather than assumed.
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms')),
  sent_to text,
  sent_at timestamptz NOT NULL DEFAULT now(),

  -- One notification of each type per request, per channel. This is the
  -- whole point of the table, not an incidental index.
  UNIQUE (request_id, notification_type, channel)
);

CREATE INDEX resident_notifications_request_idx ON resident_notifications (request_id);
