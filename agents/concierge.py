"""AI concierge briefing.

Answers one question for the operator: what actually needs me today?

Same split as everywhere else in this system. Every fact below is plain SQL,
counted from real data. Claude only writes the sentence that ties them
together. It cannot invent a number, and if it hallucinated one the
underlying items are still listed alongside it.
"""

import os
import json
import traceback

from anthropic import Anthropic

from db import db

anthropic_client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def validate_session(token):
    """Returns company_id, or None. Same sessions table n8n uses."""
    if not token:
        return None
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT company_id FROM traxkey.sessions WHERE token = %s AND expires_at > now()",
            (token,),
        )
        row = cur.fetchone()
    return str(row["company_id"]) if row else None


def gather_facts(company_id):
    """Everything the briefing is allowed to talk about. All deterministic."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              (SELECT count(*) FROM traxkey.maintenance_requests
                WHERE company_id = %(c)s AND status = 'awaiting_approval') AS awaiting_approval,
              (SELECT count(*) FROM traxkey.maintenance_requests
                WHERE company_id = %(c)s AND status = 'needs_vendor') AS needs_vendor,
              (SELECT count(*) FROM traxkey.maintenance_requests
                WHERE company_id = %(c)s AND status IN ('scheduled','in_progress')) AS in_flight,
              (SELECT count(*) FROM traxkey.maintenance_requests
                WHERE company_id = %(c)s AND urgency = 'emergency'
                  AND status NOT IN ('completed','closed')) AS open_emergencies,
              (SELECT count(*) FROM traxkey.turns
                WHERE company_id = %(c)s AND status NOT IN ('ready','relisted','occupied')) AS open_turns,
              (SELECT count(*) FROM traxkey.turns t
                WHERE t.company_id = %(c)s AND t.status NOT IN ('ready','relisted','occupied')
                  AND t.deadline_at IS NOT NULL AND t.deadline_at <= CURRENT_DATE + 1) AS urgent_turns,
              (SELECT count(*) FROM traxkey.units u
                JOIN traxkey.properties p ON p.id = u.property_id
                WHERE p.company_id = %(c)s) AS total_units,
              (SELECT count(*) FROM traxkey.vendors WHERE company_id = %(c)s) AS vendor_count
            """,
            {"c": company_id},
        )
        counts = cur.fetchone()

        # The specific items behind those counts, so the UI can list them
        # and the operator can act without hunting.
        cur.execute(
            """
            SELECT mr.id, mr.description, mr.status, mr.urgency, mr.quoted_cost,
                   u.unit_number, p.name AS property_name
            FROM traxkey.maintenance_requests mr
            LEFT JOIN traxkey.units u ON u.id = mr.unit_id
            LEFT JOIN traxkey.properties p ON p.id = u.property_id
            WHERE mr.company_id = %(c)s
              AND (mr.status IN ('awaiting_approval','needs_vendor')
                   OR (mr.urgency = 'emergency' AND mr.status NOT IN ('completed','closed')))
            ORDER BY
              CASE mr.status WHEN 'awaiting_approval' THEN 1 WHEN 'needs_vendor' THEN 2 ELSE 3 END,
              mr.created_at
            LIMIT 8
            """,
            {"c": company_id},
        )
        action_items = cur.fetchall()

        cur.execute(
            """
            SELECT t.id, t.deadline_at, t.turn_type, u.unit_number, p.name AS property_name
            FROM traxkey.turns t
            JOIN traxkey.units u ON u.id = t.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE t.company_id = %(c)s
              AND t.status NOT IN ('ready','relisted','occupied')
              AND t.deadline_at IS NOT NULL
              AND t.deadline_at <= CURRENT_DATE + 2
            ORDER BY t.deadline_at
            LIMIT 5
            """,
            {"c": company_id},
        )
        urgent_turn_rows = cur.fetchall()

    return {
        "counts": dict(counts),
        "action_items": [dict(r) for r in action_items],
        "urgent_turns": [dict(r) for r in urgent_turn_rows],
    }


