# TraxKey AI — Platform Roadmap

**Decision (2026-08-13):** build toward a full AI property operations
platform, **excluding accounting, trust ledgers, and rent collection**. Those
carry real legal and compliance exposure and are well served elsewhere.
TraxKey handles operations; money stays with QuickBooks, Stripe, or whatever
the operator already uses.

**Why this exists:** a prospective customer evaluated TraxKey and said it
was "not even at the base level of competitors." They were right. We had one
workflow done well, not a platform. This is the list that closes that gap.

---

## The AI specialist model

Each specialist owns a workflow end to end, the same way the Maintenance
Coordinator does today: deterministic facts, AI only for judgment, human
approval where money or reputation is at stake.

| # | Specialist | Status | Serves |
|---|---|---|---|
| 1 | **Maintenance Coordinator** | ✅ built | Both |
| 2 | **Turnover Coordinator** | 🟡 cleaner assignment built, checklist/app open | Both |
| 3 | **Lease Agent** | 🟡 built, pending migration | Long-term |
| 4 | **Renewal Agent** | 🟡 built, pending migration | Long-term |
| 5 | **Resident Communications** | ❌ | Long-term |
| 6 | **Guest Experience** | ❌ | Short-term |
| 7 | **Inspection Agent** | ❌ | Both |
| 8 | **Owner Relations** | ❌ | Both |
| 9 | **Supply & Inventory** | ❌ | Short-term |
| 10 | **Leasing / Applications** | ❌ | Long-term |

---

## Long-term rental gaps (in build order)

### 1. Leases and lease tracking — BUILT (schema v15)
Cannot credibly call this a PM platform without it. Lease start/end, rent
amount, deposit, terms, documents. **We track rent amounts; we don't collect
them.**

*AI angle:* flag expirations, surface below-market rents, catch missing
documents.

### 2. Renewal Agent — BUILT (folded into the Lease Agent)
Lease expiring in 90/60/30 days, draft the renewal offer, track response.
Renewals are the single highest-leverage retention lever a PM has and most
tools treat it as a calendar reminder.

*AI angle:* drafts the offer using the resident's actual history (payment
timeliness, maintenance behaviour, tenure).

### 3. Inspection Agent
Move-in, move-out, periodic. Photo checklists, condition comparison.

*AI angle:* compare move-out photos to move-in, identify damage beyond
normal wear, draft the deposit deduction rationale. This one is genuinely
differentiated and directly feeds turn management, which already exists.

### 4. Resident Communications
Every message with a resident in one thread. Announcements, notices.

*AI angle:* drafts responses to routine questions, escalates the rest.

### 5. Document storage
Leases, insurance certificates, inspection reports, notices. Unglamorous,
but its absence is disqualifying.

### 6. Leasing / Applications
Application intake, screening (integrate, don't build), showing scheduling.

*Note:* screening touches FCRA. Integrate a licensed provider, never build
our own scoring.

---

## Short-term rental gaps (in build order)

### 1. Turnover Coordinator — cleaner assignment BUILT, checklist/app still open
A cleaning turn now assigns a cleaner automatically the same pass it opens,
ranked by the same completion-rate/rating/cost history as any vendor. No
checklist UI or cleaner-facing app yet, cleaners currently work off the
existing vendor portal built for repairs.

*AI angle:* assigns based on cleaner performance history, same engine as
vendor scoring.

### 2. Guest Experience Agent
Pre-arrival instructions, check-in details, mid-stay check, post-checkout.

*AI angle:* answers routine guest questions, escalates real problems into
maintenance requests automatically.

### 3. Supply & Inventory
Cleaners report what's low. Consumables tracked per unit.

*AI angle:* predicts restock timing from turnover frequency.

### 4. Access codes / smart locks
Per-stay codes, auto-expiring. Needs per-vendor integration (August, Yale,
Schlage, Seam covers several at once).

### 5. Damage and incident capture
Photo evidence at checkout, tied to the turn and the booking.

---

## Deliberately NOT building

| Thing | Why |
|---|---|
| Accounting, trust ledgers, rent collection | Legal and compliance exposure. Integrate instead. |
| Tenant screening scoring | FCRA-regulated. Integrate a licensed provider. |
| Dynamic pricing | PriceLabs and Beyond own it, needs market data we don't have. |
| Channel management (write-back) | Gated APIs, Hostaway/Guesty territory. Read-only iCal is enough. |

---

## Honest scope note

This is 6 to 12 months of work at a realistic pace, not weeks. The order
above is deliberate: each item is sequenced by whether its absence blocks an
evaluation, not by how interesting it is to build.

The highest-value single conversation is still with the operator who gave
the "not base level" feedback: ask which three of these would have changed
their answer. That would cut this list roughly in half.
