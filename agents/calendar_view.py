"""Data for the unified calendar.

The screen an STR operator lives in all day, and the one thing every
competitor leads with that TraxKey did not have. Hostaway, Guesty,
Hospitable and Lodgify all put a multi-calendar front and centre.

The difference here, and the only reason this is worth building rather than
copying: those calendars show short-term bookings only, because that is all
those products know about. This one puts long-term units on the same grid.
An operator running both sees one timeline instead of alt-tabbing between
two products, which is the entire argument for TraxKey existing.

One query per concern, assembled in Python. A single joined query across
bookings, turns and leases would multiply rows against each other and need
DISTINCT gymnastics to undo.
"""

from datetime import date, timedelta

from db import db

DEFAULT_DAYS = 35


def get_calendar(company_id, days=DEFAULT_DAYS):
    start = date.today()
    end = start + timedelta(days=days)

    with db() as conn, conn.cursor() as cur:
        # Units, tagged by which side of the business they are on. A unit
        # with a synced calendar is short-term; one with an active lease is
        # long-term. A unit can legitimately be neither (vacant, not yet
        # listed), and is simply shown empty rather than hidden.
        cur.execute(
            """
            SELECT u.id, u.unit_number, u.status,
                   p.name AS property_name, p.id AS property_id,
                   (EXISTS (SELECT 1 FROM traxkey.unit_calendars uc WHERE uc.unit_id = u.id)
                    OR EXISTS (SELECT 1 FROM traxkey.direct_reservations dr WHERE dr.unit_id = u.id AND dr.status = 'confirmed')) AS is_str,
                   EXISTS (SELECT 1 FROM traxkey.leases l WHERE l.unit_id = u.id AND l.status = 'active') AS is_ltr
            FROM traxkey.units u
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE p.company_id = %s
            ORDER BY p.name, u.unit_number NULLS FIRST
            """,
            (company_id,),
        )
        units = [dict(r) for r in cur.fetchall()]
        by_unit = {str(u["id"]): u for u in units}
        for u in units:
            u["id"] = str(u["id"])
            u["property_id"] = str(u["property_id"])
            u["bookings"] = []
            u["turns"] = []
            u["lease"] = None

        # Bookings overlapping the window. Owner blocks are kept and flagged
        # rather than filtered out: an operator needs to see why a night is
        # unavailable, not just that it is.
        cur.execute(
            """
            SELECT b.unit_id, b.checkin_date, b.checkout_date, b.guest_label, b.is_blocked
            FROM traxkey.bookings b
            JOIN traxkey.units u ON u.id = b.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE p.company_id = %s
              AND b.checkout_date >= %s AND b.checkin_date <= %s
            ORDER BY b.checkin_date
            """,
            (company_id, start, end),
        )
        for r in cur.fetchall():
            u = by_unit.get(str(r["unit_id"]))
            if not u:
                continue
            u["bookings"].append({
                "checkin": r["checkin_date"].isoformat(),
                "checkout": r["checkout_date"].isoformat(),
                "label": r["guest_label"],
                "isBlocked": r["is_blocked"],
            })

        # Direct reservations (schema_v31), overlapping the window. Kept in
        # a separate table from the iCal `bookings` mirror above on purpose
        # (see that schema's own comment), but a guest booked through
        # TraxKey's own pricing page is exactly as real as one booked
        # through Airbnb, and belongs on the same "everything, one
        # timeline" grid — this was a genuine gap before this query existed.
        cur.execute(
            """
            SELECT dr.unit_id, dr.checkin_date, dr.checkout_date, dr.guest_name
            FROM traxkey.direct_reservations dr
            JOIN traxkey.units u ON u.id = dr.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE p.company_id = %s AND dr.status = 'confirmed'
              AND dr.checkout_date >= %s AND dr.checkin_date <= %s
            ORDER BY dr.checkin_date
            """,
            (company_id, start, end),
        )
        for r in cur.fetchall():
            u = by_unit.get(str(r["unit_id"]))
            if not u:
                continue
            u["bookings"].append({
                "checkin": r["checkin_date"].isoformat(),
                "checkout": r["checkout_date"].isoformat(),
                "label": r["guest_name"],
                "isBlocked": False,
            })

        # Open turns, so a cleaning deadline sits on the same row as the
        # booking that created it.
        cur.execute(
            """
            SELECT t.unit_id, t.status, t.turn_type, t.deadline_at
            FROM traxkey.turns t
            WHERE t.company_id = %s
              AND t.status NOT IN ('ready', 'relisted', 'occupied')
            """,
            (company_id,),
        )
        for r in cur.fetchall():
            u = by_unit.get(str(r["unit_id"]))
            if not u:
                continue
            u["turns"].append({
                "status": r["status"],
                "turnType": r["turn_type"],
                "deadline": r["deadline_at"].isoformat() if r["deadline_at"] else None,
            })

        # Active leases, so a long-term row shows its term and, critically,
        # its end date landing inside the window.
        cur.execute(
            """
            SELECT l.unit_id, l.start_date, l.end_date,
                   (SELECT r.name FROM traxkey.residents r
                     WHERE r.lease_id = l.id AND r.is_active
                     ORDER BY r.created_at LIMIT 1) AS resident_name
            FROM traxkey.leases l
            JOIN traxkey.units u ON u.id = l.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE p.company_id = %s AND l.status = 'active'
            """,
            (company_id,),
        )
        for r in cur.fetchall():
            u = by_unit.get(str(r["unit_id"]))
            if not u:
                continue
            u["lease"] = {
                "start": r["start_date"].isoformat(),
                "end": r["end_date"].isoformat() if r["end_date"] else None,
                "residentName": r["resident_name"],
            }

    return {
        "start": start.isoformat(),
        "days": days,
        "units": units,
    }
