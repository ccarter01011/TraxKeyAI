"""Pre-arrival readiness check.

Catches the failure that costs an STR operator a bad review: a guest is
arriving soon and something on the unit isn't resolved. Unfinished repair,
cleaning turn still open, a maintenance request nobody's picked up.

Small operators miss this because it needs three things looked at together,
the booking calendar, open maintenance, and turn status. Most tools hold
only one of those.

Deliberately all SQL. Whether a unit is ready is a fact, not a judgment.
"""

import os
import traceback
from datetime import date

import requests

from db import db
from escaping import esc

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
NOTIFY_FROM_ADDRESS = os.environ.get("NOTIFY_FROM_ADDRESS", "dispatch@notify.traxkey.ai")

# How far ahead to look. Two days is enough lead time to actually fix
# something, without crying wolf about arrivals a week out.
ARRIVAL_WINDOW_DAYS = 2


def find_at_risk_arrivals():
    """Units with a guest arriving inside the window that still have open work."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              b.unit_id,
              b.checkin_date,
              p.company_id,
              p.name AS property_name,
              u.unit_number,
              (SELECT email FROM traxkey.users usr
                WHERE usr.company_id = p.company_id ORDER BY usr.created_at LIMIT 1) AS notify_email,
              (SELECT count(*) FROM traxkey.maintenance_requests mr
                WHERE mr.unit_id = b.unit_id
                  AND mr.status NOT IN ('completed','closed')) AS open_requests,
              (SELECT count(*) FROM traxkey.turns t
                WHERE t.unit_id = b.unit_id
                  AND t.status NOT IN ('ready','relisted','occupied')) AS open_turns,
              (SELECT json_agg(json_build_object('description', mr2.description, 'status', mr2.status))
                 FROM traxkey.maintenance_requests mr2
                WHERE mr2.unit_id = b.unit_id
                  AND mr2.status NOT IN ('completed','closed')) AS open_items
            FROM traxkey.bookings b
            JOIN traxkey.units u ON u.id = b.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE NOT b.is_blocked
              AND b.checkin_date >= CURRENT_DATE
              AND b.checkin_date <= CURRENT_DATE + %s::int
            """,
            (ARRIVAL_WINDOW_DAYS,),
        )
        rows = cur.fetchall()

    # Only the ones that actually have something outstanding.
    return [r for r in rows if r["open_requests"] > 0 or r["open_turns"] > 0]


def already_alerted(unit_id, checkin_date):
    """One alert per unit per arrival. The worker runs hourly; nobody wants
    the same warning every hour for two days."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM traxkey.maintenance_events
            WHERE event_type = 'readiness_alert'
              AND content LIKE %s
              AND created_at > now() - interval '3 days'
            LIMIT 1
            """,
            (f"%{unit_id}|{checkin_date}%",),
        )
        return cur.fetchone() is not None


def record_alert(unit_id, checkin_date, request_id, summary):
    """Recorded against the maintenance request so it lands in the same
    audit trail the operator already reads."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.maintenance_events (request_id, event_type, content)
            VALUES (%s, 'readiness_alert', %s)
            """,
            (request_id, f"[{unit_id}|{checkin_date}] {summary}"),
        )


def send_alert(row, summary):
    if not RESEND_API_KEY or not row["notify_email"]:
        return
    try:
        unit_label = f"{esc(row['property_name'])}{' Unit ' + esc(row['unit_number']) if row['unit_number'] else ''}"
        items = "".join(
            f"<li>{esc(i['description'])} <em>({esc(i['status'].replace('_',' '))})</em></li>"
            for i in (row["open_items"] or [])
        )
        days = (row["checkin_date"] - date.today()).days
        when = "today" if days == 0 else ("tomorrow" if days == 1 else f"in {days} days")

        html = f"""<div style="font-family: Arial, sans-serif; font-size:14px; color:#1e293b;">
<p><strong>{unit_label}</strong> has a guest arriving {when}, and there's still open work on it.</p>
{f'<ul>{items}</ul>' if items else ''}
{f'<p>{row["open_turns"]} turn still in progress.</p>' if row["open_turns"] else ''}
<p>Worth a look before they arrive.</p>
<p style="font-size:11px;color:#94a3b8;margin-top:24px;">Sent automatically by TraxKey AI.</p>
</div>"""

        requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json={
                "from": f"TraxKey AI <{NOTIFY_FROM_ADDRESS}>",
                "to": row["notify_email"],
                "subject": f"Guest arriving {when}: {unit_label} isn't ready",
                "html": html,
            },
            timeout=10,
        )
    except Exception:
        # Never let a notification failure hide the underlying finding.
        traceback.print_exc()


def run_readiness_checks():
    """One pass. Alerts once per unit per arrival."""
    for row in find_at_risk_arrivals():
        try:
            if already_alerted(row["unit_id"], row["checkin_date"]):
                continue

            parts = []
            if row["open_requests"]:
                parts.append(f"{row['open_requests']} open maintenance request(s)")
            if row["open_turns"]:
                parts.append(f"{row['open_turns']} turn(s) not ready")
            summary = f"Guest arrives {row['checkin_date']}, unit not ready: {', '.join(parts)}."

            # Anchor the alert to one of the open requests so it shows up in
            # the audit trail. Nothing to anchor to (turn-only) means the
            # Turns page deadline already surfaces it, so just email.
            with db() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id FROM traxkey.maintenance_requests
                    WHERE unit_id = %s AND status NOT IN ('completed','closed')
                    ORDER BY created_at LIMIT 1
                    """,
                    (row["unit_id"],),
                )
                anchor = cur.fetchone()

            if anchor:
                record_alert(row["unit_id"], row["checkin_date"], anchor["id"], summary)

            send_alert(row, summary)
            print(f"Readiness alert: {row['property_name']} — {summary}")
        except Exception:
            traceback.print_exc()
