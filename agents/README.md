# AI Maintenance Coordinator

LangGraph agent, deployed as its own Railway service in the same project as
n8n and Postgres.

## Deploy

1. In Railway, connect this service to `ccarter01011/TraxKeyAI`, root
   directory `/agents` (same GitHub-auto-deploy pattern as the other four
   TraxKey services).
2. Set two environment variables on the service:
   - `DATABASE_URL` — the internal connection string, `postgresql://postgres:PASSWORD@postgres.railway.internal:5432/railway` (same DB the n8n Postgres credential uses, internal host since this runs in the same project).
   - `ANTHROPIC_API_KEY` — a real Anthropic API key.
3. Once deployed and responding (check `https://<this-service>/ok`), set up
   a cron job via LangGraph Platform's API so `run_batch()` fires on a
   schedule, e.g. every 15 minutes, picking up any request sitting at
   `status = 'submitted'`. Not configured yet, needs the service live first.

## Why polling instead of a webhook trigger

n8n's intake workflows (`traxkey-maintenance-intake`, `traxkey-resident-
intake`) don't call this service directly. Editing an already-published n8n
workflow has been a real source of friction this project (stale webhook
caches, workflow-version-history gaps), so this deliberately avoids ever
needing to touch those two workflows again. A scheduled batch pass, same
pattern as TraxSail's supplier follow-up automation, is simpler and no less
timely for an MVP.

## What it does, and doesn't do yet

See `maintenance-coordinator-design.md` for the full design. Current scope:
diagnose (the one LLM step) → find the best vendor on file by real
performance history (deterministic) → auto-dispatch if the estimated cost is
under the company's approval threshold, otherwise pause for a human.
Follow-up, verification, and invoicing are the next increment, not built.
