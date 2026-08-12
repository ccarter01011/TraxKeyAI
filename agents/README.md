# AI Maintenance Coordinator

Runs as its own Railway service in the same project as n8n and Postgres.
Not LangGraph Platform's own server, see "Why a plain worker" below, a
small always-on Python process (`worker.py`) that runs a LangGraph
`StateGraph` (`graph.py`) on a polling loop.

## Deploy

1. In Railway, connect this service to `ccarter01011/TraxKeyAI`, root
   directory `/agents`.
2. Environment variables:
   - `DATABASE_URL` — `postgresql://postgres:PASSWORD@postgres.railway.internal:5432/railway` (internal host, same DB the n8n Postgres credential uses).
   - `ANTHROPIC_API_KEY` — real key, used for the one diagnosis step.
   - `RESEND_API_KEY` — optional, enables vendor dispatch email notifications. Without it, dispatch still works, vendors just aren't emailed.
   - `NOTIFY_FROM_ADDRESS` — optional, defaults to `dispatch@notify.traxkey.ai`. Needs that domain (or whichever you set) verified in Resend first, see the DNS setup notes wherever that ended up (chat history as of this writing, not yet a doc).
   - `POLL_INTERVAL_SECONDS` — optional, defaults to 900 (15 min). Lower it temporarily (e.g. 60) for faster feedback while testing, dial back up for production.
3. Health check: `https://<this-service>/ok` should return `{"status":"ok"}` once live.

## Why a plain worker, not LangGraph Platform's own server

The Railway LangGraph template's launcher expects `./run.sh`, and its
production self-hosted server invocation (the actual `langgraph-api`
package internals) wasn't documented clearly enough to guess correctly
without repeated failed deploys. `worker.py` sidesteps that entirely: it
just calls `run_batch()` on a loop and answers health checks. Real
consequence: no LangGraph Studio, there's nothing for it to connect to.
The in-product **Activity page** (`app.traxkey.ai/activity`) is the
substitute, every request's full event trail, in order.

## Why polling instead of a webhook trigger

n8n's intake workflows (`traxkey-maintenance-intake`, `traxkey-resident-
intake`) don't call this service directly. Editing an already-published
n8n workflow has been a real source of friction on this project (stale
webhook caches, workflow-version-history gaps), so this deliberately
avoids ever needing to touch those two workflows again. A scheduled batch
pass, same pattern as TraxSail's supplier follow-up automation.

## What it does, and doesn't do yet

See `maintenance-coordinator-design.md` for the full design. Current
scope: diagnose (the one LLM step) → find the best vendor on file by real
performance history (deterministic) → auto-dispatch if the estimated cost
is under the company's approval threshold and the vendor has real cost
history, otherwise pause for a human → on approval, dispatch → email the
vendor if `RESEND_API_KEY` is set. Follow-up, verification, invoicing,
and SMS vendor notification are the next increments, not built.
