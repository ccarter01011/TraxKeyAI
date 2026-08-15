"""CSV import and export for invoices and ordered items.

An operator who already runs a business has this data somewhere else: a
spreadsheet, QuickBooks, whatever their bookkeeper sends. Typing forty open
invoices in one at a time is the reason a tool gets abandoned in week one.

Import is two steps on purpose, preview then commit. The preview says
exactly what will be created, what is already there, and which rows are
broken, before anything is written. Nobody should discover a bad import by
finding 40 wrong rows in their dashboard.

Export exists because the same operator should be able to get their data
back out. A tool you cannot leave is a tool people are reluctant to enter.

All deterministic. Parsing a date is not a judgement call.
"""

import csv
import io
from datetime import datetime

from db import db

# Header aliases, so an export from QuickBooks or a hand-made sheet both
# work without the operator renaming columns first.
INVOICE_FIELDS = {
    "invoice_number": ("invoice number", "invoice #", "invoice", "number", "invoice_no", "doc number"),
    "customer": ("customer", "customer name", "client", "bill to", "name"),
    "email": ("email", "customer email", "e-mail", "bill to email"),
    "amount": ("amount", "total", "balance", "amount due", "open balance"),
    "issued_on": ("issued", "issued on", "date", "invoice date", "issue date"),
    "due_on": ("due", "due on", "due date"),
    "notes": ("notes", "memo", "description"),
}

ITEM_FIELDS = {
    "description": ("description", "item", "what", "part", "material"),
    "supplier": ("supplier", "vendor", "from"),
    "reference": ("reference", "po", "po number", "po #", "order number", "order #"),
    "cost": ("cost", "price", "amount", "total"),
    "expected_on": ("expected", "expected on", "expected date", "eta", "due"),
    "supplier_email": ("supplier email", "vendor email", "email"),
    "notes": ("notes", "memo"),
}

DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%d/%m/%Y", "%b %d, %Y", "%d-%b-%Y", "%Y/%m/%d")


def _map_headers(fieldnames, spec):
    """Match the file's headers to our fields, case and space insensitive."""
    out = {}
    seen = {(f or "").strip().lower(): f for f in (fieldnames or [])}
    for field, aliases in spec.items():
        for alias in aliases:
            if alias in seen:
                out[field] = seen[alias]
                break
    return out


def _date(raw):
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return "bad"


def _money(raw):
    raw = (raw or "").strip().replace("$", "").replace(",", "").replace("(", "-").replace(")", "")
    if not raw:
        return None
    try:
        return round(float(raw), 2)
    except ValueError:
        return "bad"


def _read(csv_text):
    try:
        reader = csv.DictReader(io.StringIO((csv_text or "").lstrip("﻿")))
        return list(reader), reader.fieldnames, None
    except Exception as e:
        return [], None, f"Could not read that file: {e}"


# --------------------------------------------------------------------------
# Invoices
# --------------------------------------------------------------------------

def preview_invoices(company_id, csv_text):
    rows, headers, err = _read(csv_text)
    if err:
        return {"ok": False, "error": err}
    cols = _map_headers(headers, INVOICE_FIELDS)

    missing = [f for f in ("invoice_number", "customer", "amount", "due_on") if f not in cols]
    if missing:
        return {"ok": False, "error": "Missing required column(s): " + ", ".join(
            m.replace("_", " ") for m in missing) + ". Found: " + ", ".join(headers or ["nothing"])}

    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT lower(invoice_number) AS n FROM traxkey.invoices WHERE company_id = %s", (company_id,))
        existing = {r["n"] for r in cur.fetchall()}
        cur.execute("SELECT id, lower(name) AS n, email FROM traxkey.invoice_customers WHERE company_id = %s", (company_id,))
        customers = {r["n"]: r for r in cur.fetchall()}

    out, new_customers, seen_numbers = [], {}, set()
    for i, r in enumerate(rows, start=2):  # row 1 is the header
        num = (r.get(cols["invoice_number"]) or "").strip()
        cust = (r.get(cols["customer"]) or "").strip()
        amount = _money(r.get(cols["amount"]))
        due = _date(r.get(cols["due_on"]))
        issued = _date(r.get(cols.get("issued_on", ""))) if cols.get("issued_on") else None
        email = (r.get(cols["email"]) or "").strip() if cols.get("email") else ""

        problems = []
        if not num:
            problems.append("no invoice number")
        if not cust:
            problems.append("no customer")
        if amount is None:
            problems.append("no amount")
        elif amount == "bad":
            problems.append("amount is not a number")
        if due is None:
            problems.append("no due date")
        elif due == "bad":
            problems.append("due date not recognised")
        if issued == "bad":
            problems.append("issued date not recognised")

        key = num.lower()
        status, note = "new", ""
        if problems:
            status, note = "error", "; ".join(problems)
        elif key in existing:
            status, note = "duplicate", "already in TraxKey, will be skipped"
        elif key in seen_numbers:
            status, note = "duplicate", "appears twice in this file, will be skipped"
        else:
            seen_numbers.add(key)
            if cust.lower() not in customers and cust.lower() not in new_customers:
                if not email:
                    status, note = "error", f"{cust} is new, so an email column is needed to create them"
                else:
                    new_customers[cust.lower()] = email
                    note = f"will also create customer {cust}"

        out.append({
            "row": i, "status": status, "note": note,
            "invoice_number": num, "customer": cust,
            "amount": None if amount in (None, "bad") else amount,
            "due_on": str(due) if due not in (None, "bad") else None,
        })

    return {
        "ok": True, "kind": "invoices", "rows": out,
        "counts": {
            "new": sum(1 for r in out if r["status"] == "new"),
            "duplicate": sum(1 for r in out if r["status"] == "duplicate"),
            "error": sum(1 for r in out if r["status"] == "error"),
            "new_customers": len(new_customers),
        },
    }


