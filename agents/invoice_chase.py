"""Invoice Chase Agent, and the supplier half of ordered items.

Same loop as the Vendor Chase Agent, pointed at two other parties who go
quiet: a customer who owes on an invoice, and a supplier sitting on a part
that is holding up a turn.

TraxKey chases; it never collects. These emails ask someone to pay or to
ship, they do not take a payment. No card, no funds, no trust account.

Escalation is deterministic, three steps, no LLM:

    1st nudge   polite reminder
    2nd nudge   firmer reminder, operator copied
    3rd         stop chasing, hand it to the operator

Age compresses nothing here the way urgency does for vendors: an invoice
30 days overdue is chased on the same ladder as one 3 days overdue, just
sooner into it. The operator can turn the whole thing off per customer or
per invoice, which is why effective_auto_email is resolved in SQL.
"""

import os
import traceback

import requests

from db import db
from escaping import esc

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
NOTIFY_FROM_ADDRESS = os.environ.get("NOTIFY_FROM_ADDRESS", "dispatch@notify.traxkey.ai")

# Days past due before the first reminder, and the gap between reminders.
DEFAULT_CHASE_AFTER_DAYS = 3
REPEAT_GAP_DAYS = 7
MAX_CHASES = 2  # after this many nudges, stop and hand it to the operator

# Suppliers get chased on days late against the expected delivery date.
SUPPLIER_CHASE_AFTER_DAYS = 1
SUPPLIER_REPEAT_GAP_DAYS = 3


REPLY_DOMAIN = os.environ.get("REPLY_DOMAIN", "notify.traxkey.ai")


def _send(to, subject, html, cc=None, reply_to=None):
    if not RESEND_API_KEY or not to:
        return False
    payload = {"from": f"TraxKey AI <{NOTIFY_FROM_ADDRESS}>",
               "to": to, "subject": subject, "html": html}
    if cc:
        payload["cc"] = cc
    if reply_to:
        payload["reply_to"] = reply_to
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json=payload,
            timeout=10,
        )
        r.raise_for_status()
        return True
    except Exception:
        traceback.print_exc()
        return False


def _money(amount):
    try:
        return f"${float(amount):,.2f}"
    except (TypeError, ValueError):
        return str(amount)


# --------------------------------------------------------------------------
# Invoices
# --------------------------------------------------------------------------

def find_overdue_invoices():
    """Open invoices past due where auto-chase is on and enough time has
    passed for the next step. All SQL, including the per-invoice override of
    the customer default."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT i.id, i.invoice_number, i.amount, i.due_on, i.chase_count,
                   (CURRENT_DATE - i.due_on) AS days_overdue,
                   COALESCE(i.cc_email, c.cc_email) AS cc_email,
                   c.name AS customer_name, c.email AS customer_email,
                   co.invoice_chase_after_days,
                   co.name AS company_name,
                   (SELECT u.email FROM traxkey.users u
                     WHERE u.company_id = co.id ORDER BY u.created_at LIMIT 1) AS operator_email,
                   EXTRACT(EPOCH FROM (now() - COALESCE(i.last_chased_at,
                     i.due_on::timestamptz))) / 86400 AS days_since
            FROM traxkey.invoices i
            JOIN traxkey.invoice_customers c ON c.id = i.customer_id
            JOIN traxkey.companies co ON co.id = i.company_id
            WHERE i.status = 'open'
              AND i.due_on < CURRENT_DATE
              AND COALESCE(i.auto_email_enabled, c.auto_email_enabled) IS TRUE
              AND i.chase_count <= %s
            """,
            (MAX_CHASES,),
        )
        return [dict(r) for r in cur.fetchall()]


def _invoice_due(row):
    """Days of silence required before the next nudge on this invoice."""
    first = row.get("invoice_chase_after_days") or DEFAULT_CHASE_AFTER_DAYS
    return first if not row.get("chase_count") else REPEAT_GAP_DAYS


def nudge_invoice(row):
    overdue = int(row.get("days_overdue") or 0)
    firm = (row.get("chase_count") or 0) >= 1
    amount = _money(row.get("amount"))
    subject = (f"Second reminder: invoice {row['invoice_number']} is {overdue} days overdue"
               if firm else
               f"Reminder: invoice {row['invoice_number']} is past due")
    html = f"""
      <p>Hi {esc(row.get('customer_name') or 'there')},</p>
      <p>Invoice <strong>{esc(row['invoice_number'])}</strong> for <strong>{esc(amount)}</strong>
         was due on {esc(row['due_on'])}, which is {overdue} day{'s' if overdue != 1 else ''} ago.</p>
      <p>{'Please let us know when we can expect payment, or reply if something is wrong with this invoice.'
          if firm else 'If it has already been sent, please ignore this note.'}</p>
      <p>&mdash; {esc(row.get('company_name') or 'Property management')}</p>
    """
    cc = [row["cc_email"]] if row.get("cc_email") else None
    if firm and row.get("operator_email"):
        cc = (cc or []) + [row["operator_email"]]

    sent = _send([row["customer_email"]], subject, html, cc=cc,
                 reply_to=f"reply+inv-{row['id']}@{REPLY_DOMAIN}")
    if not sent:
        return False

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.invoices
            SET chase_count = chase_count + 1, last_chased_at = now(), updated_at = now()
            WHERE id = %s
            """,
            (row["id"],),
        )
    return True


def escalate_invoice(row):
    """Stop chasing and tell the operator. TraxKey does not decide what to do
    about an unpaid invoice; that is a business call, not an automated one."""
    overdue = int(row.get("days_overdue") or 0)
    amount = _money(row.get("amount"))
    if row.get("operator_email"):
        _send(
            [row["operator_email"]],
            f"No response on invoice {row['invoice_number']} ({amount})",
            f"""
              <p>{esc(row.get('customer_name'))} has not responded to
                 {MAX_CHASES} reminders on invoice
                 <strong>{esc(row['invoice_number'])}</strong> for <strong>{esc(amount)}</strong>,
                 now {overdue} days overdue.</p>
              <p>TraxKey has stopped chasing this one. It is yours from here.</p>
            """,
        )
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.invoices
            SET chase_count = chase_count + 1, last_chased_at = now(), updated_at = now()
            WHERE id = %s
            """,
            (row["id"],),
        )
    return True


