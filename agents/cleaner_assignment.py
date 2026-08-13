"""Cleaner assignment for short-term rental turns.

The gap this closes: a cleaning turn already opens itself automatically
(checkout_turns.py) with a deadline, but nothing then assigns a cleaner. The
operator was left to do that by hand, which is exactly the piece Breezeway
and Turno are built around and TraxKey didn't have.

The fix reuses the maintenance coordinator's engine rather than building a
second one. A cleaning job is created as a maintenance_request with
category='cleaning', turn_id set, and its category/urgency/responsibility
already known as plain facts, not free text needing classification. graph.py
sees those already set and skips its one LLM call, then runs the exact same
find_vendor -> check_approval -> dispatch path that assigns any vendor,
ranked by the same completion-rate/rating/cost history. A great cleaner and
a great plumber are found the same way here, because the underlying question
is the same: who has actually done good, reliable work.
"""

import traceback

from db import db

# A turn whose deadline is this close counts as urgent, the sharpest case
# being the same-day turnaround checkout_turns.py already calls out.
URGENT_WITHIN_HOURS = 24


def find_turns_needing_a_cleaner():
    """Cleaning turns with no cleaning job opened yet. Deterministic: this
    is a fact about what exists in the turns and maintenance_requests
    tables, not a judgment call."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT t.id AS turn_id, t.company_id, t.unit_id, t.deadline_at,
                   u.unit_number, p.name AS property_name
            FROM traxkey.turns t
            JOIN traxkey.units u ON u.id = t.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE t.turn_type = 'cleaning'
              AND t.status NOT IN ('ready', 'relisted', 'occupied')
              AND NOT EXISTS (
                SELECT 1 FROM traxkey.maintenance_requests mr
                WHERE mr.turn_id = t.id AND mr.category = 'cleaning'
              )
            """
        )
        return cur.fetchall()


def open_cleaning_job(row):
    """Create the pre-classified request. Status starts at 'submitted' so
    run_batch()'s normal query picks it up on the very next pass, same as
    any resident-reported issue, it just skips diagnose()'s API call."""
    urgent = row["deadline_at"] is not None
    unit_label = f"{row['property_name']}{' Unit ' + row['unit_number'] if row['unit_number'] else ''}"
    deadline_note = (
        f"Next guest arrives {row['deadline_at']}." if row["deadline_at"]
        else "No upcoming booking yet, no hard deadline."
    )
    description = f"Turnover cleaning for {unit_label}. {deadline_note}"

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.maintenance_requests
              (company_id, unit_id, description, category, urgency, responsibility, status, turn_id)
            VALUES (%s, %s, %s, 'cleaning', %s, 'owner', 'submitted', %s)
            RETURNING id
            """,
            (row["company_id"], row["unit_id"], description,
             "urgent" if urgent else "routine", row["turn_id"]),
        )
        request_id = cur.fetchone()["id"]
        cur.execute(
            """
            INSERT INTO traxkey.turn_events (turn_id, event_type, content)
            VALUES (%s, 'cleaning_assigned', %s)
            """,
            (row["turn_id"], "Cleaning job opened, assigning to a cleaner automatically."),
        )

    print(f"[cleaner_assignment] opened cleaning job for {unit_label}")
    return request_id


def run_cleaner_assignment():
    for row in find_turns_needing_a_cleaner():
        try:
            open_cleaning_job(row)
        except Exception:
            traceback.print_exc()
