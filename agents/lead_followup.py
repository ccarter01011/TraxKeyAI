"""48-hour lead follow-up.

A lead who asked a human a question and never became a customer is the
cheapest possible re-engagement: they already showed up once. This sends
one invite-and-feedback email, once, 48 hours after they came in, and only
if they haven't already signed up under that email.

Deliberately simple: one email, not a drip sequence. A lead ignored once
gets a human's attention next, not five more automated emails.
"""

import os
import traceback

import requests

from db import db
from escaping import esc

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
FOLLOWUP_FROM_ADDRESS = os.environ.get("FOLLOWUP_FROM_ADDRESS", "team@notify.traxkey.ai")
FOLLOWUP_AFTER_HOURS = 48


def find_leads_due_for_followup():
    """A lead is due if: 48+ hours old, never followed up, and the email
    hasn't since signed up as a real account, that last check is what makes
    this safe to run unattended, a converted lead never gets a cold email."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT l.id, l.name, l.email, l.company, l.message
            FROM traxkey.leads l
            WHERE l.contacted_at IS NULL
              AND l.created_at <= now() - make_interval(hours => %s)
              AND NOT EXISTS (
                SELECT 1 FROM traxkey.users u WHERE lower(u.email) = lower(l.email)
              )
            """,
            (FOLLOWUP_AFTER_HOURS,),
        )
        return cur.fetchall()


def send_followup(lead):
    first_name = (lead["name"] or "").split(" ")[0] or "there"
    html = f"""<div style="font-family: Arial, sans-serif; font-size:14px; color:#1e293b; max-width:520px;">
<p>Hi {esc(first_name)},</p>
<p>You reached out about TraxKey AI a couple of days ago. No pressure, just
checking in, we'd rather ask directly than assume.</p>
<p>Two things:</p>
<ul style="padding-left:18px;">
  <li>If you want to try it, it's free for one unit, no card required:
    <a href="https://app.traxkey.ai/signup">app.traxkey.ai/signup</a></li>
  <li>If you decided it's not a fit, we'd genuinely like to know why, just
    reply to this email. It goes to a person, not the chatbot.</li>
</ul>
<p style="font-size:11px;color:#94a3b8;margin-top:24px;">TraxKey AI</p>
</div>"""

    response = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
        json={
            "from": f"TraxKey AI <{FOLLOWUP_FROM_ADDRESS}>",
            "to": lead["email"],
            "subject": "Still thinking about TraxKey?",
            "html": html,
        },
        timeout=10,
    )
    response.raise_for_status()


def run_lead_followup():
    if not RESEND_API_KEY:
        return
    leads = find_leads_due_for_followup()
    sent = 0
    with db() as conn, conn.cursor() as cur:
        for lead in leads:
            try:
                send_followup(lead)
            except Exception:
                # Leave contacted_at NULL on a send failure, so the next
                # pass retries it rather than silently giving up.
                traceback.print_exc()
                continue
            cur.execute(
                "UPDATE traxkey.leads SET contacted_at = now() WHERE id = %s",
                (lead["id"],),
            )
            sent += 1
    if sent:
        print(f"[lead_followup] sent {sent} follow-up email(s)")
