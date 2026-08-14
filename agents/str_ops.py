"""Short-term rental supplies and checkout damage.

Both built on machinery that already exists rather than as new subsystems.
Cleaners are already vendors with a portal login, so "report what's low" is
an addition to a relationship that exists. Checkout damage is evidence
capture, the same shape as an inspection item.

All SQL. Whether stock is below its reorder point is arithmetic.
"""

from db import db


# ----------------------------------------------------------------- supplies

def list_supplies(company_id):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.item, s.par_level, s.current_level, s.reorder_at, s.unit_label,
                   s.unit_id, u.unit_number, p.name AS property_name,
                   (s.current_level IS NOT NULL AND s.reorder_at IS NOT NULL
                    AND s.current_level <= s.reorder_at) AS is_low
            FROM traxkey.unit_supplies s
            JOIN traxkey.units u ON u.id = s.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE p.company_id = %s
            ORDER BY
              (s.current_level IS NOT NULL AND s.reorder_at IS NOT NULL
               AND s.current_level <= s.reorder_at) DESC,
              p.name, u.unit_number NULLS FIRST, s.item
            """,
            (company_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def upsert_supply(company_id, body):
    item = (body.get("item") or "").strip()
    unit_id = (body.get("unitId") or "").strip()
    if not item or not unit_id:
        return {"ok": False, "error": "Pick a unit and name the item."}

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.unit_supplies
              (unit_id, item, par_level, current_level, reorder_at, unit_label)
            SELECT u.id, %(item)s,
                   NULLIF(%(par)s, '')::int,
                   NULLIF(%(cur)s, '')::int,
                   NULLIF(%(re)s, '')::int,
                   NULLIF(%(lbl)s, '')
            FROM traxkey.units u
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE u.id = %(unit)s::uuid AND p.company_id = %(c)s
            ON CONFLICT (unit_id, item) DO UPDATE SET
              par_level = EXCLUDED.par_level,
              current_level = EXCLUDED.current_level,
              reorder_at = EXCLUDED.reorder_at,
              unit_label = EXCLUDED.unit_label,
              updated_at = now()
            RETURNING id
            """,
            {"c": company_id, "unit": unit_id, "item": item,
             "par": str(body.get("parLevel") or "").strip(),
             "cur": str(body.get("currentLevel") or "").strip(),
             "re": str(body.get("reorderAt") or "").strip(),
             "lbl": (body.get("unitLabel") or "").strip()},
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "That unit was not found."}


def delete_supply(company_id, supply_id):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM traxkey.unit_supplies s
            USING traxkey.units u, traxkey.properties p
            WHERE s.id = %s::uuid AND s.unit_id = u.id AND u.property_id = p.id
              AND p.company_id = %s
            RETURNING s.id
            """,
            (supply_id, company_id),
        )
        return {"ok": cur.fetchone() is not None}


def low_supply_insights(company_id):
    """Feeds Portfolio Insights. Grouped per unit so an operator gets one
    line per unit rather than one per towel."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.name AS property_name, u.unit_number,
                   string_agg(s.item, ', ' ORDER BY s.item) AS items,
                   count(*) AS n
            FROM traxkey.unit_supplies s
            JOIN traxkey.units u ON u.id = s.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE p.company_id = %s
              AND s.current_level IS NOT NULL AND s.reorder_at IS NOT NULL
              AND s.current_level <= s.reorder_at
            GROUP BY p.name, u.unit_number
            """,
            (company_id,),
        )
        out = []
        for r in cur.fetchall():
            where = f"{r['property_name']}{' Unit ' + r['unit_number'] if r['unit_number'] else ''}"
            out.append({
                "kind": "low_supplies",
                "severity": "medium",
                "text": f"{where} is low on {r['items']}.",
                "action": "Restock before the next turn, or the cleaner will find out for you.",
            })
        return out


# -------------------------------------------------------------------- damage

def list_damage(company_id):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT d.id, d.description, d.estimated_cost, d.claim_status, d.reported_by,
                   d.created_at, u.unit_number, p.name AS property_name,
                   b.checkin_date, b.checkout_date, b.guest_label
            FROM traxkey.checkout_damage d
            JOIN traxkey.units u ON u.id = d.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            LEFT JOIN traxkey.bookings b ON b.id = d.booking_id
            WHERE d.company_id = %s
            ORDER BY d.created_at DESC
            LIMIT 100
            """,
            (company_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def record_damage(company_id, body):
    desc = (body.get("description") or "").strip()
    unit_id = (body.get("unitId") or "").strip()
    if not desc or not unit_id:
        return {"ok": False, "error": "Pick a unit and describe the damage."}

    with db() as conn, conn.cursor() as cur:
        # The booking is resolved server-side from the unit and the stay that
        # just ended, rather than trusted from the client. That is what makes
        # the record attributable to a specific stay.
        cur.execute(
            """
            INSERT INTO traxkey.checkout_damage
              (company_id, unit_id, booking_id, description, estimated_cost, reported_by)
            SELECT %(c)s, u.id,
                   (SELECT b.id FROM traxkey.bookings b
                     WHERE b.unit_id = u.id AND NOT b.is_blocked
                       AND b.checkout_date <= CURRENT_DATE
                     ORDER BY b.checkout_date DESC LIMIT 1),
                   %(desc)s,
                   NULLIF(%(cost)s, '')::numeric,
                   NULLIF(%(by)s, '')
            FROM traxkey.units u
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE u.id = %(unit)s::uuid AND p.company_id = %(c)s
            RETURNING id
            """,
            {"c": company_id, "unit": unit_id, "desc": desc,
             "cost": str(body.get("estimatedCost") or "").strip(),
             "by": (body.get("reportedBy") or "").strip()},
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "That unit was not found."}


def set_claim_status(company_id, damage_id, status):
    if status not in ("recorded", "claiming", "resolved", "dropped"):
        return {"ok": False, "error": "Unknown status."}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE traxkey.checkout_damage SET claim_status = %s WHERE id = %s::uuid AND company_id = %s RETURNING id",
            (status, damage_id, company_id),
        )
        return {"ok": cur.fetchone() is not None}
