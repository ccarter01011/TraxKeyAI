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
from http.server import HTTPServer, BaseHTTPRequestHandler

from graph import run_batch
from ical_sync import sync_all_calendars
from checkout_turns import run_checkout_turns
from readiness import run_readiness_checks
from concierge import get_briefing

POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "900"))  # 15 min default
# Booking calendars change far less often than maintenance requests arrive,
# and these are third-party feeds, no reason to hammer them every pass.
CALENDAR_SYNC_INTERVAL_SECONDS = int(os.environ.get("CALENDAR_SYNC_INTERVAL_SECONDS", "3600"))  # 1 hr default


import json


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

    def do_GET(self):
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
            try:
                run_readiness_checks()
            except Exception:
                traceback.print_exc()
            # Set even on failure, so a persistently broken feed can't turn
            # this into a retry-every-pass loop against a third party.
            last_calendar_sync = now

        time.sleep(POLL_INTERVAL_SECONDS)
