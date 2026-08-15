"""Minimal always-on worker: runs the maintenance coordinator's batch pass
on a loop, and answers health checks. Deliberately not using LangGraph
Platform's own server package, its exact self-hosted launch invocation
isn't documented clearly enough to guess correctly without repeated failed
deploys. The `graph` StateGraph from graph.py still does the real work,
this is just how it gets invoked on a schedule."""

import os
import time
import threading
import traceback
from datetime import datetime
from urllib.parse import parse_qs, urlparse
from http.server import HTTPServer, BaseHTTPRequestHandler

from graph import run_batch
from ical_sync import sync_all_calendars
from checkout_turns import run_checkout_turns
from cleaner_assignment import run_cleaner_assignment
from readiness import run_readiness_checks
from review_risk import run_review_risk_checks
from lease_agent import run_lease_agent
from lead_followup import run_lead_followup
from resident_notify import run_resident_notifications
from sample_data import seed as seed_sample, remove as remove_sample, has_sample
from calendar_view import get_calendar
from insights import get_insights, snapshot_vendor_performance
from vendor_chase import run_vendor_chase
from suggestions import submit as submit_suggestion, list_all as list_suggestions, set_status as set_suggestion_status
from ordered_items import (list_items, create as create_item, set_status as set_item_status,
                           set_email_prefs as set_item_email_prefs)
from invoices import (list_customers, list_invoices, ar_summary, create_customer,
                      set_customer_prefs, create_invoice, set_invoice_status,
                      set_invoice_prefs)
from invoice_chase import run_invoice_chase
from imports import (preview_invoices, commit_invoices, preview_items, commit_items,
                     export_invoices, export_items, TEMPLATES)
from analytics import occupancy_summary, rental_activity_summary, financial_summary, owner_statements
from property_profile import (get_profile, save_profile, list_inventory, add_inventory,
                              set_inventory_condition, delete_inventory, onboarding_status)
from damage_assessment import assess as assess_damage
from pricing_engine import (suggest_rates, apply_rate, set_base_rate, get_calendar as get_pricing_calendar,
                            create_reservation, cancel_reservation, create_buyout, list_buyouts,
                            set_pricelabs_listing, pricelabs_status, list_pricelabs_listings,
                            market_data_status)
from pricing_test_data import seed as seed_pricing_test, remove as remove_pricing_test
from amenities import (set_rental_mode, list_amenities, add_amenity, set_amenity_status,
                       delete_amenity, report_amenity_issue, notify_active_guests,
                       list_amenities_for_token, report_amenity_issue_public)
from str_ops import (list_supplies, upsert_supply, delete_supply,
                     list_damage, record_damage, set_claim_status)
from owner_portal import (login as owner_login, validate as owner_validate,
                          get_dashboard as owner_dashboard, set_password as owner_set_password,
                          list_owners, create_owner, assign_property,
                          request_reset as owner_request_reset, reset_password as owner_reset_password,
                          send_reset_email as owner_send_reset_email)
from concierge import validate_session
from concierge import get_briefing
from admin_concierge import get_admin_briefing, validate_admin
from sales_chat import answer as sales_answer
from tenant_chat import answer as tenant_answer

POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "900"))  # 15 min default
# Booking calendars change far less often than maintenance requests arrive,
# and these are third-party feeds, no reason to hammer them every pass.
CALENDAR_SYNC_INTERVAL_SECONDS = int(os.environ.get("CALENDAR_SYNC_INTERVAL_SECONDS", "3600"))  # 1 hr default


import json
from decimal import Decimal


def _plain(value):
    """JSON-safe copy of rows from psycopg: dates to ISO strings, uuids and
    Decimals to str/float. Money stays a float only for display; nothing here
    does arithmetic on it."""
    if isinstance(value, list):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, Decimal):
        return float(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "hex") and not isinstance(value, (bytes, str, int)):
        return str(value)
    return value


