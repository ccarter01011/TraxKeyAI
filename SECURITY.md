# TraxKey AI — Security

Rules this codebase follows, and the reasoning behind each one. Like
`n8n-workflows/audit.py`, most of this is a list of scars: nearly every rule
exists because the failure it prevents actually shipped.

The governing assumption: **all input is unsafe.** Not just the obvious
fields — request bodies, headers, inbound email, and anything an LLM returns
after reading them.

---

## Trust boundaries

Knowing which surfaces are reachable by whom is most of the work. TraxKey has
four tiers, and they are easy to confuse.

| Tier | Who can reach it | Examples |
|---|---|---|
| **Public, unauthenticated** | anyone on the internet | maintenance intake, marketing chatbot, tenant chatbot, inbound email replies, lead capture |
| **Any authenticated user** | anyone who signs up — signup is open, so treat as near-public | most operator endpoints |
| **Scoped principal** | vendor / owner / resident portal sessions | portal endpoints |
| **Internal** | cron loops, admin | batch passes, admin dashboard |

Two consequences people get wrong:

- **"Authenticated" is not a meaningful barrier on its own.** Signup is open,
  so any authenticated-only endpoint is one free account away from public. A
  bug reachable by "any logged-in user" is close to a public bug, and the two
  SQL injections fixed in `9fdf4b7` were exactly that shape.
- **Unauthenticated write surfaces fan out.** The maintenance intake webhook
  takes free text from anyone holding a portal slug. That text later reaches
  an LLM prompt, several HTML emails, and multiple portal screens. One
  unvalidated write surface becomes many read surfaces.

---

## SQL

There is no parameterised query mechanism in the n8n layer. Interpolated
values are substituted as raw text into the SQL string, so **every
interpolation is a decision about trust.**

Run the audit before committing any workflow change:

```
python3 n8n-workflows/audit.py
```

### Quoted vs unquoted position

This distinction caused two real injections and is the single most important
thing on this page.

```sql
-- quoted: escaping quotes is a real defence
WHERE name = '{{ ...body.name.replace(/'/g, "''") }}'

-- unquoted: escaping quotes is irrelevant, the attacker needs no quote
SET final_cost = {{ ...body.finalCost }}
```

`|| 'NULL'` is **not** a defence. It substitutes only on a *falsy* value, so
any non-empty string passes through verbatim.

For a numeric column, coerce and prove finite:

```
{{ [null,undefined,''].includes(V) || !Number.isFinite(Number(V)) ? 'NULL' : Number(V) }}
```

### Safe patterns

| Position | Safe form |
|---|---|
| Quoted string | `.replace(/'/g, "''")` |
| Identifier / token | `.replace(/[^a-zA-Z0-9]/g, "")` |
| Numeric | `Number()` + `Number.isFinite` guard, else `NULL` |
| Boolean | `V ? 'true' : 'false'` — the value steers a choice, it is never emitted |
| Enum | allowlist in a Code node, fall back to a known-good default |

The boolean form is safe for a reason worth internalising: the untrusted
value is only a *condition*. It picks which fixed literal is emitted; it
never becomes part of the SQL text. `V || 'NULL'` looks similar and is not
— it returns `V` itself.

### Python

`agents/` uses psycopg parameter binding (`cur.execute(sql, params)})`)
throughout, which is safe. Never build SQL with f-strings. Where a column
name must be dynamic, it comes from a hardcoded whitelist, never the request
— see `property_profile.save_profile`.

### Multi-tenancy

Every query touching tenant data must constrain to the caller's
`company_id`, derived from the session — never from the payload. A function
that *accepts* `company_id` and does not *use* it is a tenant break, not a
style problem. Prefer making membership part of the statement
(`INSERT ... SELECT ... WHERE company_id = ...`) so a foreign ID writes zero
rows instead of succeeding.

---

## Untrusted text in HTML

React escapes `{value}` by default, and the React app relies on that
correctly. The risk lives in the escape hatches:

- `dangerouslySetInnerHTML`, `innerHTML`, `document.write`
- The vanilla-JS portals (`traxkey-*-portal/`), which build markup by string
  concatenation and do **not** get React's protection
- HTML email bodies built by f-string in `agents/` or by concatenation in
  n8n nodes
- `href` / `src` bound to a stored value — React does not validate URL
  schemes, so a stored `javascript:` URL will execute on click

Escape at the point of rendering. For emails, remember the recipient is a
third party — a vendor, resident, or owner — so injected markup is a
phishing vector sent from a domain you sign.

---

## LLM surfaces

Anything a model reads is untrusted input, and anything it returns is
untrusted output. Both directions need handling.

**Input.** Fence untrusted text with explicit markers and state plainly that
it is data, not instructions. Cap its length before it reaches the model —
an uncapped prompt on a public endpoint is an unbounded bill.

**Output.** Never write model output anywhere consequential without
constraining it first:

- to an allowlist, for classifications and enums
- to a strict regex, for dates and identifiers
- never straight into SQL

`graph.py`'s classifier shows the shape: fenced prompt in, `_pick()` against
`VALID_TRADES` / `VALID_URGENCIES` on the way out. Without that constraint a
prompt injection could assert `urgency: emergency` and jump the dispatch
queue — a business-logic compromise that needs no SQL injection at all.

**Rate limiting.** Every LLM endpoint costs real money per call, so an
unthrottled one is a financial denial-of-service, not only an abuse problem.
Key the limit on the right identity:

- authenticated → `company_id` from the session. Not the token (trivially
  multiplied by logging in again) and not the IP (not a billing boundary).
- public → client IP, read from the **rightmost** `X-Forwarded-For` element.
  Each proxy hop *appends*, so the leftmost value is whatever the client
  sent. Reading element `0` trusts the attacker and lets a rotating header
  hand every request a fresh bucket.

---

## Secrets

`.env` is gitignored; only `agents/.env.example` is tracked, with
placeholders. Nothing else belongs in the repo — **this repository is
public.** Do not commit a signing secret into a workflow JSON; read it from
the environment, or use a credential the workflow references by name.

If a secret is ever committed, rotating it is the fix. Deleting the file is
not — the blob stays in history.

---

## Reviewing a change

- Ran `python3 n8n-workflows/audit.py`?
- Every new interpolation: quoted or unquoted, and sanitised for that
  position?
- Every new query scoped to the session's `company_id`?
- New endpoint: which trust tier, and is that deliberate?
- Untrusted text reaching HTML or an email — escaped?
- New LLM call — input fenced and capped, output constrained, endpoint
  throttled?

The audit script is a floor, not a ceiling. It only reads
`parameters.query`, and it cannot see XSS, authorization, or rate limiting at
all. A clean run means the known traps were avoided, not that the change is
safe.
