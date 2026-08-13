"""Auto-create a cleaning turn when a short-term guest checks out.

This is where calendar sync becomes operational work. Occupancy data on its
own is just information; turning a checkout into a tracked, deadline-aware
cleaning turn is the thing an operator actually gets paid back for.

The differentiator worth protecting: because the calendar and the
maintenance engine live in the same system, we can see a same-day
turnaround (guest out Thursday, next guest in Thursday) and treat it as the
hard deadline it is. Tools that only do turnover scheduling, or only do
maintenance, can't see both halves.
"""

import traceback
from datetime import date, timedelta

from db import db

# How far back to look for checkouts. Covers a worker that was down for a
# day or two without re-opening turns for ancient bookings.
LOOKBACK_DAYS = 3


def find_checkouts_needing_turns():
    """Bookings that have checked out recently and don't yet have a turn.

    Deliberately all SQL: which checkouts need a turn is a fact, not a
    judgment call.
    """
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              b.id AS booking_id,
              b.unit_id,
              b.checkout_date,
              p.company_id,
              p.name AS property_name,
              u.unit_number,
              -- Next real arrival after this checkout, this becomes the
              -- deadline the cleaning turn has to hit.
              (SELECT MIN(nb.checkin_date)
                 FROM traxkey.bookings nb
                WHERE nb.unit_id = b.unit_id
                  AND NOT nb.is_blocked
                  AND nb.checkin_date >= b.checkout_date
                  AND nb.id <> b.id) AS next_checkin
            FROM traxkey.bookings b
            JOIN traxkey.units u ON u.id = b.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE NOT b.is_blocked
              AND b.checkout_date <= CURRENT_DATE
              AND b.checkout_date >= CURRENT_DATE - %s::int
              -- no turn already opened for this specific checkout
              AND NOT EXISTS (
                SELECT 1 FROM traxkey.turns t WHERE t.triggered_by_booking_id = b.id
              )
              -- and the unit isn't already mid-turn for some other reason
              AND NOT EXISTS (
                SELECT 1 FROM traxkey.turns t
                 WHERE t.unit_id = b.unit_id AND t.status <> 'occupied'
              )
            """,
            (LOOKBACK_DAYS,),
        )
        return cur.fetchall()


def create_cleaning_turn(row):
    """Open the turn, and describe the deadline in plain language on the
    event so the operator understands the urgency without doing date math."""
    checkout = row["checkout_date"]
    next_checkin = row["next_checkin"]

    if next_checkin and next_checkin == checkout:
        note = "Same-day turnaround: the next guest arrives today. This unit has hours, not days."
    elif next_checkin:
        days = (next_checkin - checkout).days
        note = f"Next guest arrives {next_checkin} ({days} day{'s' if days != 1 else ''} to get ready)."
    else:
        note = "No upcoming booking yet, no hard deadline."

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.turns
              (company_id, unit_id, turn_type, auto_created, deadline_at, triggered_by_booking_id)
            VALUES (%s, %s, 'cleaning', true, %s, %s)
            RETURNING id
            """,
            (row["company_id"], row["unit_id"], next_checkin, row["booking_id"]),
        )
        turn_id = cur.fetchone()["id"]

        cur.execute(
            "UPDATE traxkey.units SET status = 'vacant' WHERE id = %s",
            (row["unit_id"],),
        )
        cur.execute(
            """
            INSERT INTO traxkey.turn_events (turn_id, event_type, content)
            VALUES (%s, 'vacancy_started', %s)
            """,
            (turn_id, f"Guest checked out {checkout}. Cleaning turn opened automatically. {note}"),
        )

    unit_label = f"{row['property_name']}{' Unit ' + row['unit_number'] if row['unit_number'] else ''}"
    print(f"Auto-opened cleaning turn for {unit_label}: {note}")
    return turn_id


def run_checkout_turns():
    """One pass. A failure on one booking never stops the others."""
    for row in find_checkouts_needing_turns():
        try:
            create_cleaning_turn(row)
        except Exception:
            traceback.print_exc()