def commit_invoices(company_id, csv_text, auto_email=False):
    """Insert only the rows the preview called new. Re-parses rather than
    trusting a client-supplied row list, so what gets written is always what
    is in the file."""
    pre = preview_invoices(company_id, csv_text)
    if not pre.get("ok"):
        return pre

    rows, headers, _ = _read(csv_text)
    cols = _map_headers(headers, INVOICE_FIELDS)
    good = {r["row"] for r in pre["rows"] if r["status"] == "new"}

    created_customers = created_invoices = 0
    with db() as conn, conn.cursor() as cur:
        for i, r in enumerate(rows, start=2):
            if i not in good:
                continue
            cust = (r.get(cols["customer"]) or "").strip()
            email = (r.get(cols["email"]) or "").strip() if cols.get("email") else ""

            cur.execute(
                "SELECT id FROM traxkey.invoice_customers WHERE company_id = %s AND lower(name) = lower(%s)",
                (company_id, cust),
            )
            found = cur.fetchone()
            if found:
                cust_id = found["id"]
            else:
                cur.execute(
                    """INSERT INTO traxkey.invoice_customers (company_id, name, email, auto_email_enabled)
                       VALUES (%s, %s, %s, %s) RETURNING id""",
                    (company_id, cust, email, auto_email),
                )
                cust_id = cur.fetchone()["id"]
                created_customers += 1

            issued = _date(r.get(cols.get("issued_on", ""))) if cols.get("issued_on") else None
            cur.execute(
                """INSERT INTO traxkey.invoices
                     (company_id, customer_id, invoice_number, amount, issued_on, due_on, notes)
                   VALUES (%s, %s, %s, %s, COALESCE(%s, CURRENT_DATE), %s, %s)
                   ON CONFLICT (company_id, invoice_number) DO NOTHING""",
                (company_id, cust_id, (r.get(cols["invoice_number"]) or "").strip(),
                 _money(r.get(cols["amount"])),
                 issued if issued not in (None, "bad") else None,
                 _date(r.get(cols["due_on"])),
                 (r.get(cols["notes"]) or "").strip() if cols.get("notes") else None),
            )
            created_invoices += cur.rowcount

    return {"ok": True, "created_invoices": created_invoices,
            "created_customers": created_customers,
            "skipped": pre["counts"]["duplicate"] + pre["counts"]["error"]}


# --------------------------------------------------------------------------
# Ordered items
# --------------------------------------------------------------------------

