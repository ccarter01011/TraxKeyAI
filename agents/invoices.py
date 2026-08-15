"""Invoice and AR tracking. Visibility, not money movement.

TraxKey shows what is outstanding and chases it by email. It does not
process payments, hold funds, or do trust accounting. Marking an invoice
paid is a bookkeeping note the operator makes after the money arrives
somewhere else. That line is deliberate and should stay.

Same shape as ordered items: a number, a date, and who owes it. All SQL.
Whether an invoice is overdue is a fact, not a judgement.
"""

from db import db


def list_customers(company_id):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.id, c.name, c.email, c.cc_email, c.auto_email_enabled, c.notes,
                   COUNT(i.id) FILTER (WHERE i.status = 'open') AS open_count,
                   COALESCE(SUM(i.amount) FILTER (WHERE i.status = 'open'), 0) AS open_amount
            FROM traxkey.invoice_customers c
            LEFT JOIN traxkey.invoices i ON i.customer_id = c.id
            WHERE c.company_id = %s
            GROUP BY c.id
            ORDER BY c.name
            """,
            (company_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def list_invoices(company_id):
    """Open invoices plus recently settled ones, with overdue days worked out.

    effective_auto_email resolves the per-invoice override against the
    customer default here rather than in the UI, so the dashboard and the
    chase agent can never disagree about whether an invoice gets chased.
    """
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT i.id, i.invoice_number, i.amount, i.issued_on, i.due_on,
                   i.paid_on, i.status, i.notes, i.chase_count, i.last_chased_at,
                   i.cc_email, i.auto_email_enabled,
                   c.id AS customer_id, c.name AS customer_name, c.email AS customer_email,
                   c.cc_email AS customer_cc_email,
                   COALESCE(i.auto_email_enabled, c.auto_email_enabled) AS effective_auto_email,
                   COALESCE(i.cc_email, c.cc_email) AS effective_cc_email,
                   CASE WHEN i.status = 'open' AND i.due_on < CURRENT_DATE
                        THEN (CURRENT_DATE - i.due_on) ELSE NULL END AS days_overdue
            FROM traxkey.invoices i
            JOIN traxkey.invoice_customers c ON c.id = i.customer_id
            WHERE i.company_id = %s
              AND (i.status = 'open' OR i.paid_on > CURRENT_DATE - 30)
            ORDER BY
              CASE WHEN i.status = 'open' THEN 0 ELSE 1 END,
              i.due_on
            """,
            (company_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def ar_summary(company_id):
    """Outstanding totals bucketed by age. The number an operator wants
    before they want the list."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              COALESCE(SUM(amount), 0) AS total_open,
              COALESCE(SUM(amount) FILTER (WHERE due_on >= CURRENT_DATE), 0) AS current_amt,
              COALESCE(SUM(amount) FILTER (WHERE due_on < CURRENT_DATE
                       AND due_on >= CURRENT_DATE - 30), 0) AS overdue_1_30,
              COALESCE(SUM(amount) FILTER (WHERE due_on < CURRENT_DATE - 30
                       AND due_on >= CURRENT_DATE - 60), 0) AS overdue_31_60,
              COALESCE(SUM(amount) FILTER (WHERE due_on < CURRENT_DATE - 60), 0) AS overdue_60_plus,
              COUNT(*) FILTER (WHERE due_on < CURRENT_DATE) AS overdue_count
            FROM traxkey.invoices
            WHERE company_id = %s AND status = 'open'
            """,
            (company_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else {}


def create_customer(company_id, body):
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip()
    if not name:
        return {"ok": False, "error": "Name the customer."}
    if not email:
        return {"ok": False, "error": "An email is needed to chase anything."}

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.invoice_customers
              (company_id, name, email, cc_email, auto_email_enabled, notes)
            VALUES (%(c)s, %(name)s, %(email)s, NULLIF(%(cc)s, ''), %(auto)s, NULLIF(%(notes)s, ''))
            RETURNING id
            """,
            {"c": company_id, "name": name, "email": email,
             "cc": (body.get("ccEmail") or "").strip(),
             "auto": bool(body.get("autoEmailEnabled", True)),
             "notes": (body.get("notes") or "").strip()},
        )
        row = cur.fetchone()
    return {"ok": True, "id": str(row["id"])} if row else {"ok": False, "error": "Could not save that."}


def set_customer_prefs(company_id, customer_id, body):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.invoice_customers
            SET cc_email = NULLIF(%(cc)s, ''),
                auto_email_enabled = %(auto)s,
                updated_at = now()
            WHERE id = %(id)s::uuid AND company_id = %(c)s
            RETURNING id
            """,
            {"cc": (body.get("ccEmail") or "").strip(),
             "auto": bool(body.get("autoEmailEnabled", True)),
             "id": customer_id, "c": company_id},
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "Not found."}


def create_invoice(company_id, body):
    """Tenant-scoped: the customer must belong to the caller's company,
    enforced in SQL rather than trusted from the client."""
    number = (body.get("invoiceNumber") or "").strip()
    amount = str(body.get("amount") or "").strip()
    due = (body.get("dueOn") or "").strip()
    customer = (body.get("customerId") or "").strip()

    if not number:
        return {"ok": False, "error": "An invoice number is needed."}
    if not amount:
        return {"ok": False, "error": "An amount is needed."}
    if not due:
        return {"ok": False, "error": "A due date is needed."}
    if not customer:
        return {"ok": False, "error": "Pick a customer."}

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.invoices
              (company_id, customer_id, invoice_number, amount, issued_on, due_on,
               cc_email, auto_email_enabled, notes)
            SELECT %(c)s, cust.id, %(num)s, %(amt)s::numeric,
                   COALESCE(NULLIF(%(iss)s, '')::date, CURRENT_DATE),
                   %(due)s::date,
                   NULLIF(%(cc)s, ''), %(auto)s, NULLIF(%(notes)s, '')
            FROM traxkey.invoice_customers cust
            WHERE cust.id = %(cust)s::uuid AND cust.company_id = %(c)s
            RETURNING id
            """,
            {"c": company_id, "num": number, "amt": amount,
             "iss": (body.get("issuedOn") or "").strip(), "due": due,
             "cc": (body.get("ccEmail") or "").strip(),
             "auto": body.get("autoEmailEnabled"),
             "notes": (body.get("notes") or "").strip(),
             "cust": customer},
        )
        row = cur.fetchone()
    if not row:
        return {"ok": False, "error": "Could not save that. Check the customer and that the invoice number is not already used."}
    return {"ok": True, "id": str(row["id"])}


def set_invoice_status(company_id, invoice_id, status):
    """Marking paid is a bookkeeping note. No funds move through TraxKey."""
    if status not in ("open", "paid", "cancelled"):
        return {"ok": False, "error": "Unknown status."}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.invoices
            SET status = %s,
                paid_on = CASE WHEN %s = 'paid' THEN CURRENT_DATE ELSE NULL END,
                updated_at = now()
            WHERE id = %s::uuid AND company_id = %s
            RETURNING id
            """,
            (status, status, invoice_id, company_id),
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "Not found."}


def set_invoice_prefs(company_id, invoice_id, body):
    """Per-invoice override of the customer default. Passing null for either
    field falls back to whatever the customer is set to."""
    auto = body.get("autoEmailEnabled")
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.invoices
            SET cc_email = NULLIF(%(cc)s, ''),
                auto_email_enabled = %(auto)s,
                updated_at = now()
            WHERE id = %(id)s::uuid AND company_id = %(c)s
            RETURNING id
            """,
            {"cc": (body.get("ccEmail") or "").strip(),
             "auto": None if auto is None else bool(auto),
             "id": invoice_id, "c": company_id},
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "Not found."}
