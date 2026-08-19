"""Owner portal: the property manager's own customer.

TraxKey already holds everything an owner asks their manager about, what
broke, what it cost, whether the unit is occupied, and gives them no way to
see it. So the manager answers those questions by hand, from memory, on a
Sunday.

The isolation rule here is stricter than anywhere else in the platform.
Everywhere else, a session is scoped to a company. Here it is scoped to one
owner INSIDE a company, and an owner must never see another owner's
properties even though both belong to the same manager. Every query below
joins through properties.owner_id for that reason, never through
company_id alone.

Deliberately read-only. An owner can see, not act. Approving spend on
someone else's behalf, editing a lease, or messaging a tenant are all things
the manager is paid to do, and handing them to the owner would undermine the
relationship TraxKey is meant to support.
"""

import secrets
from datetime import datetime, timedelta, timezone

from db import db
from escaping import esc

SESSION_DAYS = 30


def login(email, password):
    """Returns a session token, or None. Same bcrypt mechanism as every
    other principal: pgcrypto crypt() against the stored hash."""
    if not email or not password:
        return None
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name FROM traxkey.owners
            WHERE lower(email) = lower(%s)
              AND portal_enabled
              AND password_hash IS NOT NULL
              AND password_hash = crypt(%s, password_hash)
            """,
            (email.strip(), password),
        )
        row = cur.fetchone()
        if not row:
            return None

        token = secrets.token_hex(24)
        cur.execute(
            "INSERT INTO traxkey.owner_sessions (token, owner_id, expires_at) VALUES (%s, %s, %s)",
            (token, row["id"], datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)),
        )
    return {"token": token, "name": row["name"]}


def validate(token):
    """Returns owner_id, or None."""
    if not token:
        return None
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT owner_id FROM traxkey.owner_sessions WHERE token = %s AND expires_at > now()",
            (token,),
        )
        row = cur.fetchone()
    return str(row["owner_id"]) if row else None


def get_dashboard(owner_id):
    """Everything an owner is allowed to see, scoped to their properties.

    Costs are shown because it is the owner's money. Vendor names are shown
    because an owner reasonably wants to know who was in their building.
    What is NOT shown: resident names and contact details, which are the
    manager's relationship and not the owner's business, and anything about
    the manager's other clients.
    """
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT o.name AS owner_name, c.name AS manager_name
            FROM traxkey.owners o
            JOIN traxkey.companies c ON c.id = o.company_id
            WHERE o.id = %s
            """,
            (owner_id,),
        )
        who = cur.fetchone()

        cur.execute(
            """
            SELECT p.id, p.name, p.address_line1, p.city, p.state,
                   count(u.id) AS units,
                   count(u.id) FILTER (WHERE traxkey.unit_is_occupied(u.id)) AS occupied
            FROM traxkey.properties p
            LEFT JOIN traxkey.units u ON u.property_id = p.id
            WHERE p.owner_id = %s
            GROUP BY p.id
            ORDER BY p.name
            """,
            (owner_id,),
        )
        properties = [dict(r) for r in cur.fetchall()]

        # Spend over the last 12 months, per property. The owner's own money,
        # so this is the number they actually came for.
        cur.execute(
            """
            SELECT p.name AS property_name,
                   COALESCE(sum(mr.final_cost), 0) AS spend,
                   count(mr.id) AS jobs
            FROM traxkey.properties p
            LEFT JOIN traxkey.units u ON u.property_id = p.id
            LEFT JOIN traxkey.maintenance_requests mr
              ON mr.unit_id = u.id
             AND mr.final_cost IS NOT NULL
             AND mr.created_at > now() - interval '12 months'
            WHERE p.owner_id = %s
            GROUP BY p.name
            ORDER BY p.name
            """,
            (owner_id,),
        )
        spend = [dict(r) for r in cur.fetchall()]

        # Recent work. No resident identity: who reported it is between the
        # tenant and the manager.
        cur.execute(
            """
            SELECT mr.description, mr.category, mr.status, mr.final_cost, mr.created_at,
                   u.unit_number, p.name AS property_name, v.name AS vendor_name
            FROM traxkey.maintenance_requests mr
            JOIN traxkey.units u ON u.id = mr.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            LEFT JOIN traxkey.vendors v ON v.id = mr.assigned_vendor_id
            WHERE p.owner_id = %s
            ORDER BY mr.created_at DESC
            LIMIT 25
            """,
            (owner_id,),
        )
        activity = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT t.status, t.turn_type, t.deadline_at, t.vacancy_started_at,
                   u.unit_number, p.name AS property_name
            FROM traxkey.turns t
            JOIN traxkey.units u ON u.id = t.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE p.owner_id = %s AND t.status NOT IN ('ready', 'relisted', 'occupied')
            ORDER BY t.vacancy_started_at
            """,
            (owner_id,),
        )
        turns = [dict(r) for r in cur.fetchall()]

    total_units = sum(p["units"] for p in properties)
    occupied = sum(p["occupied"] for p in properties)
    return {
        "ownerName": who["owner_name"] if who else None,
        "managerName": who["manager_name"] if who else None,
        "properties": properties,
        "spend": spend,
        "activity": activity,
        "turns": turns,
        "totals": {
            "properties": len(properties),
            "units": total_units,
            "occupied": occupied,
            "occupancyPct": round(occupied / total_units * 100) if total_units else 0,
            "spend12mo": float(sum(s["spend"] for s in spend)),
        },
    }


def set_password(company_id, owner_id, password):
    """Manager-side: enable an owner's access. Scoped to the manager's own
    company so one manager cannot enable an owner belonging to another."""
    if not password or len(password) < 8:
        return {"ok": False, "error": "Use at least 8 characters."}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.owners
            SET password_hash = crypt(%s, gen_salt('bf')), portal_access_enabled = true, portal_enabled = true
            WHERE id = %s::uuid AND company_id = %s
              AND email IS NOT NULL
            RETURNING id, email
            """,
            (password, owner_id, company_id),
        )
        row = cur.fetchone()
    if not row:
        return {"ok": False, "error": "Owner not found, or they have no email on file."}
    return {"ok": True, "email": row["email"]}


