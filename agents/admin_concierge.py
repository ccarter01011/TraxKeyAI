"""Admin briefing, for whoever is running TraxKey itself.

Different question than the customer concierge. An operator asks "what needs
me today". You're asking "is this business working, and what should I build
or fix next".

Same discipline: every number is SQL. The AI reads the numbers and says what
it thinks they mean. It's told to be blunt, because a founder dashboard that
flatters you is worse than no dashboard.
"""

import os
import traceback

from anthropic import Anthropic

from db import db

anthropic_client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

PLAN_PRICES = {"trial": 0, "starter": 99, "growth": 249, "scale": 549}


def validate_admin(token):
    if not token:
        return None
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT admin_id FROM traxkey.admin_sessions WHERE token = %s AND expires_at > now()",
            (token,),
        )
        row = cur.fetchone()
    return str(row["admin_id"]) if row else None


def gather_metrics():
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              (SELECT count(*) FROM traxkey.companies) AS companies,
              (SELECT count(*) FROM traxkey.companies WHERE plan_status='trialing') AS trialing,
              (SELECT count(*) FROM traxkey.companies WHERE plan_status='active') AS paying,
              (SELECT count(*) FROM traxkey.companies WHERE created_at > now() - interval '7 days') AS new_7d,
              (SELECT count(*) FROM traxkey.companies WHERE created_at > now() - interval '30 days') AS new_30d,
              (SELECT count(*) FROM traxkey.units) AS units,
              (SELECT count(*) FROM traxkey.vendors) AS vendors,
              (SELECT count(*) FROM traxkey.unit_calendars) AS calendars,
              (SELECT count(*) FROM traxkey.maintenance_requests) AS requests_all,
              (SELECT count(*) FROM traxkey.maintenance_requests WHERE created_at > now() - interval '7 days') AS requests_7d,
              (SELECT count(*) FROM traxkey.maintenance_requests WHERE status IN ('completed','closed')) AS completed,
              (SELECT count(*) FROM traxkey.maintenance_requests WHERE status='needs_vendor') AS stuck_no_vendor,
              (SELECT count(*) FROM traxkey.maintenance_requests WHERE status='awaiting_approval') AS stuck_approval,
              -- How often the AI dispatched without a human, the core value prop.
              (SELECT count(*) FROM traxkey.maintenance_requests
                WHERE status NOT IN ('submitted','triaged') AND requires_human_approval = false) AS auto_dispatched,
              (SELECT count(*) FROM traxkey.turns) AS turns,
              (SELECT count(*) FROM traxkey.turns WHERE auto_created) AS turns_auto,
              (SELECT count(*) FROM traxkey.review_risks) AS review_risks,
              -- Accounts that signed up but never added a unit: the clearest
              -- onboarding drop-off signal available right now.
              (SELECT count(*) FROM traxkey.companies c
                WHERE NOT EXISTS (SELECT 1 FROM traxkey.properties p WHERE p.company_id = c.id)) AS empty_accounts,
              -- Signed up, added units, but never got a real request through.
              (SELECT count(*) FROM traxkey.companies c
                WHERE EXISTS (SELECT 1 FROM traxkey.properties p WHERE p.company_id = c.id)
                  AND NOT EXISTS (SELECT 1 FROM traxkey.maintenance_requests m WHERE m.company_id = c.id)) AS no_activity_accounts
            """
        )
        m = dict(cur.fetchone())

        cur.execute(
            """
            SELECT c.name, c.plan, c.plan_status, c.created_at,
              (SELECT count(*) FROM traxkey.properties p
                JOIN traxkey.units u ON u.property_id = p.id WHERE p.company_id = c.id) AS units,
              (SELECT count(*) FROM traxkey.maintenance_requests m WHERE m.company_id = c.id) AS requests,
              (SELECT max(m.created_at) FROM traxkey.maintenance_requests m WHERE m.company_id = c.id) AS last_activity
            FROM traxkey.companies c
            ORDER BY c.created_at DESC LIMIT 20
            """
        )
        m["accounts"] = [dict(r) for r in cur.fetchall()]

    m["mrr"] = sum(
        PLAN_PRICES.get(a["plan"], 0) for a in m["accounts"] if a["plan_status"] == "active"
    )
    return m


def build_admin_briefing(m):
    if m["companies"] == 0:
        return ("No accounts yet. The product is built and tested, but nobody has signed up. "
                "Right now the bottleneck is distribution, not features. Getting one real "
                "operator using this matters more than anything you could build this week.")

    account_lines = "\n".join(
        f"- {a['name']}: {a['plan']}/{a['plan_status']}, {a['units']} units, "
        f"{a['requests']} requests, last activity "
        + (str(a["last_activity"])[:10] if a["last_activity"] else "never")
        for a in m["accounts"][:10]
    )

    prompt = f"""You advise the founder of TraxKey AI, an early-stage property
management SaaS. Here is the actual state of the business:

Accounts: {m['companies']} total, {m['trialing']} trialing, {m['paying']} paying.
{m['new_7d']} new in 7 days, {m['new_30d']} in 30 days.
Estimated MRR: ${m['mrr']} (derived from plan tier; there is no billing integration yet, so no money has actually been collected).

Usage: {m['units']} units, {m['vendors']} vendors, {m['calendars']} calendars connected.
{m['requests_all']} maintenance requests all time, {m['requests_7d']} in 7 days, {m['completed']} completed.
{m['auto_dispatched']} dispatched without needing human approval.
{m['turns']} turns, {m['turns_auto']} opened automatically from checkouts.
{m['review_risks']} review risks flagged.

Friction signals:
- {m['empty_accounts']} account(s) signed up but never added a property.
- {m['no_activity_accounts']} account(s) added units but never got a maintenance request through.
- {m['stuck_no_vendor']} request(s) stuck with no vendor available.
- {m['stuck_approval']} request(s) waiting on someone's approval.

Accounts:
{account_lines}

Write 3 to 5 sentences telling the founder what these numbers actually mean
and what to do next.

Rules:
- Be blunt. If the numbers are bad, say they're bad. A dashboard that
  flatters him is worse than none.
- Lead with the single most important thing, not a summary.
- If there are almost no customers, say plainly that distribution is the
  problem and building more features is avoidance.
- Point at a specific next action, not a category. "Ask X" or "fix Y", not
  "focus on growth".
- Use only these numbers. Never invent a metric, a benchmark, or an
  industry average.
- No greeting, no filler, no bullet points. Never use em dashes."""

    response = anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=400,
        temperature=0.4,
        messages=[{"role": "user", "content": prompt}],
    )
    text = response.content[0].text.strip()
    return text.replace(" — ", ", ").replace("—", ", ").replace("–", "-")


def get_admin_briefing(token):
    if not validate_admin(token):
        return None
    m = gather_metrics()
    try:
        briefing = build_admin_briefing(m)
    except Exception:
        traceback.print_exc()
        briefing = (f"{m['companies']} accounts, {m['paying']} paying, "
                    f"{m['units']} units, {m['requests_all']} requests all time.")
    return {"briefing": briefing, "metrics": {k: v for k, v in m.items() if k != "accounts"}}
