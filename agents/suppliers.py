"""Suppliers: the master-data half of ordered items (agents/ordered_items.py).

A supplier used to be free text retyped on every order (schema_v23's
deliberate "no supplier catalogue" scope). This is the reversal of that
scope decision: a real row, referenced by ordered_items.supplier_id, with a
company-level default contact and auto-chase setting that a per-order
override can inherit from (null = inherit) - same pattern invoice_customers
already uses for the billing side.

on_time_rate here is computed from this company's own order history, not
an industry benchmark or a third-party score: how often did an order from
this supplier NOT end up late, out of every non-cancelled order recorded.
Unlike a black-box vendor score, an operator (or a future us) can see
exactly which orders that percentage came from by reading the same
ordered_items rows the pricing/insights code already reads.
"""

from db import db


def list_suppliers(company_id):
    """Every supplier plus lateness history computed from their own order
    record on this account - never an industry benchmark, since that would
    imply data TraxKey doesn't have."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.name, s.contact_email, s.cc_email, s.contact_phone,
                   s.auto_email_enabled, s.notes,
                   COUNT(oi.id) FILTER (WHERE oi.status != 'cancelled') AS total_orders,
                   COUNT(oi.id) FILTER (
                     WHERE (oi.status = 'received' AND oi.received_on > oi.expected_on)
                        OR (oi.status = 'ordered' AND oi.expected_on IS NOT NULL AND oi.expected_on < CURRENT_DATE)
                   ) AS late_count,
                   COUNT(oi.id) FILTER (WHERE oi.status = 'ordered') AS open_count,
                   MAX(oi.ordered_on) AS last_ordered_on
            FROM traxkey.suppliers s
            LEFT JOIN traxkey.ordered_items oi ON oi.supplier_id = s.id
            WHERE s.company_id = %s
            GROUP BY s.id
            ORDER BY s.name
            """,
            (company_id,),
        )
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        total = r.pop("total_orders") or 0
        late = r["late_count"] or 0
        # None (not a percentage, just "no history yet") rather than 100,
        # so a brand-new supplier with zero orders doesn't look like a
        # proven perfect record on day one.
        r["on_time_rate"] = round((total - late) / total * 100) if total else None
        r["total_orders"] = total
    return rows


def create_supplier(company_id, body):
    name = (body.get("name") or "").strip()
    if not name:
        return {"ok": False, "error": "Name is required."}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.suppliers
              (company_id, name, contact_email, cc_email, contact_phone, auto_email_enabled, notes)
            VALUES (%(c)s, %(name)s, NULLIF(%(email)s, ''), NULLIF(%(cc)s, ''),
                    NULLIF(%(phone)s, ''), %(auto)s, NULLIF(%(notes)s, ''))
            ON CONFLICT (company_id, name) DO NOTHING
            RETURNING id, name, contact_email, cc_email, contact_phone, auto_email_enabled, notes
            """,
            {"c": company_id, "name": name,
             "email": (body.get("contactEmail") or "").strip(),
             "cc": (body.get("ccEmail") or "").strip(),
             "phone": (body.get("contactPhone") or "").strip(),
             "auto": bool(body.get("autoEmailEnabled", True)),
             "notes": (body.get("notes") or "").strip()},
        )
        row = cur.fetchone()
    if not row:
        return {"ok": False, "error": "A supplier with that name already exists."}
    out = dict(row)
    out["id"] = str(out["id"])
    out["total_orders"] = 0
    out["late_count"] = 0
    out["open_count"] = 0
    out["last_ordered_on"] = None
    out["on_time_rate"] = None
    return {"ok": True, "supplier": out}


def update_supplier(company_id, supplier_id, body):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.suppliers
            SET contact_email = NULLIF(%(email)s, ''),
                cc_email = NULLIF(%(cc)s, ''),
                contact_phone = NULLIF(%(phone)s, ''),
                auto_email_enabled = %(auto)s,
                notes = NULLIF(%(notes)s, ''),
                updated_at = now()
            WHERE id = %(id)s::uuid AND company_id = %(c)s
            RETURNING id
            """,
            {"id": supplier_id, "c": company_id,
             "email": (body.get("contactEmail") or "").strip(),
             "cc": (body.get("ccEmail") or "").strip(),
             "phone": (body.get("contactPhone") or "").strip(),
             "auto": bool(body.get("autoEmailEnabled", True)),
             "notes": (body.get("notes") or "").strip()},
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "Not found."}


def delete_supplier(company_id, supplier_id):
    """Deletes the supplier row only. ordered_items.supplier_id is
    ON DELETE SET NULL (schema_v42), so past orders keep their own record,
    they just lose the link rather than being deleted with the supplier -
    unlike TraxSail, where deleting a supplier cascades to its POs."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM traxkey.suppliers WHERE id = %s::uuid AND company_id = %s RETURNING id",
            (supplier_id, company_id),
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "Not found."}
