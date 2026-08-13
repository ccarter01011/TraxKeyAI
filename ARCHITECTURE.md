# TraxKey AI — Architecture

What runs where, and what the agent service actually does. Kept current as
the system changes.

Last updated: 2026-08-13

---

## Services (all on one Railway project)

```
                        ┌──────────────────────────┐
   Public internet ────►│  traxkey.ai              │  static marketing site
                        │  /short-term-rentals     │  (npx serve)
                        └──────────────────────────┘

                        ┌──────────────────────────┐
   Property manager ───►│  app.traxkey.ai          │  React SPA (Vite)
                        │  /admin  (internal)      │
                        └────────────┬─────────────┘
                                     │
   Resident / guest ───►┌────────────▼─────────────┐
                        │  tenant.traxkey.ai       │  static, token links
                        └────────────┬─────────────┘
                                     │
   Vendor ─────────────►┌────────────▼─────────────┐
                        │  vendors.traxkey.ai      │  static, vendor login
                        └────────────┬─────────────┘
                                     │ HTTPS
                        ┌────────────▼─────────────┐
                        │  n8n                     │  all CRUD + auth
                        │  main + worker processes │  13 workflows
                        └────────────┬─────────────┘
                                     │
                        ┌────────────▼─────────────┐
                        │  Postgres                │  schema: traxkey
                        │  (shared by all services)│
                        └────────────▲─────────────┘
                                     │
                        ┌────────────┴─────────────┐
                        │  agents (Python worker)  │  the AI layer
                        │  worker.py loop          │  ← no UI, invisible
                        └──────────────────────────┘
                                     │
                        ┌────────────▼─────────────┐
                        │  Anthropic API · Resend  │  external
                        └──────────────────────────┘
```

**Key point:** n8n never calls the agent service, and the agent service never
calls n8n. They only share the database. That's deliberate, it means neither
can break the other, and editing a published n8n workflow (which has been a
recurring source of friction) can't disturb the AI layer.

---

## Langgraph, The agent service, in detail

This is the part with no UI, so here's exactly what's inside it.

**Why it looks like this:** the Railway LangGraph template expects a
`run.sh`, and LangGraph Platform's own self-hosted server invocation isn't
documented well enough to guess without repeated failed deploys. So instead
of running their server, `worker.py` runs the graph directly on a loop. Real
consequence: **there is no LangGraph Studio to look at.** The in-app AI
Activity page is the substitute, and it's arguably better since customers can
see it too.

### Files

| File | Role |
|---|---|
| `worker.py` | The loop. Health endpoint + scheduler. Entry point. |
| `graph.py` | The LangGraph `StateGraph` — the Maintenance Coordinator. |
| `ical_sync.py` | Fetches and parses Airbnb/Vrbo calendar feeds. |
| `checkout_turns.py` | Opens a cleaning turn when a guest checks out. |
| `readiness.py` | Flags units not ready before an arrival. |
| `db.py` | Shared Postgres connection. |

### The loop (`worker.py`)

```
every POLL_INTERVAL_SECONDS (default 15 min):
    run_batch()                    ← the LangGraph agent

every CALENDAR_SYNC_INTERVAL_SECONDS (default 1 hr):
    sync_all_calendars()           ← pull iCal feeds
    run_checkout_turns()           ← open cleaning turns
    run_readiness_checks()         ← flag unready units
```

Each is wrapped in its own try/except. One failing never stops the others.

### The LangGraph graph (`graph.py`)

This is the only actual LangGraph component. A `StateGraph` with five nodes:

```
        ┌──────────────┐
        │ load_context │  SQL: request, threshold, occupancy
        └──────┬───────┘
               ▼
        ┌──────────────┐
        │  diagnose    │  ◄── THE ONLY AI CALL IN THE SYSTEM
        └──────┬───────┘      Claude classifies category, urgency,
               ▼               owner-vs-tenant. Occupancy passed as context.
        ┌──────────────┐
        │ find_vendor  │  SQL: rank by completion rate → rating → cost
        └──────┬───────┘
               │
      ┌────────┴────────┐
      │ no vendor?      │──► END (status: needs_vendor)
      ▼
┌────────────────┐
│ check_approval │  SQL: cost vs threshold; unknown cost = needs approval
└───────┬────────┘
        │
  ┌─────┴──────┐
  │ needs      │──► END (status: awaiting_approval)
  │ approval?  │
  ▼
┌──────────┐
│ dispatch │  status → scheduled, email the vendor
└────┬─────┘
     ▼
    END
```

**State** (`RequestState`) carries: request_id, description, company_id,
unit_id, cost_approval_threshold, category, urgency, responsibility,
vendor_id, quoted_cost, known_cost, requires_approval, occupancy.

**`run_batch()`** does two passes each cycle:
1. Every request at `status = 'submitted'` → push through the graph.
2. Every request at `assigned` with `approved_at` set → `dispatch_approved()`,
   which skips diagnosis/vendor-matching (already done before the pause) and
   just finishes the dispatch.

That second pass is how a human approval resumes the flow.

### What is *not* AI

Worth stating plainly, because it's the design rule the whole system follows:

| Step | Mechanism |
|---|---|
| Diagnose free-text description | **Claude** |
| Everything else | **SQL** |

Vendor ranking, cost thresholds, occupancy, checkout detection, readiness
checks, approval gating — all deterministic. An LLM cannot pick a vendor,
approve a cost, or decide a unit is ready.

---

## Data model

```
companies ──┬── users ──── sessions
            ├── properties ──── units ──┬── residents (LTR tenant or STR guest)
            │                           ├── unit_calendars ──── bookings
            │                           └── turns ──── turn_events
            ├── vendors ──┬── vendor_performance
            │             └── vendor_sessions
            ├── owners
            └── maintenance_requests ──── maintenance_events

admins ──── admin_sessions          (separate, internal only)
```

A short-term guest is just a `resident` with check-in/check-out dates. Same
table, same reporting link, same maintenance path. That's what makes the
mixed portfolio work without a second system.

---

## Environment variables (agents service)

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | internal Postgres host |
| `ANTHROPIC_API_KEY` | yes | the diagnose step |
| `RESEND_API_KEY` | no | vendor + readiness emails; without it dispatch still works, just silently sends nothing |
| `NOTIFY_FROM_ADDRESS` | no | defaults to `dispatch@notify.traxkey.ai` |
| `POLL_INTERVAL_SECONDS` | no | default 900 |
| `CALENDAR_SYNC_INTERVAL_SECONDS` | no | default 3600 |

---

## Observability

There is no LangGraph Studio (see above). Visibility comes from:

1. **AI Activity page** (`app.traxkey.ai/activity`) — every request with its
   full decision trail. Customer-facing.
2. **Admin dashboard** (`app.traxkey.ai/admin`) — platform-wide metrics.
3. **Railway logs** on the agents service — the worker prints each action.
4. **`maintenance_events` / `turn_events` tables** — the durable audit trail
   everything else reads from.
