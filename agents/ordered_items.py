"""Ordered items that block a turn or a repair.

The narrow, useful half of TraxSail's purchase-order tracking. Not
procurement: an item, an expected date, and what it holds up.

The insight this makes possible is the one an operator actually cares
about, and it needs both halves of TraxKey to compute:

    "The flooring for Unit 4B is 5 days late and that turn is due Friday."

A procurement tool knows the item is late. A property tool knows the turn is
due. Only a system holding both can tell you the late item is the reason the
unit will not be ready.

All SQL. Whether a delivery date has passed is a fact.
"""

from db import db


def list_items(company_id):
    """Outstanding and recently received items, with lateness and what each
    one blocks already worked out."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT oi.id, oi.description, oi.supplier, oi.reference, oi.cost,
                   oi.ordered_on, oi.expected_on, oi.received_on, oi.status, oi.notes,
                   u.unit_number, p.name AS property_name,
                   t.deadline_at AS turn_deadline, t.status AS turn_status,
                   CASE WHEN oi.status = 'ordered' AND oi.expected_on IS NOT NULL
                        THEN (CURRENT_DATE - oi.expected_on) ELSE NULL END AS days_late
            FROM traxkey.ordered_items oi
            LEFT JOIN traxkey.units u ON u.id = oi.unit_id
            LEFT JOIN traxkey.properties p ON p.id = u.property_id
            LEFT JOIN traxkey.turns t ON t.id = oi.turn_id
            WHERE oi.company_id = %s
              AND (oi.status = 'ordered' OR oi.received_on > CURRENT_DATE - 30)
            ORDER BY
              CASE WHEN oi.status = 'ordered' THEN 0 ELSE 1 END,
              oi.expected_on NULLS LAST
            """,
            (company_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def blocking_insights(company_id):
    """Late items that are holding up a turn with a deadline. Fed to the
    concierge, because this is exactly the kind of thing that is obvious in
    hindsight and invisible on the day."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT oi.description, oi.supplier,
                   (CURRENT_DATE - oi.expected_on) AS days_late,
                   t.deadline_at,
                   (t.deadline_at - CURRENT_DATE) AS days_to_deadline,
                   u.unit_number, p.name AS property_name
            FROM traxkey.ordered_items oi
            JOIN traxkey.turns t ON t.id = oi.turn_id
            LEFT JOIN traxkey.units u ON u.id = oi.unit_id
            LEFT JOIN traxkey.properties p ON p.id = u.property_id
            WHERE oi.company_id = %s
              AND oi.status = 'ordered'
              AND oi.expected_on IS NOT NULL
              AND oi.expected_on < CURRENT_DATE
              AND t.status NOT IN ('ready', 'relisted', 'occupied')
              AND t.deadline_at IS NOT NULL
            ORDER BY t.deadline_at
            """,
            (company_id,),
        )
        out = []
        for r in cur.fetchall():
            where = f"{r['property_name'] or ''}{' Unit ' + r['unit_number'] if r['unit_number'] else ''}".strip()
            late = r["days_late"]
            due = r["days_to_deadline"]
            when = "today" if due == 0 else (f"in {due} days" if due > 0 else f"{abs(due)} days ago")
            out.append({
                "kind": "late_item_blocking_turn",
                "severity": "high" if due is not None and due <= 2 else "medium",
                "text": f"{r['description']} is {late} day{'s' if late != 1 else ''} late"
                        f"{' from ' + r['supplier'] if r['supplier'] else ''}, "
                        f"and the turn at {where} is due {when}.",
                "action": "Chase the supplier, or plan the turn around it.",
            })
        return out


def create(company_id, body):
    """Add an ordered item. Tenant-scoped: unit and turn must belong to the
    caller's company, checked in SQL rather than trusted from the client."""
    desc = (body.get("description") or "").strip()
    if not desc:
        return {"ok": False, "error": "Describe what was ordered."}

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.ordered_items
              (company_id, description, supplier, reference, cost, expected_on, unit_id, turn_id, notes)
            SELECT %(c)s, %(desc)s,
                   NULLIF(%(sup)s, ''), NULLIF(%(ref)s, ''),
                   NULLIF(%(cost)s, '')::numeric,
                   NULLIF(%(exp)s, '')::date,
                   u.id, t.id,
                   NULLIF(%(notes)s, '')
            FROM (SELECT 1) x
            LEFT JOIN traxkey.units u
              ON u.id = NULLIF(%(unit)s, '')::uuid
             AND EXISTS (SELECT 1 FROM traxkey.properties p
                          WHERE p.id = u.property_id AND p.company_id = %(c)s)
            LEFT JOIN traxkey.turns t
              ON t.id = NULLIF(%(turn)s, '')::uuid AND t.company_id = %(c)s
            RETURNING id
            """,
            {"c": company_id, "desc": desc,
             "sup": (body.get("supplier") or "").strip(),
             "ref": (body.get("reference") or "").strip(),
             "cost": str(body.get("cost") or "").strip(),
             "exp": (body.get("expectedOn") or "").strip(),
             "unit": (body.get("unitId") or "").strip(),
             "turn": (body.get("turnId") or "").strip(),
             "notes": (body.get("notes") or "").strip()},
        )
        row = cur.fetchone()
    return {"ok": True, "id": str(row["id"])} if row else {"ok": False, "error": "Could not save that."}


def set_status(company_id, item_id, status):
    if status not in ("received", "cancelled", "ordered"):
        return {"ok": False, "error": "Unknown status."}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.ordered_items
            SET status = %s,
                received_on = CASE WHEN %s = 'received' THEN CURRENT_DATE ELSE NULL END,
                updated_at = now()
            WHERE id = %s::uuid AND company_id = %s
            RETURNING id
            """,
            (status, status, item_id, company_id),
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "Not found."}
