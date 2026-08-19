"""Feature suggestion box.

Matches TraxSail's. Lives inside the app rather than on the marketing site
because the customer's identity comes from their session, so they type the
idea and nothing else. Asking a paying customer to re-enter their name and
email in order to tell you how to improve your product is a reliable way to
get fewer suggestions.

Who submitted it is captured server-side from the session, never accepted
from the client, so it cannot be spoofed and cannot be attributed to another
company.
"""

import os
import traceback

import requests

from db import db
from escaping import esc

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
NOTIFY_FROM_ADDRESS = os.environ.get("NOTIFY_FROM_ADDRESS", "dispatch@notify.traxkey.ai")
SUGGESTIONS_INBOX = os.environ.get("SUGGESTIONS_INBOX", "traxkey_support@traxkey.ai")

MAX_SUBJECT = 200
MAX_MESSAGE = 4000


def submit(company_id, session_token, subject, message):
    subject = (subject or "").strip()[:MAX_SUBJECT]
    message = (message or "").strip()[:MAX_MESSAGE]
    if not subject:
        return {"ok": False, "error": "Give the idea a one-line summary."}

    with db() as conn, conn.cursor() as cur:
        # Identity from the session, not the request body. The client never
        # gets to say who it is.
        cur.execute(
            """
            SELECT u.id AS user_id, u.name, u.email, c.name AS company_name
            FROM traxkey.sessions s
            JOIN traxkey.users u ON u.id = s.user_id
            JOIN traxkey.companies c ON c.id = s.company_id
            WHERE s.token = %s AND s.expires_at > now()
            """,
            (session_token,),
        )
        who = cur.fetchone()
        if not who:
            return {"ok": False, "error": "Session expired."}

        cur.execute(
            """
            INSERT INTO traxkey.suggestions
              (company_id, user_id, submitted_by_name, submitted_by_email, company_name, subject, message)
            VALUES (%s, %s, %s, %s, %s, %s, NULLIF(%s, ''))
            RETURNING id
            """,
            (company_id, who["user_id"], who["name"], who["email"],
             who["company_name"], subject, message),
        )
        row = cur.fetchone()

    _notify(who, subject, message)
    return {"ok": True, "id": str(row["id"])}


def _notify(who, subject, message):
    """Best effort. A failed email must never lose the suggestion, which is
    already committed by the time this runs."""
    if not RESEND_API_KEY:
        return
    try:
        html = f"""<div style="font-family: Arial, sans-serif; font-size:14px; color:#1e293b;">
<p><strong>{esc(who['name'])}</strong> at <strong>{esc(who['company_name'])}</strong> suggested:</p>
<p style="font-size:16px;font-weight:bold;">{esc(subject)}</p>
<p style="white-space:pre-wrap;">{esc(message) or '(no detail given)'}</p>
<p style="font-size:12px;color:#64748b;">Reply to them at {esc(who['email'])}</p>
</div>"""
        requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json={"from": f"TraxKey AI <{NOTIFY_FROM_ADDRESS}>",
                  "to": SUGGESTIONS_INBOX,
                  "reply_to": who["email"],
                  "subject": f"[Suggestion] {subject}",
                  "html": html},
            timeout=10,
        )
    except Exception:
        traceback.print_exc()


def list_all():
    """Admin-side. Every suggestion across all customers."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, subject, message, status, admin_note, created_at,
                   submitted_by_name, submitted_by_email, company_name
            FROM traxkey.suggestions
            ORDER BY
              CASE status WHEN 'new' THEN 0 WHEN 'considering' THEN 1
                          WHEN 'planned' THEN 2 ELSE 3 END,
              created_at DESC
            LIMIT 200
            """
        )
        return [dict(r) for r in cur.fetchall()]


def set_status(suggestion_id, status, note=None):
    if status not in ("new", "considering", "planned", "built", "declined"):
        return {"ok": False, "error": "Unknown status."}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE traxkey.suggestions SET status = %s, admin_note = COALESCE(NULLIF(%s,''), admin_note) WHERE id = %s::uuid RETURNING id",
            (status, (note or "").strip(), suggestion_id),
        )
        return {"ok": cur.fetchone() is not None}
