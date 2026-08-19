"""Keep the resident or guest informed about their own request.

Until this existed, someone reported a broken heater and then heard nothing,
while the tenant portal promised updates it could not deliver. Vendors were
notified, operators were notified, the person actually living with the
problem was not.

Three moments, and only three. A notification the reader does not act on is
noise, and this audience never opted in:

  received    we have it, here is what happens next
  dispatched  a specific company is handling it, and who they are
  completed   it is marked done, tell us if it is not

Deliberately NOT sent:
  - approval pauses. "Your landlord is deciding whether to spend money on
    this" is the operator's business, not the resident's, and it invites a
    conversation the resident cannot resolve.
  - any cost. Quoted or final, that is between the operator and the vendor.
  - vendor phone numbers. The operator owns that relationship.

What we can honestly say is WHO, never WHEN. There is no appointment
scheduling in this system, so any specific timing would be invented. The
tenant portal copy was corrected to match.
"""

import os
import traceback

import requests

from db import db
from escaping import esc

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
NOTIFY_FROM_ADDRESS = os.environ.get("NOTIFY_FROM_ADDRESS", "dispatch@notify.traxkey.ai")

# status -> which notification that status earns
STATUS_TO_TYPE = {
    "submitted": "received",
    "triaged": "received",
    "assigned": "dispatched",
    "scheduled": "dispatched",
    "in_progress": "dispatched",
    "completed": "completed",
    "closed": "completed",
}


# The status -> notification mapping, expressed once as SQL so the
# NOT EXISTS check can compare against the same value it selects.
_TYPE_CASE = """
  CASE mr.status
    WHEN 'submitted'   THEN 'received'
    WHEN 'triaged'     THEN 'received'
    WHEN 'assigned'    THEN 'dispatched'
    WHEN 'scheduled'   THEN 'dispatched'
    WHEN 'in_progress' THEN 'dispatched'
    WHEN 'completed'   THEN 'completed'
    WHEN 'closed'      THEN 'completed'
  END"""


def find_pending():
    """Requests whose current status has earned a notification the resident
    has not been sent yet.

    The NOT EXISTS against resident_notifications is what makes this safe on
    a polling loop. Without it every pass would re-email everyone.

    A request that moves straight from submitted to scheduled between two
    passes only ever gets the 'dispatched' note, never a pointless
    "we got it" thirty seconds before "someone's assigned". That is a
    feature of keying on current status rather than on transitions.
    """
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT mr.id AS request_id, mr.status, mr.description, mr.category,
                   r.name AS resident_name, r.email AS resident_email,
                   v.name AS vendor_name, v.trade AS vendor_trade,
                   c.name AS company_name,
                   u.unit_number, p.name AS property_name,
                   {_TYPE_CASE} AS notification_type
            FROM traxkey.maintenance_requests mr
            JOIN traxkey.residents r ON r.id = mr.resident_id
            JOIN traxkey.companies c ON c.id = mr.company_id
            LEFT JOIN traxkey.vendors v ON v.id = mr.assigned_vendor_id
            LEFT JOIN traxkey.units u ON u.id = mr.unit_id
            LEFT JOIN traxkey.properties p ON p.id = u.property_id
            WHERE r.email IS NOT NULL AND r.email <> ''
              -- Reserved documentation domains, used by the seeded demo
              -- data. Mailing them would bounce every pass and cost real
              -- sender reputation on a domain that was only just verified.
              AND r.email !~* '@(example\\.(com|org|net)|test|localhost)$'
              AND {_TYPE_CASE} IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM traxkey.resident_notifications rn
                WHERE rn.request_id = mr.id
                  AND rn.channel = 'email'
                  AND rn.notification_type = {_TYPE_CASE}
              )
            """
        )
        return [dict(r) for r in cur.fetchall()]


def _body(row):
    # Escaped here rather than at each use: these locals get spliced into
    # several sentences below and then into the HTML body, so escaping once
    # at the source is the only version that cannot be forgotten in a branch.
    who = esc(row["company_name"])
    first = esc((row["resident_name"] or "").split(" ")[0] or "there")
    where = esc(row["property_name"] or "")
    if row.get("unit_number"):
        where = f"{where} Unit {esc(row['unit_number'])}".strip()
    ntype = row["notification_type"]

    if ntype == "received":
        headline = "We got your request"
        # No timing promised. Nothing in this system schedules an
        # appointment, so a specific window would be invented.
        lines = [
            f"Thanks for letting us know. {who} has your request and it's being looked at now.",
            "We'll email you again as soon as someone is assigned to it.",
        ]
    elif ntype == "dispatched":
        headline = "Someone's been assigned"
        if row.get("vendor_name"):
            lines = [
                f"{esc(row['vendor_name'])} is handling this for you.",
                "They'll be in touch to arrange a time that works.",
            ]
        else:
            lines = [
                f"{who} has assigned this and it's in progress.",
                "You'll hear about timing shortly.",
            ]
    else:
        headline = "This is marked as fixed"
        lines = [
            "The work on your request is marked complete.",
            "If it isn't actually sorted, just reply to this email and we'll pick it back up.",
        ]

    para = "".join(f"<p>{l}</p>" for l in lines)
    return headline, f"""<div style="font-family: Arial, sans-serif; font-size:14px; color:#1e293b; max-width:520px;">
<p>Hi {first},</p>
{para}
<p style="background:#f1f5f9;padding:12px;border-radius:8px;color:#475569;font-size:13px;">
<strong>Your request:</strong> {esc(row['description'])}<br>
{('<strong>Property:</strong> ' + where) if where else ''}
</p>
<p style="font-size:11px;color:#94a3b8;margin-top:24px;">Sent by {who} through TraxKey AI.</p>
</div>"""


def send_one(row):
    headline, html = _body(row)
    response = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
        json={
            "from": f"{row['company_name']} <{NOTIFY_FROM_ADDRESS}>",
            "to": row["resident_email"],
            "subject": headline,
            "html": html,
        },
        timeout=10,
    )
    response.raise_for_status()


def run_resident_notifications():
    if not RESEND_API_KEY:
        return
    sent = 0
    for row in find_pending():
        try:
            send_one(row)
        except Exception:
            # Log nothing on failure so the next pass retries. Better a late
            # email than a resident who never hears back.
            traceback.print_exc()
            continue
        try:
            with db() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO traxkey.resident_notifications
                      (request_id, notification_type, channel, sent_to)
                    VALUES (%s, %s, 'email', %s)
                    ON CONFLICT (request_id, notification_type, channel) DO NOTHING
                    """,
                    (row["request_id"], row["notification_type"], row["resident_email"]),
                )
            sent += 1
        except Exception:
            traceback.print_exc()
    if sent:
        print(f"[resident_notify] sent {sent} resident update(s)")
    return sent
