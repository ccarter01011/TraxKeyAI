"""iCal calendar sync for short-term rental units.

Airbnb, Vrbo, and most STR platforms publish a per-listing iCal feed. It's
a public standard, no API key, no partner agreement, no gatekeeper, which
is exactly why it's the right first STR integration for a small team.

What this buys us: real occupancy data. "A guest is in the unit right now
and checks out Thursday" is a materially different maintenance problem
than the same issue in a unit sitting vacant for two weeks. That
distinction is what the AI Maintenance Coordinator uses to set urgency,
and per competitive research, nobody in this space does it well.
"""

import traceback
from datetime import date, datetime

import requests
from icalendar import Calendar

from db import db

FETCH_TIMEOUT_SECONDS = 20
# Airbnb/Vrbo feeds are small (a few KB). A feed far larger than this is
# either not a booking calendar or something we shouldn't be parsing.
MAX_FEED_BYTES = 2_000_000


def _as_date(value):
    """iCal DTSTART/DTEND come back as either date or datetime depending on
    whether the event is all-day. STR bookings are all-day in practice, but
    handle both rather than crashing on an unexpected feed."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


# An owner-side calendar block makes the unit unavailable but means nobody
# is physically there. A real reservation means someone is. Only the latter
# should raise maintenance urgency. This is a text heuristic over the iCal
# SUMMARY, there's no structured field for it in the spec, so treat it as a
# best guess: an unrecognised summary is assumed to be a real booking, which
# is the safer default (over-urgent beats ignoring a guest in the unit).
BLOCK_MARKERS = ("not available", "unavailable", "blocked", "block")


def _is_block(summary):
    if not summary:
        return False
    lowered = summary.lower()
    return any(marker in lowered for marker in BLOCK_MARKERS)


def _parse_feed(raw_bytes):
    """Returns a list of booking dicts. Skips anything malformed rather than
    failing the whole feed, one bad VEVENT shouldn't lose the other 20."""
    cal = Calendar.from_ical(raw_bytes)
    bookings = []

    for component in cal.walk("VEVENT"):
        try:
            uid = str(component.get("UID") or "").strip()
            checkin = _as_date(component.get("DTSTART").dt) if component.get("DTSTART") else None
            checkout = _as_date(component.get("DTEND").dt) if component.get("DTEND") else None
            summary = str(component.get("SUMMARY") or "").strip() or None

            if not uid or not checkin or not checkout:
                continue
            if checkout < checkin:
                continue

            bookings.append(
                {
                    "uid": uid,
                    "checkin": checkin,
                    "checkout": checkout,
                    "summary": summary,
                    "is_blocked": _is_block(summary),
                }
            )
        except Exception:
            continue

    return bookings


def sync_one_calendar(calendar_id, unit_id, ical_url):
    """Fetch and store one calendar's bookings. Raises on fetch/parse
    failure so the caller can record the error against the calendar row."""
    response = requests.get(ical_url, timeout=FETCH_TIMEOUT_SECONDS)
    response.raise_for_status()

    if len(response.content) > MAX_FEED_BYTES:
        raise ValueError(f"Feed is unexpectedly large ({len(response.content)} bytes)")

    bookings = _parse_feed(response.content)

    with db() as conn, conn.cursor() as cur:
        for b in bookings:
            cur.execute(
                """
                INSERT INTO traxkey.bookings
                  (unit_id, calendar_id, external_uid, checkin_date, checkout_date, guest_label, is_blocked)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (calendar_id, external_uid) DO UPDATE SET
                  checkin_date = EXCLUDED.checkin_date,
                  checkout_date = EXCLUDED.checkout_date,
                  guest_label = EXCLUDED.guest_label,
                  is_blocked = EXCLUDED.is_blocked,
                  updated_at = now()
                """,
                (unit_id, calendar_id, b["uid"], b["checkin"], b["checkout"], b["summary"], b["is_blocked"]),
            )

        # A cancelled booking simply disappears from the feed, so anything
        # current/future we still hold but the feed no longer lists is a
        # cancellation. Scoped to checkout_date >= today deliberately:
        # these feeds typically only carry current and future bookings, so
        # an unscoped delete would wipe legitimate history every sync.
        current_uids = [b["uid"] for b in bookings]
        cur.execute(
            """
            DELETE FROM traxkey.bookings
            WHERE calendar_id = %s
              AND checkout_date >= CURRENT_DATE
              AND NOT (external_uid = ANY(%s))
            """,
            (calendar_id, current_uids),
        )

        cur.execute(
            "UPDATE traxkey.unit_calendars SET last_synced_at = now(), last_sync_error = NULL WHERE id = %s",
            (calendar_id,),
        )

    return len(bookings)


def sync_all_calendars():
    """One pass over every registered calendar. A failure on one feed is
    recorded against that calendar and never stops the others."""
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, unit_id, ical_url FROM traxkey.unit_calendars")
        calendars = cur.fetchall()

    for cal in calendars:
        try:
            count = sync_one_calendar(str(cal["id"]), str(cal["unit_id"]), cal["ical_url"])
            print(f"iCal sync: {count} bookings for calendar {cal['id']}")
        except Exception as exc:
            traceback.print_exc()
            with db() as conn, conn.cursor() as cur:
                cur.execute(
                    "UPDATE traxkey.unit_calendars SET last_synced_at = now(), last_sync_error = %s WHERE id = %s",
                    (str(exc)[:500], str(cal["id"])),
                )


def get_occupancy(unit_id):
    """Occupancy facts for a unit, plain SQL, no AI judgment. Feeds the
    Maintenance Coordinator's urgency call."""
    with db() as conn, conn.cursor() as cur:
        # is_blocked excluded on purpose: an owner-blocked unit is
        # unavailable but empty, so it shouldn't raise urgency the way a
        # unit with a guest in it does.
        cur.execute(
            """
            SELECT checkin_date, checkout_date, guest_label
            FROM traxkey.bookings
            WHERE unit_id = %s AND NOT is_blocked
              AND checkin_date <= CURRENT_DATE AND checkout_date > CURRENT_DATE
            ORDER BY checkin_date
            LIMIT 1
            """,
            (unit_id,),
        )
        current = cur.fetchone()

        cur.execute(
            """
            SELECT checkin_date
            FROM traxkey.bookings
            WHERE unit_id = %s AND NOT is_blocked AND checkin_date > CURRENT_DATE
            ORDER BY checkin_date
            LIMIT 1
            """,
            (unit_id,),
        )
        upcoming = cur.fetchone()

    return {
        "occupied_now": current is not None,
        "current_checkout": current["checkout_date"] if current else None,
        "next_checkin": upcoming["checkin_date"] if upcoming else None,
    }
