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
| `business_memory.py` | Resolves per-company override rules. No AI, pure precedence logic. |
| `cleaner_assignment.py` | Opens a pre-classified cleaning job when a cleaning turn opens. |
| `lease_agent.py` | Activates/ends lease terms, flags silent renewals, opens move-out turns. |
| `lead_followup.py` | 48hr invite-and-feedback email to marketing-site leads who never signed up. |
| `ical_sync.py` | Fetches and parses Airbnb/Vrbo calendar feeds. |
| `checkout_turns.py` | Opens a cleaning turn when a guest checks out. |
| `readiness.py` | Flags units not ready before an arrival. |
| `review_risk.py` | Flags stays where a maintenance issue landed near checkout, unresolved. |
| `concierge.py` | Customer dashboard briefing: lead sentence + bulleted to-dos. |
| `admin_concierge.py` | Founder dashboard briefing, same shape, different facts. |
| `sales_chat.py` | Public marketing-site chatbot, throttled, fixed product brief only. |
| `db.py` | Shared Postgres connection. |

### The loop (`worker.py`)

```
every POLL_INTERVAL_SECONDS (default 15 min):
    run_batch()                    ← the LangGraph agent

every CALENDAR_SYNC_INTERVAL_SECONDS (default 1 hr):
    sync_all_calendars()           ← pull iCal feeds
    run_checkout_turns()           ← open cleaning turns
    run_cleaner_assignment()       ← assign a cleaner to any turn missing one
    run_readiness_checks()         ← flag unready units
    run_review_risk_checks()       ← flag stays that ended with an open issue
    run_lease_agent()              ← activate/end leases, flag silent renewals
    run_lead_followup()            ← email leads who never converted, once, at 48h
```

Each is wrapped in its own try/except. One failing never stops the others.
`cleaner_assignment` runs right after `checkout_turns` so a turn it just
opened gets a cleaning job the same pass, not an hour later.

### The LangGraph graph (`graph.py`)

This is the only actual LangGraph component. A `StateGraph` with six nodes:

```
        ┌──────────────┐
        │ load_context │  SQL: request, threshold, occupancy,
        └──────┬───────┘      Business Memory rules for this company
               ▼
        ┌──────────────┐
        │  diagnose    │  ◄── THE ONLY AI CALL IN THE SYSTEM
        └──────┬───────┘      Claude classifies category, urgency,
               │               owner-vs-tenant. Occupancy passed as context.
               │               SKIPPED when category/urgency/responsibility
               │               already arrived pre-set (a cleaning job from
               │               cleaner_assignment.py has nothing ambiguous
               │               to classify, so no API call is spent on it).
               ▼
      ┌────────┴─────────┐
      │ operator flagged │──► hold_for_review ──► END (status: needs_human_review)
      │ this resident?   │    (a tenant-abuse flag is a human decision,
      ▼                        never automated, see LOGIC-FLOWS.md)
┌──────────────┐
│ find_vendor  │  SQL: rank by completion rate → rating → cost.
└──────┬───────┘      A Business Memory preferred_vendor rule wins outright
       │               over ranking (falls back to ranking if that vendor
       │               no longer exists or does this trade).
      ┌────────┴────────┐
      │ no vendor?      │──► END (status: needs_vendor)
      ▼
┌────────────────┐
│ check_approval │  SQL: cost vs threshold, all overridable by Business
└───────┬────────┘      Memory (approval_threshold, always_require_approval,
        │               quiet_hours) — each can only make this stricter
        │               than the company default, never looser.
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
unit_id, property_id, timezone, cost_approval_threshold, category, urgency,
responsibility, vendor_id, quoted_cost, known_cost, requires_approval,
occupancy, requires_human_review, review_reason, rules, final_status.

**`rules`** is every Business Memory row for the company, loaded once in
`load_context` and resolved deterministically downstream in
`business_memory.py`. The LLM never sees these rules; they are Python-level
overrides applied before and after the one AI call, not something the model
weighs as a suggestion.

**`run_batch()`** does two passes each cycle:
1. Every request at `status = 'submitted'` → push through the graph.
2. Every request at `assigned` with `approved_at` set → `dispatch_approved()`,
   which skips diagnosis/vendor-matching (already done before the pause) and
   just finishes the dispatch.

That second pass is how a human approval resumes the flow.

### Business Memory precedence (`business_memory.py`)

Four rule types, `approval_threshold`, `always_require_approval`,
`quiet_hours`, `preferred_vendor` — each scoped to `global`, `trade`,
`property`, or `unit`. Resolution order, most specific wins:

```
unit  >  property  >  trade  >  global  >  company default
```

Every rule type can only make dispatch *more* cautious than the company
default, never less; there is no rule that widens the auto-approve gate.
Unit-tested standalone (22 cases: precedence at every scope, unknown-scope
non-match, malformed value/window fail open to the safer default,
midnight-wrapping quiet-hours windows) before being wired into `graph.py`,
because a precedence bug here would fail silently. Verified end-to-end in
production against real dispatch for all four rule types (2026-08-14).

### What is *not* AI

Worth stating plainly, because it's the design rule the whole system follows:

| Step | Mechanism |
|---|---|
| Diagnose free-text description (when not already known) | **Claude** |
| Everything else | **SQL** |

Vendor ranking, cost thresholds, Business Memory resolution, occupancy,
checkout detection, readiness checks, review-risk flagging, approval gating,
lease activation, cleaner assignment — all deterministic. An LLM cannot pick
a vendor, approve a cost, decide a unit is ready, or set its own dispatch
rules.

---

## Data model

```
companies ──┬── users ──── sessions
            ├── business_memory              (per-company override rules)
            ├── properties ──── units ──┬── residents (LTR tenant or STR guest)
            │                           ├── leases ──── lease_events
            │                           ├── unit_calendars ──── bookings
            │                           └── turns ──── turn_events
            ├── vendors ──┬── vendor_performance
            │             └── vendor_sessions
            ├── owners
            ├── review_risks
            └── maintenance_requests ──── maintenance_events

leads                                (marketing site, no company_id — pre-signup)
admins ──── admin_sessions           (separate, internal only)
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
| `RESEND_API_KEY` | no | vendor, readiness, and lead-followup emails; without it those send silently nothing, dispatch itself still works |
| `NOTIFY_FROM_ADDRESS` | no | defaults to `dispatch@notify.traxkey.ai` |
| `FOLLOWUP_FROM_ADDRESS` | no | defaults to `team@notify.traxkey.ai`, used by `lead_followup.py` |
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
