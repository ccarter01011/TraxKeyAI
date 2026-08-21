"""48-hour free-tier upgrade nudge.

A company that signed up and is still on the Free tier 48 hours later is
a different situation from a lead who never signed up at all
(lead_followup.py handles that one): this is a real account, already using
TraxKey, that just hasn't had a reason to pay yet. One plain email, once,
same "no drip sequence" philosophy as the lead follow-up - a company that
doesn't respond gets a human's attention next, not a string of automated
reminders.

Every tier is the same platform; the only thing a paid tier buys is more
units (see traxkey-marketing-site/index.html's pricing section: "tiers
differ ONLY by unit count and price"). So the honest pitch here is about
headroom, not features TraxKey is holding back on Free.
"""

import os
import traceback

import requests

from db import db
from escaping import esc

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
FOLLOWUP_FROM_ADDRESS = os.environ.get("FOLLOWUP_FROM_ADDRESS", "team@notify.traxkey.ai")
FREE_TIER_NUDGE_AFTER_HOURS = 48


def find_free_tier_companies_due_for_nudge():
    """A company is due if: still on the Free plan, 48+ hours since signup,
    and never nudged before. Reads the earliest user's email as the
    operator's own login, same pattern invoice_chase.py already uses for
    "operator_email"."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT co.id, co.name,
                   (SELECT u.name FROM traxkey.users u
                     WHERE u.company_id = co.id ORDER BY u.created_at LIMIT 1) AS operator_name,
                   (SELECT u.email FROM traxkey.users u
                     WHERE u.company_id = co.id ORDER BY u.created_at LIMIT 1) AS operator_email,
                   (SELECT count(*) FROM traxkey.properties p WHERE p.company_id = co.id) AS property_count,
                   (SELECT count(*) FROM traxkey.units un
                     JOIN traxkey.properties p ON p.id = un.property_id
                     WHERE p.company_id = co.id) AS unit_count
            FROM traxkey.companies co
            WHERE co.plan = 'free'
              AND co.free_tier_nudge_sent_at IS NULL
              AND co.created_at <= now() - make_interval(hours => %s)
            """,
            (FREE_TIER_NUDGE_AFTER_HOURS,),
        )
        return cur.fetchall()


def send_nudge(company):
    first_name = (company["operator_name"] or "").split(" ")[0] or "there"
    units = company["unit_count"] or 0
    if units >= 1:
        progress = (f"You've already got {units} unit{'s' if units != 1 else ''} set up, "
                    "the Free tier holds one, so more units is the only reason to move up.")
    else:
        progress = ("You haven't added a property yet, no rush, this is just here for when "
                    "you're ready.")

    html = f"""<div style="font-family: Arial, sans-serif; font-size:14px; color:#1e293b; max-width:520px;">
<p>Hi {esc(first_name)},</p>
<p>You signed up for TraxKey AI a couple of days ago on the Free tier. No
pressure, just checking in.</p>
<p>{esc(progress)}</p>
<p>Every tier is the exact same platform, maintenance coordination, dynamic
pricing, invoices, the AI concierge, all of it. Paid tiers only raise the
unit limit: Starter at $99/mo for up to 15 units, Growth at $249/mo for up
to 50, Pro at $549/mo for up to 150. No setup fee, no contract, cancel any
time.</p>
<ul style="padding-left:18px;">
  <li>See the tiers: <a href="https://traxkey.ai/#pricing">traxkey.ai/#pricing</a></li>
  <li>Have a question, or hit something the Free tier doesn't cover? Just
    reply to this email, it goes to a person, not the chatbot.</li>
</ul>
<p style="font-size:11px;color:#94a3b8;margin-top:24px;">TraxKey AI</p>
</div>"""

    response = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
        json={
            "from": f"TraxKey AI <{FOLLOWUP_FROM_ADDRESS}>",
            "to": company["operator_email"],
            "subject": "How's TraxKey going so far?",
            "html": html,
        },
        timeout=10,
    )
    response.raise_for_status()


def run_free_tier_followup():
    if not RESEND_API_KEY:
        return
    companies = find_free_tier_companies_due_for_nudge()
    sent = 0
    with db() as conn, conn.cursor() as cur:
        for company in companies:
            if not company.get("operator_email"):
                # No user row yet somehow, nothing to send to and nothing
                # to retry productively, mark it sent so this doesn't spin.
                cur.execute(
                    "UPDATE traxkey.companies SET free_tier_nudge_sent_at = now() WHERE id = %s",
                    (company["id"],),
                )
                continue
            try:
                send_nudge(company)
            except Exception:
                # Leave free_tier_nudge_sent_at NULL on a send failure, so
                # the next pass retries it rather than silently giving up.
                traceback.print_exc()
                continue
            cur.execute(
                "UPDATE traxkey.companies SET free_tier_nudge_sent_at = now() WHERE id = %s",
                (company["id"],),
            )
            sent += 1
    if sent:
        print(f"[free_tier_followup] sent {sent} free-tier nudge email(s)")