# --------------------------------------------------------------------------
# Ordered items (suppliers)
# --------------------------------------------------------------------------

def find_late_items():
    """Ordered items past their expected date with a supplier email and
    auto-chase left on."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT oi.id, oi.description, oi.reference, oi.supplier,
                   oi.supplier_email, oi.cc_email, oi.chase_count, oi.expected_on,
                   (CURRENT_DATE - oi.expected_on) AS days_late,
                   co.name AS company_name,
                   (SELECT u.email FROM traxkey.users u
                     WHERE u.company_id = co.id ORDER BY u.created_at LIMIT 1) AS operator_email,
                   EXTRACT(EPOCH FROM (now() - COALESCE(oi.last_chased_at,
                     oi.expected_on::timestamptz))) / 86400 AS days_since
            FROM traxkey.ordered_items oi
            JOIN traxkey.companies co ON co.id = oi.company_id
            WHERE oi.status = 'ordered'
              AND oi.auto_email_enabled IS TRUE
              AND oi.supplier_email IS NOT NULL
              AND oi.expected_on IS NOT NULL
              AND oi.expected_on < CURRENT_DATE
              AND oi.chase_count <= %s
            """,
            (MAX_CHASES,),
        )
        return [dict(r) for r in cur.fetchall()]


def nudge_supplier(row):
    late = int(row.get("days_late") or 0)
    firm = (row.get("chase_count") or 0) >= 1
    ref = f" (ref {esc(row['reference'])})" if row.get("reference") else ""
    subject = (f"Second request: {row['description']} is {late} days late"
               if firm else
               f"Checking on {row['description']}")
    html = f"""
      <p>Hi {esc(row.get('supplier') or 'there')},</p>
      <p>We were expecting <strong>{esc(row['description'])}</strong>{ref} on
         {esc(row['expected_on'])}, which is {late} day{'s' if late != 1 else ''} ago.</p>
      <p>{'This is holding up work on our end. Can you confirm a firm ship date?'
          if firm else 'Could you confirm when it will ship?'}</p>
      <p>&mdash; {esc(row.get('company_name') or 'Property management')}</p>
    """
    cc = [row["cc_email"]] if row.get("cc_email") else None
    if firm and row.get("operator_email"):
        cc = (cc or []) + [row["operator_email"]]

    if not _send([row["supplier_email"]], subject, html, cc=cc,
                 reply_to=f"reply+oi-{row['id']}@{REPLY_DOMAIN}"):
        return False

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.ordered_items
            SET chase_count = chase_count + 1, last_chased_at = now(), updated_at = now()
            WHERE id = %s
            """,
            (row["id"],),
        )
    return True


def escalate_item(row):
    late = int(row.get("days_late") or 0)
    if row.get("operator_email"):
        _send(
            [row["operator_email"]],
            f"No response from {row.get('supplier') or 'supplier'} on {row['description']}",
            f"""
              <p><strong>{esc(row['description'])}</strong> is {late} days late and the
                 supplier has not answered {MAX_CHASES} requests.</p>
              <p>TraxKey has stopped chasing. If this is blocking a turn, you may
                 want to source it elsewhere.</p>
            """,
        )
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.ordered_items
            SET chase_count = chase_count + 1, last_chased_at = now(), updated_at = now()
            WHERE id = %s
            """,
            (row["id"],),
        )
    return True


def run_invoice_chase():
    """One pass over both ladders. Safe to call on every loop: each row
    carries its own due check, so nothing is chased early."""
    for row in find_overdue_invoices():
        try:
            if (row.get("days_since") or 0) < _invoice_due(row):
                continue
            if (row.get("chase_count") or 0) >= MAX_CHASES:
                escalate_invoice(row)
            else:
                nudge_invoice(row)
        except Exception:
            traceback.print_exc()

    for row in find_late_items():
        try:
            gap = SUPPLIER_CHASE_AFTER_DAYS if not row.get("chase_count") else SUPPLIER_REPEAT_GAP_DAYS
            if (row.get("days_since") or 0) < gap:
                continue
            if (row.get("chase_count") or 0) >= MAX_CHASES:
                escalate_item(row)
            else:
                nudge_supplier(row)
        except Exception:
            traceback.print_exc()