# --------------------------------------------------------------- manager side

def list_owners(company_id):
    """Owners this manager has, with the properties assigned to each."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT o.id, o.name, o.email, o.phone, o.portal_enabled,
                   (o.password_hash IS NOT NULL) AS has_password,
                   COALESCE(json_agg(json_build_object('id', p.id, 'name', p.name)
                            ORDER BY p.name) FILTER (WHERE p.id IS NOT NULL), '[]') AS properties
            FROM traxkey.owners o
            LEFT JOIN traxkey.properties p ON p.owner_id = o.id
            WHERE o.company_id = %s
            GROUP BY o.id
            ORDER BY o.name
            """,
            (company_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def create_owner(company_id, body):
    name = (body.get("name") or "").strip()
    if not name:
        return {"ok": False, "error": "Give the owner a name."}
    with db() as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """
                INSERT INTO traxkey.owners (company_id, name, email, phone)
                VALUES (%s, %s, NULLIF(%s, ''), NULLIF(%s, ''))
                RETURNING id
                """,
                (company_id, name, (body.get("email") or "").strip().lower(),
                 (body.get("phone") or "").strip()),
            )
            row = cur.fetchone()
        except Exception as exc:
            # The partial unique index on lower(email) is the guard here. An
            # owner's email is their login, so a duplicate is a real conflict
            # rather than something to silently accept.
            if "owners_email_unique" in str(exc):
                return {"ok": False, "error": "That email is already used by another owner."}
            raise
    return {"ok": True, "id": str(row["id"])}


def assign_property(company_id, property_id, owner_id):
    """Attach a property to an owner, or detach it when owner_id is blank.
    Both sides are checked against the caller's company."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.properties p
            SET owner_id = CASE
                  WHEN %(o)s = '' THEN NULL
                  ELSE (SELECT o.id FROM traxkey.owners o
                         WHERE o.id = %(o)s::uuid AND o.company_id = %(c)s)
                END
            WHERE p.id = %(p)s::uuid AND p.company_id = %(c)s
            RETURNING p.id, p.owner_id
            """,
            {"c": company_id, "p": property_id, "o": (owner_id or "").strip()},
        )
        row = cur.fetchone()
    if not row:
        return {"ok": False, "error": "Property not found."}
    if (owner_id or "").strip() and not row["owner_id"]:
        return {"ok": False, "error": "That owner was not found."}
    return {"ok": True}


# ------------------------------------------------------------ password reset

RESET_TOKEN_HOURS = 1


def request_reset(email):
    """Always returns ok, whether or not the email matches an owner. That is
    deliberate: a different response for 'not found' vs 'found' would let
    someone enumerate which emails have portal access."""
    email = (email or "").strip().lower()
    if not email:
        return {"ok": True}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, name FROM traxkey.owners WHERE lower(email) = %s AND portal_enabled",
            (email,),
        )
        row = cur.fetchone()
        if not row:
            return {"ok": True}

        token = secrets.token_hex(24)
        cur.execute(
            """
            UPDATE traxkey.owners
            SET reset_token = %s, reset_token_expires_at = %s
            WHERE id = %s
            """,
            (token, datetime.now(timezone.utc) + timedelta(hours=RESET_TOKEN_HOURS), row["id"]),
        )
    return {"ok": True, "token": token, "name": row["name"], "email": email}


def reset_password(token, new_password):
    if not new_password or len(new_password) < 8:
        return {"ok": False, "error": "Use at least 8 characters."}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.owners
            SET password_hash = crypt(%s, gen_salt('bf')),
                reset_token = NULL, reset_token_expires_at = NULL
            WHERE reset_token = %s AND reset_token_expires_at > now()
            RETURNING id
            """,
            (new_password, token),
        )
        row = cur.fetchone()
    if not row:
        return {"ok": False, "error": "That reset link is invalid or has expired."}
    return {"ok": True}


def send_reset_email(name, email, token):
    import os
    import requests

    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        return
    from_addr = os.environ.get("NOTIFY_FROM_ADDRESS", "dispatch@notify.traxkey.ai")
    first = (name or "").split(" ")[0] or "there"
    html = f"""<div style="font-family: Arial, sans-serif; font-size:14px; color:#1e293b;">
<p>Hi {esc(first)},</p>
<p>Click below to reset your TraxKey owner portal password. This link expires in 1 hour.</p>
<p><a href="https://owners.traxkey.ai/?reset={token}">Reset password</a></p>
<p style="font-size:11px;color:#94a3b8;margin-top:24px;">Didn't request this? You can ignore this email.</p>
</div>"""
    requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"from": f"TraxKey AI <{from_addr}>", "to": email,
              "subject": "Reset your TraxKey owner portal password", "html": html},
        timeout=10,
    )
