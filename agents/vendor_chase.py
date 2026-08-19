"""Vendor Chase Agent: nobody shows up, and nobody notices.

TraxKey dispatches a vendor by email and then goes quiet. If that vendor
never confirms, never schedules and never arrives, the request sits at
'scheduled' forever. The operator finds out when the tenant calls back,
which is the worst possible moment.

This is TraxSail AI's core loop applied to property work: chase the party
who hasn't responded, escalate when it starts to matter, and hand it to a
human before it becomes a complaint. Deliberately operations, not money.

Escalation is deterministic, three steps, no LLM:

    1st nudge   re-email the vendor
    2nd nudge   re-email, and tell the operator it is going quiet
    3rd         stop chasing, flag for the operator, suggest the next vendor

Urgency compresses the timings rather than changing the ladder. A guest in
the unit or a turn deadline tomorrow does not get a gentler chase, it gets
the same chase faster.
"""

import os
import traceback
from datetime import datetime, timezone

import requests

from db import db
from escaping import esc

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
NOTIFY_FROM_ADDRESS = os.environ.get("NOTIFY_FROM_ADDRESS", "dispatch@notify.traxkey.ai")

# Hours of silence before the first nudge, by urgency. An emergency vendor
# who has not answered in 2 hours is a problem; a routine one at 2 hours is
# just busy.
DEFAULT_WAIT_HOURS = {"emergency": 2, "urgent": 8, "routine": 24}
# Gap between subsequent nudges, as a multiple of the first wait.
REPEAT_MULTIPLIER = 1.0
MAX_CHASES = 2  # after this many nudges, stop and escalate to the operator


def find_silent_vendors():
    """Dispatched jobs where the vendor has not acknowledged, and enough
    time has passed for the next step. All SQL: whether a deadline has
    passed is a fact."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT mr.id, mr.description, mr.urgency, mr.category, mr.chase_count,
                   mr.company_id, mr.created_at,
                   v.id AS vendor_id, v.name AS vendor_name, v.contact_email,
                   u.unit_number, p.name AS property_name,
                   c.chase_after_hours,
                   (SELECT u2.email FROM traxkey.users u2
                     WHERE u2.company_id = mr.company_id
                     ORDER BY u2.created_at LIMIT 1) AS operator_email,
                   -- Occupancy and turn pressure, the two things that make a
                   -- silent vendor urgent rather than merely annoying.
                   EXISTS (SELECT 1 FROM traxkey.bookings b
                            WHERE b.unit_id = mr.unit_id AND NOT b.is_blocked
                              AND b.checkin_date <= CURRENT_DATE
                              AND b.checkout_date > CURRENT_DATE) AS guest_in_unit,
                   (SELECT min(t.deadline_at) FROM traxkey.turns t
                     WHERE t.unit_id = mr.unit_id
                       AND t.status NOT IN ('ready','relisted','occupied')) AS turn_deadline,
                   EXTRACT(EPOCH FROM (now() - COALESCE(mr.last_chased_at, mr.created_at))) / 3600 AS hours_since
            FROM traxkey.maintenance_requests mr
            JOIN traxkey.vendors v ON v.id = mr.assigned_vendor_id
            JOIN traxkey.companies c ON c.id = mr.company_id
            LEFT JOIN traxkey.units u ON u.id = mr.unit_id
            LEFT JOIN traxkey.properties p ON p.id = u.property_id
            WHERE mr.status = 'scheduled'
              AND mr.vendor_acknowledged_at IS NULL
              AND mr.chase_count <= %s
            """,
            (MAX_CHASES,),
        )
        return [dict(r) for r in cur.fetchall()]


def _wait_hours(row):
    """How long to wait before the next nudge on this job."""
    base = row.get("chase_after_hours") or DEFAULT_WAIT_HOURS.get(row.get("urgency") or "routine", 24)
    # A guest in the unit, or a turn due within a day, halves the patience.
    if row.get("guest_in_unit"):
        base = base / 2
    deadline = row.get("turn_deadline")
    if deadline:
        days_left = (deadline - datetime.now(timezone.utc).date()).days
        if days_left <= 1:
            base = base / 2
    # Later nudges wait the same again, not longer.
    return max(base * (REPEAT_MULTIPLIER if row["chase_count"] else 1), 0.5)


REPLY_DOMAIN = os.environ.get("REPLY_DOMAIN", "notify.traxkey.ai")


def _send(to, subject, html, reply_to=None):
    if not RESEND_API_KEY or not to:
        return False
    payload = {"from": f"TraxKey AI Dispatch <{NOTIFY_FROM_ADDRESS}>",
               "to": to, "subject": subject, "html": html}
    if reply_to:
        payload["reply_to"] = reply_to
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json=payload,
            timeout=10,
        )
        r.raise_for_status()
        return True
    except Exception:
        traceback.print_exc()
        return False