def preview_items(company_id, csv_text):
    rows, headers, err = _read(csv_text)
    if err:
        return {"ok": False, "error": err}
    cols = _map_headers(headers, ITEM_FIELDS)
    if "description" not in cols:
        return {"ok": False, "error": "Missing required column: description (or item). Found: "
                + ", ".join(headers or ["nothing"])}

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT lower(reference) AS r FROM traxkey.ordered_items
               WHERE company_id = %s AND reference IS NOT NULL""", (company_id,))
        existing_refs = {r["r"] for r in cur.fetchall()}

    out, seen = [], set()
    for i, r in enumerate(rows, start=2):
        desc = (r.get(cols["description"]) or "").strip()
        ref = (r.get(cols["reference"]) or "").strip() if cols.get("reference") else ""
        exp = _date(r.get(cols.get("expected_on", ""))) if cols.get("expected_on") else None
        cost = _money(r.get(cols.get("cost", ""))) if cols.get("cost") else None

        problems = []
        if not desc:
            problems.append("no description")
        if exp == "bad":
            problems.append("expected date not recognised")
        if cost == "bad":
            problems.append("cost is not a number")

        status, note = "new", ""
        if problems:
            status, note = "error", "; ".join(problems)
        elif ref and ref.lower() in existing_refs:
            status, note = "duplicate", f"PO {ref} already in TraxKey, will be skipped"
        elif ref and ref.lower() in seen:
            status, note = "duplicate", f"PO {ref} appears twice in this file, will be skipped"
        elif ref:
            seen.add(ref.lower())

        out.append({
            "row": i, "status": status, "note": note,
            "description": desc, "reference": ref,
            "supplier": (r.get(cols["supplier"]) or "").strip() if cols.get("supplier") else "",
            "expected_on": str(exp) if exp not in (None, "bad") else None,
        })

    return {
        "ok": True, "kind": "orders", "rows": out,
        "counts": {
            "new": sum(1 for r in out if r["status"] == "new"),
            "duplicate": sum(1 for r in out if r["status"] == "duplicate"),
            "error": sum(1 for r in out if r["status"] == "error"),
            "new_customers": 0,
        },
    }


def commit_items(company_id, csv_text, auto_email=False):
    pre = preview_items(company_id, csv_text)
    if not pre.get("ok"):
        return pre

    rows, headers, _ = _read(csv_text)
    cols = _map_headers(headers, ITEM_FIELDS)
    good = {r["row"] for r in pre["rows"] if r["status"] == "new"}

    created = 0
    with db() as conn, conn.cursor() as cur:
        for i, r in enumerate(rows, start=2):
            if i not in good:
                continue
            exp = _date(r.get(cols.get("expected_on", ""))) if cols.get("expected_on") else None
            cost = _money(r.get(cols.get("cost", ""))) if cols.get("cost") else None
            cur.execute(
                """INSERT INTO traxkey.ordered_items
                     (company_id, description, supplier, reference, cost, expected_on,
                      supplier_email, notes, auto_email_enabled)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (company_id,
                 (r.get(cols["description"]) or "").strip(),
                 (r.get(cols["supplier"]) or "").strip() or None if cols.get("supplier") else None,
                 (r.get(cols["reference"]) or "").strip() or None if cols.get("reference") else None,
                 cost if cost not in (None, "bad") else None,
                 exp if exp not in (None, "bad") else None,
                 (r.get(cols["supplier_email"]) or "").strip() or None if cols.get("supplier_email") else None,
                 (r.get(cols["notes"]) or "").strip() or None if cols.get("notes") else None,
                 auto_email),
            )
            created += 1

    return {"ok": True, "created_invoices": 0, "created_items": created,
            "created_customers": 0,
            "skipped": pre["counts"]["duplicate"] + pre["counts"]["error"]}


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------

def _csv(header, rows):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue()


def export_invoices(company_id):
    """Everything, including settled invoices. An export that silently drops
    history is not an export."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT i.invoice_number, c.name, c.email, i.amount, i.issued_on, i.due_on,
                   i.status, i.paid_on, i.chase_count, i.last_chased_at,
                   COALESCE(i.cc_email, c.cc_email) AS cc,
                   COALESCE(i.auto_email_enabled, c.auto_email_enabled) AS auto_on,
                   i.notes
            FROM traxkey.invoices i
            JOIN traxkey.invoice_customers c ON c.id = i.customer_id
            WHERE i.company_id = %s
            ORDER BY i.due_on DESC
            """, (company_id,))
        rows = [[r["invoice_number"], r["name"], r["email"], r["amount"], r["issued_on"],
                 r["due_on"], r["status"], r["paid_on"], r["chase_count"],
                 r["last_chased_at"], r["cc"], r["auto_on"], r["notes"]] for r in cur.fetchall()]
    return _csv(["Invoice Number", "Customer", "Email", "Amount", "Issued", "Due", "Status",
                 "Paid On", "Reminders Sent", "Last Reminder", "CC", "Auto Reminders", "Notes"], rows)


def export_items(company_id):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT oi.description, oi.supplier, oi.supplier_email, oi.reference, oi.cost,
                   oi.ordered_on, oi.expected_on, oi.received_on, oi.status,
                   oi.chase_count, oi.cc_email, oi.auto_email_enabled, oi.notes,
                   p.name AS property_name, u.unit_number
            FROM traxkey.ordered_items oi
            LEFT JOIN traxkey.units u ON u.id = oi.unit_id
            LEFT JOIN traxkey.properties p ON p.id = u.property_id
            WHERE oi.company_id = %s
            ORDER BY oi.ordered_on DESC
            """, (company_id,))
        rows = [[r["description"], r["supplier"], r["supplier_email"], r["reference"], r["cost"],
                 r["ordered_on"], r["expected_on"], r["received_on"], r["status"],
                 r["chase_count"], r["cc_email"], r["auto_email_enabled"], r["notes"],
                 r["property_name"], r["unit_number"]] for r in cur.fetchall()]
    return _csv(["Description", "Supplier", "Supplier Email", "PO / Reference", "Cost",
                 "Ordered", "Expected", "Received", "Status", "Reminders Sent", "CC",
                 "Auto Reminders", "Notes", "Property", "Unit"], rows)


TEMPLATES = {
    "invoices": _csv(
        ["Invoice Number", "Customer", "Email", "Amount", "Issued", "Due", "Notes"],
        [["INV-1001", "Maple Street LLC", "billing@example.com", "1250.00", "2026-07-01", "2026-07-31", "July management fee"]]),
    "orders": _csv(
        ["Description", "Supplier", "Supplier Email", "PO Number", "Cost", "Expected", "Notes"],
        [["Water heater, 50 gal", "Ferguson", "orders@example.com", "PO-4471", "820.00", "2026-08-20", "For Unit 4B"]]),
}