class HealthHandler(BaseHTTPRequestHandler):
    """Health check plus the one on-demand endpoint: the concierge briefing.
    Everything else in this service runs on the loop; the briefing has to be
    synchronous because the dashboard asks for it when the page opens."""

    def _cors(self):
        # The dashboard is a different origin (app.traxkey.ai), so the
        # browser preflights and requires these on the real response too.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        route = self.path.split("?")[0]
        if route not in ("/chat", "/tenant-chat", "/sample-data", "/ordered-items",
                         "/supplies", "/damage", "/owner-login", "/owner-access", "/owners",
                         "/owner-forgot-password", "/owner-reset-password", "/suggestions",
                         "/invoices", "/invoice-customers", "/import",
                         "/property-profile", "/inventory", "/damage-assessment",
                         "/pricing", "/reservations", "/pricing-test-data",
                         "/rental-mode", "/amenities", "/amenity-issue", "/amenity-notify",
                         "/buyouts", "/tenant-amenities", "/tenant-amenity-issue",
                         "/pricelabs"):
            self._json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length > 20000:
                self._json(413, {"error": "Too large"})
                return
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._json(400, {"error": "Bad request"})
            return

        # Behind Railway's proxy, the real client IP is in the forwarded header.
        ip = (self.headers.get("X-Forwarded-For") or self.client_address[0] or "unknown").split(",")[0].strip()

        if route == "/suggestions":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            # Admin can triage; a customer can only submit.
            admin_id = validate_admin(token)
            if admin_id and payload.get("action") == "status":
                result = set_suggestion_status(payload.get("suggestionId", ""), payload.get("status", ""), payload.get("note"))
                self._json(200 if result.get("ok") else 400, result)
                return
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                result = submit_suggestion(company_id, token, payload.get("subject", ""), payload.get("message", ""))
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not save that"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/owner-forgot-password":
            result = owner_request_reset(payload.get("email", ""))
            if result.get("token"):
                try:
                    owner_send_reset_email(result.get("name"), result.get("email"), result["token"])
                except Exception:
                    traceback.print_exc()
            self._json(200, {"ok": True})
            return

        if route == "/owner-reset-password":
            result = owner_reset_password(payload.get("token", ""), payload.get("password", ""))
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/owner-login":
            # Public: this IS the login. Deliberately returns the same
            # message for unknown email and wrong password, so it cannot be
            # used to discover which owners have portal access.
            result = owner_login(payload.get("email", ""), payload.get("password", ""))
            if not result:
                self._json(401, {"error": "Invalid email or password"})
                return
            self._json(200, result)
            return

        if route == "/owners":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                action = payload.get("action")
                if action == "assign":
                    result = assign_property(company_id, payload.get("propertyId", ""), payload.get("ownerId", ""))
                else:
                    result = create_owner(company_id, payload)
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not save that"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/owner-access":
            # Manager-side, scoped to their own company.
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            result = owner_set_password(company_id, payload.get("ownerId", ""), payload.get("password", ""))
            self._json(200 if result.get("ok") else 400, result)
            return

        if route in ("/supplies", "/damage"):
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                if route == "/supplies":
                    result = (delete_supply(company_id, payload.get("supplyId", ""))
                              if payload.get("action") == "delete"
                              else upsert_supply(company_id, payload))
                else:
                    result = (set_claim_status(company_id, payload.get("damageId", ""), payload.get("status", ""))
                              if payload.get("action") == "status"
                              else record_damage(company_id, payload))
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not save that"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/ordered-items":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                if payload.get("action") == "status":
                    result = set_item_status(company_id, payload.get("itemId", ""), payload.get("status", ""))
                elif payload.get("action") == "email-prefs":
                    result = set_item_email_prefs(company_id, payload.get("itemId", ""), payload)
                else:
                    result = create_item(company_id, payload)
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not update that item"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/invoice-customers":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                if payload.get("action") == "email-prefs":
                    result = set_customer_prefs(company_id, payload.get("customerId", ""), payload)
                else:
                    result = create_customer(company_id, payload)
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not update that customer"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route in ("/property-profile", "/inventory", "/damage-assessment"):
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                if route == "/property-profile":
                    result = save_profile(company_id, payload.get("propertyId", ""), payload)
                elif route == "/damage-assessment":
                    result = assess_damage(company_id, payload.get("requestId", ""))
                else:
                    action = payload.get("action")
                    if action == "condition":
                        result = set_inventory_condition(company_id, payload.get("itemId", ""), payload.get("condition", ""))
                    elif action == "delete":
                        result = delete_inventory(company_id, payload.get("itemId", ""))
                    else:
                        result = add_inventory(company_id, payload)
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not save that"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/rental-mode":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            result = set_rental_mode(company_id, payload.get("propertyId", ""), payload.get("mode", ""))
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/amenities":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                action = payload.get("action")
                if action == "status":
                    result = set_amenity_status(company_id, payload.get("amenityId", ""), payload.get("status", ""), payload.get("note"))
                elif action == "delete":
                    result = delete_amenity(company_id, payload.get("amenityId", ""))
                else:
                    result = add_amenity(company_id, payload)
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not save that"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/amenity-issue":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                result = report_amenity_issue(company_id, payload)
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not save that"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/amenity-notify":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                result = notify_active_guests(company_id, payload.get("amenityId", ""), payload.get("message", ""))
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not notify guests"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/buyouts":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                result = create_buyout(company_id, payload)
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not save that"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/pricing-test-data":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                result = (remove_pricing_test(company_id) if payload.get("action") == "remove"
                          else seed_pricing_test(company_id))
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not do that"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/pricelabs":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                result = set_pricelabs_listing(company_id, payload.get("unitId", ""), payload.get("listingId", ""))
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not save that"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/pricing":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                action = payload.get("action")
                if action == "apply":
                    result = apply_rate(company_id, payload.get("unitId", ""), payload.get("stayDate", ""), payload.get("rate"))
                elif action == "set-base-rate":
                    result = set_base_rate(company_id, payload.get("unitId", ""), payload.get("rate"))
                else:
                    start = datetime.strptime(payload.get("startDate", ""), "%Y-%m-%d").date()
                    end = datetime.strptime(payload.get("endDate", ""), "%Y-%m-%d").date()
                    result = suggest_rates(company_id, payload.get("unitId", ""), start, end)
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not compute pricing"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/reservations":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                if payload.get("action") == "cancel":
                    result = cancel_reservation(company_id, payload.get("reservationId", ""))
                else:
                    result = create_reservation(company_id, payload)
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not save that"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/import":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            kind = payload.get("kind")
            if kind not in ("invoices", "orders"):
                self._json(400, {"error": "Unknown import kind"})
                return
            try:
                csv_text = payload.get("csv") or ""
                auto = bool(payload.get("autoEmailEnabled", False))
                if payload.get("action") == "commit":
                    result = (commit_invoices(company_id, csv_text, auto) if kind == "invoices"
                              else commit_items(company_id, csv_text, auto))
                else:
                    result = (preview_invoices(company_id, csv_text) if kind == "invoices"
                              else preview_items(company_id, csv_text))
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not read that file"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/invoices":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                action = payload.get("action")
                if action == "status":
                    result = set_invoice_status(company_id, payload.get("invoiceId", ""), payload.get("status", ""))
                elif action == "email-prefs":
                    result = set_invoice_prefs(company_id, payload.get("invoiceId", ""), payload)
                else:
                    result = create_invoice(company_id, payload)
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not update that invoice"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/sample-data":
            # Session-scoped: sample data can only ever be created or removed
            # inside the caller's own company.
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                result = remove_sample(company_id) if payload.get("action") == "remove" else seed_sample(company_id)
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not update sample data"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/tenant-amenities":
            try:
                result = _plain(list_amenities_for_token(payload.get("token", "")))
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not load amenities"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/tenant-amenity-issue":
            try:
                result = report_amenity_issue_public(payload.get("token", ""), payload)
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not submit that"})
                return
            self._json(200 if result.get("ok") else 400, result)
            return

        if route == "/tenant-chat":
            # Separate persona from the sales bot: warm, resident-facing, and
            # far more constrained about what it may promise. See tenant_chat.py.
            reply, err = tenant_answer(
                payload.get("question", ""), payload.get("companyName"), ip,
                unit_id=payload.get("unitId"),
            )
        else:
            reply, err = sales_answer(payload.get("question", ""), payload.get("history"), ip)

        if err:
            self._json(400, {"error": err})
            return
        self._json(200, {"reply": reply})

    def do_GET(self):
        if self.path.split("?")[0] == "/admin-concierge":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            try:
                result = get_admin_briefing(token)
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not build briefing"})
                return
            if result is None:
                self._json(401, {"error": "Unauthorized"})
                return
            self._json(200, result)
            return

        if self.path.split("?")[0] == "/suggestions":
            # Admin only: this is every customer's ideas across all accounts.
            if not validate_admin(self.headers.get("Authorization", "").replace("Bearer ", "").strip()):
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                rows = list_suggestions()
                for r in rows:
                    r["id"] = str(r["id"])
                    if r.get("created_at"):
                        r["created_at"] = r["created_at"].isoformat()
                self._json(200, {"suggestions": rows})
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not load suggestions"})
            return

        if self.path.split("?")[0] == "/owners":
            company_id = validate_session(self.headers.get("Authorization", "").replace("Bearer ", "").strip())
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                rows = list_owners(company_id)
                for r in rows:
                    r["id"] = str(r["id"])
                self._json(200, {"owners": rows})
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not load owners"})
            return

        if self.path.split("?")[0] == "/owner-dashboard":
            # Owner sessions are a separate principal from operator sessions
            # and never interchangeable.
            owner_id = owner_validate(self.headers.get("Authorization", "").replace("Bearer ", "").strip())
            if not owner_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                data = owner_dashboard(owner_id)
                def clean(o):
                    if isinstance(o, list):
                        return [clean(x) for x in o]
                    if isinstance(o, dict):
                        out = {}
                        for k, v in o.items():
                            if hasattr(v, "isoformat"):
                                out[k] = v.isoformat()
                            elif hasattr(v, "quantize"):
                                out[k] = float(v)
                            elif isinstance(v, (list, dict)):
                                out[k] = clean(v)
                            else:
                                out[k] = str(v) if k in ("id",) else v
                        return out
                    return o
                self._json(200, clean(data))
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not load your dashboard"})
            return

        if self.path.split("?")[0] in ("/supplies", "/damage"):
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                rows = (list_supplies(company_id) if self.path.split("?")[0] == "/supplies"
                        else list_damage(company_id))
                for r in rows:
                    for k, v in list(r.items()):
                        if hasattr(v, "isoformat"):
                            r[k] = v.isoformat()
                    r["id"] = str(r["id"])
                    if r.get("unit_id"):
                        r["unit_id"] = str(r["unit_id"])
                    if r.get("estimated_cost") is not None:
                        r["estimated_cost"] = float(r["estimated_cost"])
                self._json(200, {"rows": rows})
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not load"})
            return

        if self.path.split("?")[0] == "/ordered-items":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                items = list_items(company_id)
                for i in items:
                    for k, v in list(i.items()):
                        if hasattr(v, "isoformat"):
                            i[k] = v.isoformat()
                        elif hasattr(v, "hex") and k == "id":
                            i[k] = str(v)
                    i["id"] = str(i["id"])
                    if i.get("cost") is not None:
                        i["cost"] = float(i["cost"])
                self._json(200, {"items": items})
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not load ordered items"})
            return

        if self.path.split("?")[0] == "/export":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            q = parse_qs(urlparse(self.path).query)
            kind = (q.get("kind") or [""])[0]
            today = datetime.now().strftime("%Y-%m-%d")
            try:
                if (q.get("template") or [""])[0] == "1":
                    if kind not in TEMPLATES:
                        self._json(400, {"error": "Unknown template"})
                        return
                    self._json(200, {"csv": TEMPLATES[kind], "filename": f"traxkey-{kind}-template.csv"})
                    return
                if kind == "invoices":
                    self._json(200, {"csv": export_invoices(company_id),
                                     "filename": f"traxkey-invoices-{today}.csv"})
                elif kind == "orders":
                    self._json(200, {"csv": export_items(company_id),
                                     "filename": f"traxkey-orders-{today}.csv"})
                else:
                    self._json(400, {"error": "Unknown export kind"})
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not build that export"})
            return

        if self.path.split("?")[0] in ("/property-profile", "/inventory", "/onboarding"):
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            r = self.path.split("?")[0]
            q = parse_qs(urlparse(self.path).query)
            pid = (q.get("propertyId") or [""])[0]
            try:
                if r == "/property-profile":
                    prof = get_profile(company_id, pid)
                    if prof is None:
                        self._json(404, {"error": "Property not found"})
                        return
                    self._json(200, _plain(prof))
                elif r == "/inventory":
                    self._json(200, {"items": _plain(list_inventory(company_id, pid))})
                else:
                    self._json(200, _plain(onboarding_status(company_id)))
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not load that"})
            return

        if self.path.split("?")[0] == "/amenities":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            q = parse_qs(urlparse(self.path).query)
            pid = (q.get("propertyId") or [""])[0]
            try:
                self._json(200, {"amenities": _plain(list_amenities(company_id, pid))})
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not load amenities"})
            return

        if self.path.split("?")[0] == "/buyouts":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            q = parse_qs(urlparse(self.path).query)
            pid = (q.get("propertyId") or [""])[0]
            try:
                self._json(200, {"buyouts": _plain(list_buyouts(company_id, pid))})
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not load buyouts"})
            return

        if self.path.split("?")[0] == "/pricelabs":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            q = parse_qs(urlparse(self.path).query)
            try:
                if (q.get("listings") or [""])[0] == "1":
                    self._json(200, list_pricelabs_listings())
                else:
                    self._json(200, pricelabs_status())
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not reach PriceLabs"})
            return

        if self.path.split("?")[0] == "/market-data":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            self._json(200, market_data_status())
            return

        if self.path.split("?")[0] == "/pricing":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            q = parse_qs(urlparse(self.path).query)
            unit_id = (q.get("unitId") or [""])[0]
            try:
                start = datetime.strptime((q.get("startDate") or [""])[0], "%Y-%m-%d").date()
                end = datetime.strptime((q.get("endDate") or [""])[0], "%Y-%m-%d").date()
            except ValueError:
                self._json(400, {"error": "startDate and endDate are required, YYYY-MM-DD"})
                return
            try:
                self._json(200, _plain(get_pricing_calendar(company_id, unit_id, start, end)))
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not load pricing"})
            return

        if self.path.split("?")[0] == "/analytics":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            q = parse_qs(urlparse(self.path).query)
            try:
                days = int((q.get("days") or ["90"])[0])
            except ValueError:
                days = 90
            try:
                self._json(200, _plain({
                    "occupancy": occupancy_summary(company_id),
                    "rentalActivity": rental_activity_summary(company_id, days),
                    "financial": financial_summary(company_id, days),
                    "ownerStatements": owner_statements(company_id, min(days, 90)),
                }))
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not load analytics"})
            return

        if self.path.split("?")[0] == "/invoices":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                self._json(200, {
                    "invoices": _plain(list_invoices(company_id)),
                    "customers": _plain(list_customers(company_id)),
                    "summary": _plain(ar_summary(company_id)),
                })
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not load invoices"})
            return

        if self.path.split("?")[0] == "/insights":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                self._json(200, get_insights(company_id))
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not load insights"})
            return

        if self.path.split("?")[0] == "/calendar":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            company_id = validate_session(token)
            if not company_id:
                self._json(401, {"error": "Unauthorized"})
                return
            try:
                self._json(200, get_calendar(company_id))
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not load the calendar"})
            return

        if self.path.split("?")[0] == "/concierge":
            token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            try:
                result = get_briefing(token)
            except Exception:
                traceback.print_exc()
                self._json(500, {"error": "Could not build briefing"})
                return
            if result is None:
                self._json(401, {"error": "Unauthorized"})
                return
            self._json(200, result)
            return

        self._json(200, {"status": "ok"})

    def log_message(self, format, *args):
        pass  # quiet, don't spam Railway logs with health-check hits