def _where(row):
    return f"{row.get('property_name') or ''}{' Unit ' + row['unit_number'] if row.get('unit_number') else ''}".strip() or "your property"


def nudge_vendor(row):
    n = row["chase_count"] + 1
    urgent_note = ""
    if row.get("guest_in_unit"):
        urgent_note = "<p><strong>There is a guest in the unit right now.</strong></p>"
    elif row.get("turn_deadline"):
        urgent_note = f"<p><strong>This unit has to be ready by {esc(row['turn_deadline'])}.</strong></p>"

    html = f"""<div style="font-family: Arial, sans-serif; font-size:14px; color:#1e293b;">
<p>Hi {esc(row['vendor_name'])},</p>
<p>Following up on the {esc(row['category'] or '')} job at {esc(_where(row))}, sent {n} message{'s' if n > 1 else ''} ago with no reply yet.</p>
<p><strong>Issue:</strong> {esc(row['description'])}</p>
{urgent_note}
<p>Can you confirm whether you're able to take it? If not, just say so and it goes to someone else, no hard feelings.</p>
<p style="font-size:11px;color:#94a3b8;margin-top:24px;">Sent automatically by TraxKey AI.</p>
</div>"""
    sent = _send(row["contact_email"], f"Still need you: {row['category'] or 'job'} at {_where(row)}", html,
                 reply_to=f"reply+mr-{row['id']}@{REPLY_DOMAIN}")

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE traxkey.maintenance_requests SET chase_count = chase_count + 1, last_chased_at = now() WHERE id = %s",
            (row["id"],),
        )
        cur.execute(
            "INSERT INTO traxkey.maintenance_events (request_id, event_type, content) VALUES (%s, 'vendor_chased', %s)",
            (row["id"], f"Nudge {n} sent to {row['vendor_name']}, no response after {round(row['hours_since'])}h."
                        + ("" if sent else " (email did not send)")),
        )
    return sent


def escalate(row):
    """Chased enough. Stop, tell the operator, and name the next-best vendor
    so the decision is one click rather than a research task."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT v.name, COALESCE(vp.completion_rate,0) AS cr, COALESCE(vp.avg_rating,0) AS ar
            FROM traxkey.vendors v
            LEFT JOIN traxkey.vendor_performance vp ON vp.vendor_id = v.id
            WHERE v.company_id = %s AND v.trade = %s AND v.id <> %s
            ORDER BY COALESCE(vp.completion_rate,0) DESC, COALESCE(vp.avg_rating,0) DESC
            LIMIT 1
            """,
            (row["company_id"], row["category"], row["vendor_id"]),
        )
        alt = cur.fetchone()

        suggestion = (f"Next best {row['category']} vendor on your list is {alt['name']}."
                      if alt else f"You have no other {row['category']} vendor on file.")

        cur.execute(
            "UPDATE traxkey.maintenance_requests SET status = 'needs_vendor', chase_count = chase_count + 1, last_chased_at = now() WHERE id = %s",
            (row["id"],),
        )
        cur.execute(
            "INSERT INTO traxkey.maintenance_events (request_id, event_type, content) VALUES (%s, 'vendor_unresponsive', %s)",
            (row["id"], f"{row['vendor_name']} never responded after {MAX_CHASES} nudges. Back to needs-vendor. {suggestion}"),
        )

    if row.get("operator_email"):
        html = f"""<div style="font-family: Arial, sans-serif; font-size:14px; color:#1e293b;">
<p>{esc(row['vendor_name'])} hasn't responded to the {esc(row['category'] or '')} job at {esc(_where(row))} after {MAX_CHASES} follow-ups.</p>
<p><strong>Issue:</strong> {esc(row['description'])}</p>
<p>It's back to needing a vendor. {suggestion}</p>
<p><a href="https://app.traxkey.ai/activity">Open it in TraxKey</a></p>
<p style="font-size:11px;color:#94a3b8;margin-top:24px;">Sent automatically by TraxKey AI.</p>
</div>"""
        _send(row["operator_email"], f"No response from {row['vendor_name']}", html)


def acknowledge(request_id):
    """Called when a vendor confirms or starts work. Stops the chase."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE traxkey.maintenance_requests SET vendor_acknowledged_at = now() WHERE id = %s::uuid AND vendor_acknowledged_at IS NULL RETURNING id",
            (request_id,),
        )
        return cur.fetchone() is not None


def run_vendor_chase():
    for row in find_silent_vendors():
        try:
            if row["hours_since"] < _wait_hours(row):
                continue
            if row["chase_count"] >= MAX_CHASES:
                escalate(row)
            else:
                nudge_vendor(row)
        except Exception:
            traceback.print_exc()
