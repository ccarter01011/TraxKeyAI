"""Shared amenities for experiential STR / micro-resort properties.

A pool, a dock, a firepit, a clubhouse: things that belong to the property,
not to any one unit. The gap this closes: a broken pool heater today has
nowhere to live except a maintenance ticket pinned to one cabin, when it
actually affects every guest on the property.

rental_mode lives on properties (see schema_v32.sql) so an operator running
both standalone units and one resort-style compound doesn't get amenity
concepts forced onto properties where they don't apply.
"""

import os
import traceback

import requests

from db import db

CATEGORIES = ("pool", "water", "fire", "sport", "gathering", "other")

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
NOTIFY_FROM_ADDRESS = os.environ.get("NOTIFY_FROM_ADDRESS", "dispatch@notify.traxkey.ai")


def _send(to, subject, html):
    if not RESEND_API_KEY or not to:
        return False
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json={"from": f"TraxKey AI <{NOTIFY_FROM_ADDRESS}>", "to": [to], "subject": subject, "html": html},
            timeout=10,
        )
        r.raise_for_status()
        return True
    except Exception:
        traceback.print_exc()
        return False


def set_rental_mode(company_id, property_id, mode):
    if mode not in ("standard", "experiential"):
        return {"ok": False, "error": "Unknown mode."}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE traxkey.properties SET rental_mode = %s WHERE id = %s::uuid AND company_id = %s RETURNING id",
            (mode, property_id, company_id),
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "Property not found."}


def list_amenities(company_id, property_id):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.*,
                   (SELECT count(*) FROM traxkey.maintenance_requests mr
                     WHERE mr.amenity_id = a.id AND mr.status NOT IN ('completed', 'closed')) AS open_issues
            FROM traxkey.amenities a
            WHERE a.company_id = %s AND a.property_id = %s::uuid
            ORDER BY a.name
            """,
            (company_id, property_id),
        )
        return [dict(r) for r in cur.fetchall()]


def add_amenity(company_id, body):
    name = (body.get("name") or "").strip()
    prop = (body.get("propertyId") or "").strip()
    if not name:
        return {"ok": False, "error": "Name the amenity."}
    if not prop:
        return {"ok": False, "error": "Pick a property."}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.amenities (company_id, property_id, name, category, capacity, notes)
            SELECT p.company_id, p.id, %(name)s, COALESCE(NULLIF(%(cat)s, ''), 'other'),
                   NULLIF(%(cap)s, '')::int, NULLIF(%(notes)s, '')
            FROM traxkey.properties p
            WHERE p.id = %(prop)s::uuid AND p.company_id = %(c)s
            RETURNING id
            """,
            {"c": company_id, "prop": prop, "name": name,
             "cat": (body.get("category") or "").strip(),
             "cap": str(body.get("capacity") or "").strip(),
             "notes": (body.get("notes") or "").strip()},
        )
        row = cur.fetchone()
    return {"ok": True, "id": str(row["id"])} if row else {"ok": False, "error": "Property not found."}


def set_amenity_status(company_id, amenity_id, status, note=None):
    if status not in ("open", "closed", "maintenance"):
        return {"ok": False, "error": "Unknown status."}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.amenities
            SET status = %s, status_note = NULLIF(%s, ''), updated_at = now()
            WHERE id = %s::uuid AND company_id = %s
            RETURNING id, property_id, name
            """,
            (status, (note or "").strip(), amenity_id, company_id),
        )
        row = cur.fetchone()
    return {"ok": True, "propertyId": str(row["property_id"]), "name": row["name"]} if row else {"ok": False, "error": "Not found."}


def delete_amenity(company_id, amenity_id):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM traxkey.amenities WHERE id = %s::uuid AND company_id = %s RETURNING id",
            (amenity_id, company_id),
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "Not found."}


def resolve_resident_token(token):
    """Resident access_token -> everything the tenant page needs, or None
    if the token doesn't match anything active. Same trust boundary as the
    n8n resident-intake flow: the token itself is the credential, nobody
    logs in."""
    token = (token or "").strip()
    if not token:
        return None
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.id AS resident_id, r.name AS resident_name, u.id AS unit_id,
                   p.id AS property_id, p.rental_mode, p.company_id, c.name AS company_name
            FROM traxkey.residents r
            JOIN traxkey.units u ON u.id = r.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            JOIN traxkey.companies c ON c.id = p.company_id
            WHERE r.access_token = %s AND r.is_active
            """,
            (token,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def list_amenities_for_token(token):
    """Public: what a resident/guest is allowed to see about their
    property's shared amenities. Only what helps them decide whether to
    report something and what's already known about it, nothing operator-only
    like open-issue counts or internal notes."""
    who = resolve_resident_token(token)
    if not who:
        return {"ok": False, "error": "Link not recognized."}
    if who["rental_mode"] != "experiential":
        return {"ok": True, "amenities": []}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, category, status, status_note
            FROM traxkey.amenities
            WHERE property_id = %s
            ORDER BY name
            """,
            (who["property_id"],),
        )
        amenities = [dict(r) for r in cur.fetchall()]
    return {"ok": True, "amenities": amenities}


def report_amenity_issue_public(token, body):
    """Public submission path: a guest reporting a shared-amenity issue from
    the tenant page, identified only by their resident token. Captures
    resident_id the same way a normal unit report does, so the ticket shows
    who reported it without asking them to re-enter their name."""
    who = resolve_resident_token(token)
    if not who:
        return {"ok": False, "error": "Link not recognized."}
    amenity_id = (body.get("amenityId") or "").strip()
    description = (body.get("description") or "").strip()
    urgency = (body.get("urgency") or "").strip()
    if not amenity_id or not description:
        return {"ok": False, "error": "Describe the issue and pick an amenity."}
    if urgency not in ("routine", "urgent", "emergency"):
        urgency = None

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.maintenance_requests
              (company_id, amenity_id, resident_id, description, urgency, status)
            SELECT a.company_id, a.id, %(rid)s, %(desc)s, %(urg)s, 'submitted'
            FROM traxkey.amenities a
            WHERE a.id = %(aid)s::uuid AND a.property_id = %(pid)s
            RETURNING id
            """,
            {"rid": who["resident_id"], "desc": description, "urg": urgency,
             "aid": amenity_id, "pid": who["property_id"]},
        )
        row = cur.fetchone()
    return {"ok": True, "id": str(row["id"])} if row else {"ok": False, "error": "That amenity wasn't found on your property."}