def run_health_server():
    port = int(os.environ.get("PORT", "8000"))
    HTTPServer(("0.0.0.0", port), HealthHandler).serve_forever()


if __name__ == "__main__":
    threading.Thread(target=run_health_server, daemon=True).start()
    print(f"AI Maintenance Coordinator worker started, polling every {POLL_INTERVAL_SECONDS}s")
    print(f"iCal calendar sync every {CALENDAR_SYNC_INTERVAL_SECONDS}s")

    last_calendar_sync = 0.0
    while True:
        try:
            run_batch()
        except Exception:
            # Never let one bad request kill the whole loop, log and keep going.
            traceback.print_exc()

        # On the fast loop deliberately: an emergency vendor going quiet for
        # two hours needs catching within the hour, not at the next hourly
        # sweep. The query is indexed and skips anything not yet due.
        try:
            run_vendor_chase()
        except Exception:
            traceback.print_exc()

        # On the fast loop, not the hourly one: a resident waiting to hear
        # that someone is coming should not wait an extra hour for it.
        try:
            run_resident_notifications()
        except Exception:
            traceback.print_exc()

        now = time.monotonic()
        if now - last_calendar_sync >= CALENDAR_SYNC_INTERVAL_SECONDS:
            try:
                sync_all_calendars()
            except Exception:
                traceback.print_exc()
            # Runs right after a sync so it acts on fresh checkout data.
            try:
                run_checkout_turns()
            except Exception:
                traceback.print_exc()
            # Right after checkout_turns, so a turn it just opened gets a
            # cleaning job the same pass rather than waiting an hour.
            try:
                run_cleaner_assignment()
            except Exception:
                traceback.print_exc()
            try:
                run_readiness_checks()
            except Exception:
                traceback.print_exc()
            try:
                run_review_risk_checks()
            except Exception:
                traceback.print_exc()
            try:
                run_lease_agent()
            except Exception:
                traceback.print_exc()
            # Hourly, not the fast loop: invoice and supplier chasing is
            # measured in days, so checking every 15 minutes would only mean
            # the same rows failing the same due check 4x as often.
            try:
                run_invoice_chase()
            except Exception:
                traceback.print_exc()
            try:
                run_lead_followup()
            except Exception:
                traceback.print_exc()
            # Append-only daily snapshot. Idempotent per day, so running it
            # hourly is harmless and it survives a worker restart.
            try:
                snapshot_vendor_performance()
            except Exception:
                traceback.print_exc()
            # Set even on failure, so a persistently broken feed can't turn
            # this into a retry-every-pass loop against a third party.
            last_calendar_sync = now

        time.sleep(POLL_INTERVAL_SECONDS)
