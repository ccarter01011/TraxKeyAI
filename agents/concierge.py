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


def build_briefing(facts):
    """Claude writes the narrative. The facts are already decided."""
    c = facts["counts"]

    # Nothing going on, don't spend a token inventing urgency.
    if not any([c["awaiting_approval"], c["needs_vendor"], c["open_emergencies"],
                c["urgent_turns"], c["in_flight"], c["open_turns"]]):
        if not c["total_units"]:
            return "Add your first property and unit, then share a resident link, and I'll start handling maintenance requests as they come in."
        return "Nothing needs you right now. No open requests, no turns waiting, nothing overdue."

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

    prompt = f"""You brief a property manager at the start of their day. Here is
the real state of their portfolio right now:

Counts:
- {c['awaiting_approval']} maintenance request(s) waiting on their approval
- {c['needs_vendor']} request(s) with no vendor available for that trade
- {c['open_emergencies']} open emergency request(s)
- {c['in_flight']} job(s) dispatched and in progress
- {c['open_turns']} turn(s) in progress, {c['urgent_turns']} due within a day
- {c['total_units']} units, {c['vendor_count']} vendors on file

{('Turns with a near deadline:' + chr(10) + turn_lines) if turn_lines else ''}
{('Items needing attention:' + chr(10) + item_lines) if item_lines else ''}

Write 2 to 4 short sentences telling them what actually matters today.

Rules:
- Lead with whatever is most urgent. Anything blocking on their approval, or
  a turn due today, comes first.
- Use only the numbers above. Never invent a figure or a property name.
- Say what YOU (TraxKey) already handled, and what needs THEM. Things already
  dispatched are handled, don't ask them to chase those.
- Plain, direct language. No greeting, no "I hope", no filler, no bullet points.
- Never use em dashes."""

    response = anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        temperature=0.3,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text.strip()


def get_briefing(token):
    company_id = validate_session(token)
    if not company_id:
        return None

    facts = gather_facts(company_id)
    try:
        greeting = build_briefing(facts)
    except Exception:
        # A briefing failure must never blank the dashboard. Fall back to the
        # counts, which are the part that actually matters.
        traceback.print_exc()
        c = facts["counts"]
        greeting = (
            f"{c['awaiting_approval']} waiting on approval, {c['needs_vendor']} need a vendor, "
            f"{c['in_flight']} jobs in progress."
        )

    return {
        "greeting": greeting,
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