def report_amenity_issue(company_id, body):
    """Same shape as a unit maintenance request, pinned to an amenity
    instead. AI classification runs the same way it does for a unit issue,
    that pipeline doesn't care what the request is attached to."""
    amenity_id = (body.get("amenityId") or "").strip()
    description = (body.get("description") or "").strip()
    if not amenity_id or not description:
        return {"ok": False, "error": "Describe the issue and pick an amenity."}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.maintenance_requests (company_id, amenity_id, description, status)
            SELECT a.company_id, a.id, %(desc)s, 'submitted'
            FROM traxkey.amenities a
            WHERE a.id = %(aid)s::uuid AND a.company_id = %(c)s
            RETURNING id
            """,
            {"c": company_id, "aid": amenity_id, "desc": description},
        )
        row = cur.fetchone()
    return {"ok": True, "id": str(row["id"])} if row else {"ok": False, "error": "Amenity not found."}


def find_active_guests(company_id, property_id, on_date=None):
    """Everyone with a reservation covering today, across every unit on the
    property. Only direct_reservations carries a guest email; an iCal-synced
    Airbnb/Vrbo booking never does (the feed exposes dates, not contact
    info), so those guests are counted but flagged as unreachable rather
    than silently dropped."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT dr.guest_name, dr.guest_email, u.unit_number, true AS reachable
            FROM traxkey.direct_reservations dr
            JOIN traxkey.units u ON u.id = dr.unit_id
            WHERE u.property_id = %(p)s::uuid AND dr.status = 'confirmed'
              AND dr.checkin_date <= COALESCE(%(d)s, CURRENT_DATE)
              AND dr.checkout_date > COALESCE(%(d)s, CURRENT_DATE)
            UNION ALL
            SELECT b.guest_label, NULL, u.unit_number, false AS reachable
            FROM traxkey.bookings b
            JOIN traxkey.units u ON u.id = b.unit_id
            WHERE u.property_id = %(p)s::uuid
              AND b.checkin_date <= COALESCE(%(d)s, CURRENT_DATE)
              AND b.checkout_date > COALESCE(%(d)s, CURRENT_DATE)
            """,
            {"p": property_id, "d": on_date},
        )
        return [dict(r) for r in cur.fetchall()]


def notify_active_guests(company_id, amenity_id, message):
    """Email every reachable current guest on the property. Returns who was
    notified and who couldn't be reached, so the operator can call or
    message the unreachable ones through whatever channel they have.
    Deliberately does not silently skip them."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT property_id, name FROM traxkey.amenities WHERE id = %s::uuid AND company_id = %s",
            (amenity_id, company_id),
        )
        amenity = cur.fetchone()
    if not amenity:
        return {"ok": False, "error": "Amenity not found."}

    guests = find_active_guests(company_id, str(amenity["property_id"]))
    reachable = [g for g in guests if g["reachable"] and g["guest_email"]]
    unreachable = [g for g in guests if not (g["reachable"] and g["guest_email"])]

    sent = 0
    for g in reachable:
        ok = _send(
            g["guest_email"],
            f"Update about {amenity['name']}",
            f"<p>Hi {g['guest_name'] or 'there'},</p><p>{message}</p>",
        )
        if ok:
            sent += 1

    return {
        "ok": True,
        "amenityName": amenity["name"],
        "notified": sent,
        "totalActiveGuests": len(guests),
        "unreachable": [{"guestName": g["guest_name"], "unitNumber": g["unit_number"]} for g in unreachable],
    }
