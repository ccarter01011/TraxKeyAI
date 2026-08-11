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

POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "900"))  # 15 min default


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def log_message(self, format, *args):
        pass  # quiet, don't spam Railway logs with health-check hits


def run_health_server():
    port = int(os.environ.get("PORT", "8000"))
    HTTPServer(("0.0.0.0", port), HealthHandler).serve_forever()


if __name__ == "__main__":
    threading.Thread(target=run_health_server, daemon=True).start()
    print(f"AI Maintenance Coordinator worker started, polling every {POLL_INTERVAL_SECONDS}s")
    while True:
        try:
            run_batch()
        except Exception:
            # Never let one bad request kill the whole loop, log and keep going.
            traceback.print_exc()
        time.sleep(POLL_INTERVAL_SECONDS)
