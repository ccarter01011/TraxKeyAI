"""Lease Agent — the housekeeping that makes lease records act like a system
instead of a spreadsheet.

Everything here is deterministic SQL on dates. There is no LLM call in this
file and there should never be one: activating a lease on its start date or
counting days to an expiry are facts, not judgments. The same rule the
maintenance coordinator follows — AI only for genuinely ambiguous free text.

Four jobs, run hourly:
  1. activate_due_leases    draft term reaches its start date -> active
  2. end_expired_leases     fixed term passes its end date    -> ended
  3. flag_silent_renewals   offer sent, notice window closing -> no_response
  4. open_move_out_turns    resident is leaving               -> start a turn
"""

from db import db

# An offer that has gone unanswered this long is functionally a no. The
# operator still has to act, but the lease stops sitting in "offered" forever
# and starts showing up as a decision that needs making.
SILENT_AFTER_DAYS = 14


def activate_due_leases():
    """A renewal accepted in March creates a draft term starting in June.

    It is stored as 'draft' because the partial unique index allows only one
    active lease per unit, and because a term that has not started is not in
    force. This flips it on the day it actually begins.
    """
    with db() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE traxkey.leases l
            SET status = 'active', updated_at = now()
            WHERE l.status = 'draft'
              AND l.start_date <= CURRENT_DATE
              -- Belt and braces: never activate into a unit that somehow
              -- still has an active lease. Better to leave it draft and let
              -- a person notice than to violate the index.
              AND NOT EXISTS (
                SELECT 1 FROM traxkey.leases o
                WHERE o.unit_id = l.unit_id AND o.status = 'active'
              )
            RETURNING l.id
        """)
        rows = cur.fetchall()
        for r in rows:
            cur.execute("""
                INSERT INTO traxkey.lease_events (lease_id, event_type, content, created_by)
                VALUES (%s, 'lease_activated', 'Renewal term began today.', 'lease_agent')
            """, (r["id"],))
    if rows:
        print(f"[lease_agent] activated {len(rows)} lease(s)")
    return len(rows)


def end_expired_leases():
    """Close fixed terms that have run out.

    Month-to-month leases have a NULL end_date and are skipped. That is the
    whole reason end_date is nullable: an open-ended tenancy is a real
    arrangement, not a missing value, and treating it as expired would evict
    people on paper every night.
    """
    with db() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE traxkey.leases
            SET status = 'ended',
                ended_at = end_date,
                end_reason = COALESCE(end_reason, 'term_expired'),
                updated_at = now()
            WHERE status = 'active'
              AND end_date IS NOT NULL
              AND end_date < CURRENT_DATE
              -- An accepted renewal is handled by its follow-on draft term,
              -- so this row ending is expected and already accounted for.
              AND COALESCE(renewal_status, 'none') <> 'accepted'
            RETURNING id, unit_id
        """)
        rows = cur.fetchall()
        for r in rows:
            cur.execute("""
                INSERT INTO traxkey.lease_events (lease_id, event_type, content, created_by)
                VALUES (%s, 'lease_ended', 'Fixed term reached its end date.', 'lease_agent')
            """, (r["id"],))
    if rows:
        print(f"[lease_agent] ended {len(rows)} expired lease(s)")
    return rows


def flag_silent_renewals():
    """Move stale offers to 'no_response' so they resurface as a decision."""
    with db() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE traxkey.leases
            SET renewal_status = 'no_response', updated_at = now()
            WHERE status = 'active'
              AND renewal_status = 'offered'
              AND renewal_offered_at < now() - make_interval(days => %s)
            RETURNING id
        """, (SILENT_AFTER_DAYS,))
        rows = cur.fetchall()
        for r in rows:
            cur.execute("""
                INSERT INTO traxkey.lease_events (lease_id, event_type, content, created_by)
                VALUES (%s, 'renewal_no_response',
                        %s, 'lease_agent')
            """, (r["id"], f"No answer to the renewal offer after {SILENT_AFTER_DAYS} days."))
    if rows:
        print(f"[lease_agent] flagged {len(rows)} silent renewal(s)")
    return len(rows)


def open_move_out_turns(ended):
    """Start the vacancy clock the moment a resident is actually leaving.

    This is the payoff for having leases and turns in one system: the operator
    does not have to remember to start a turn, and the days-vacant number is
    honest because it starts on the real move-out date rather than whenever
    somebody got around to logging it.
    """
    opened = 0
    with db() as conn, conn.cursor() as cur:
        for lease in ended:
            cur.execute("""
                INSERT INTO traxkey.turns (company_id, unit_id, turn_type, auto_created)
                SELECT p.company_id, u.id, 'move_out', true
                FROM traxkey.units u
                JOIN traxkey.properties p ON p.id = u.property_id
                WHERE u.id = %s
                  -- Not if a turn is already running on this unit, and not if
                  -- a follow-on term is about to start, that unit is not
                  -- turning over at all.
                  AND NOT EXISTS (
                    SELECT 1 FROM traxkey.turns t
                    WHERE t.unit_id = u.id AND t.status <> 'occupied'
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM traxkey.leases l
                    WHERE l.unit_id = u.id AND l.status IN ('draft', 'active')
                  )
                RETURNING id
            """, (lease["unit_id"],))
            turn = cur.fetchone()
            if not turn:
                continue
            opened += 1
            cur.execute(
                "UPDATE traxkey.units SET status = 'vacant' WHERE id = %s",
                (lease["unit_id"],))
            cur.execute("""
                INSERT INTO traxkey.turn_events (turn_id, event_type, content)
                VALUES (%s, 'vacancy_started', 'Lease ended, turn opened automatically.')
            """, (turn["id"],))
    if opened:
        print(f"[lease_agent] opened {opened} move-out turn(s)")
    return opened


def run_lease_agent():
    activate_due_leases()
    ended = end_expired_leases()
    flag_silent_renewals()
    if ended:
        open_move_out_turns(ended)