# The persona below is a condensed version of a full AI-COO framework the
# operator asked for. Sections that depend on data we don't collect yet
# (pricing/ADR, guest messaging, KPI dashboards) are deliberately left out
# rather than faked — the "never invent facts" rule applies to the prompt
# itself, not just its output. Expand this as those data sources land.
PERSONA = """You are the AI Chief Operating Officer for a property management
and short-term-rental business, briefing the owner or property manager who
runs it day to day.

Priority order when things compete for attention, unless the facts below
clearly say otherwise:
1. Guest/resident safety and legal or lease obligations
2. Guest experience and fast problem resolution
3. Property protection and preventive maintenance
4. Cost and cash flow
5. Reputation and reviews
6. Operational efficiency

Rules:
- Use only the facts given below. Never invent a number, a property name, a
  cost, a date, or a guest detail. If something isn't in the facts, don't
  claim to know it.
- Never state legal, tax, insurance, or fair-housing conclusions as certain.
  If one of those is implicated, say so and recommend the operator verify
  with a qualified professional, don't rule on it yourself.
- Never expose or repeat access codes, tokens, or full contact details, even
  if they're present in the underlying data.
- Say what TraxKey already handled versus what needs the operator's decision.
  Don't ask them to chase something already dispatched.
- Plain, direct language. No greeting, no filler, no em dashes."""


def build_briefing(facts):
    """Claude writes the narrative and the to-do bullets. The facts, and
    their priority ranking, are already decided in Python — the model is
    only trusted to phrase them, per PERSONA's "never invent" rule."""
    c = facts["counts"]

    # Nothing going on, don't spend a token inventing urgency.
    if not any([c["awaiting_approval"], c["needs_vendor"], c["open_emergencies"],
                c["urgent_turns"], c["in_flight"], c["open_turns"]]):
        if not c["total_units"]:
            return "Add your first property and unit, then share a resident link, and I'll start handling maintenance requests as they come in.", []
        return "Nothing needs you right now. No open requests, no turns waiting, nothing overdue.", []

    turn_lines = "\n".join(
        f"- {t['property_name']}{' Unit ' + t['unit_number'] if t['unit_number'] else ''}: "
        f"{'cleaning' if t['turn_type'] == 'cleaning' else 'turnover'} due {t['deadline_at']}"
        for t in facts["urgent_turns"]
    )
    item_lines = "\n".join(
        f"- {i['description']} ({i['status'].replace('_',' ')}"
        + (f", est ${int(i['quoted_cost'])}" if i.get("quoted_cost") else "")
        + f") at {i['property_name']}{' Unit ' + i['unit_number'] if i['unit_number'] else ''}"
        for i in facts["action_items"]
    )

    prompt = f"""Here is the real state of the portfolio right now:

Counts:
- {c['awaiting_approval']} maintenance request(s) waiting on their approval
- {c['needs_vendor']} request(s) with no vendor available for that trade
- {c['open_emergencies']} open emergency request(s)
- {c['in_flight']} job(s) dispatched and in progress
- {c['open_turns']} turn(s) in progress, {c['urgent_turns']} due within a day
- {c['total_units']} units, {c['vendor_count']} vendors on file

{('Turns with a near deadline:' + chr(10) + turn_lines) if turn_lines else ''}
{('Items needing attention:' + chr(10) + item_lines) if item_lines else ''}

Respond in exactly this shape:
Line 1: one short sentence, the single most important thing right now, ranked
by the priority order in your instructions.
Then, one bullet per line, each starting with "- ", for the specific next
actions the operator should take today. 2 to 5 bullets. Each bullet is one
short, concrete action, not a restatement of a count. Skip anything already
fully handled with nothing left for them to do."""

    response = anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        temperature=0.3,
        system=PERSONA,
        messages=[{"role": "user", "content": prompt}],
    )
    text = response.content[0].text.strip()

    lines = [l.strip() for l in text.split("\n") if l.strip()]
    lead = lines[0] if lines else text
    todos = [l[1:].strip() for l in lines[1:] if l.startswith("-")]
    return lead, todos


def get_briefing(token):
    company_id = validate_session(token)
    if not company_id:
        return None

    facts = gather_facts(company_id)
    try:
        greeting, todos = build_briefing(facts)
    except Exception:
        # A briefing failure must never blank the dashboard. Fall back to the
        # counts, which are the part that actually matters.
        traceback.print_exc()
        c = facts["counts"]
        greeting = (
            f"{c['awaiting_approval']} waiting on approval, {c['needs_vendor']} need a vendor, "
            f"{c['in_flight']} jobs in progress."
        )
        todos = []

    return {
        "greeting": greeting,
        "todos": todos,
        "counts": facts["counts"],
        "action_items": [
            {
                "id": str(i["id"]),
                "description": i["description"],
                "status": i["status"],
                "location": f"{i['property_name']}{' Unit ' + i['unit_number'] if i['unit_number'] else ''}",
            }
            for i in facts["action_items"]
        ],
    }
