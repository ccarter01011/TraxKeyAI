# n8n workflows

**This directory is the only source of truth for workflow JSON.**

Do not keep copies anywhere else in the repo. Two copies of the same
workflow is how a stale one gets imported by accident, which has cost real
debugging time twice: once shipping a broken `INSERT ... VALUES ... WHERE`
that had already been fixed here, and once re-importing a pre-security-fix
version of the same file.

## Before committing any change to these files

Run the audit. It checks the failure modes that have actually bitten this
project, not hypothetical ones:

```bash
python3 n8n-workflows/audit.py
```

It fails on:

1. **Unsanitized session tokens** — the `Authorization` header interpolated
   into SQL without `.replace(/[^a-zA-Z0-9]/g, "")`. This shipped once and
   allowed a full authentication bypass (`Bearer ' OR '1'='1` returned another
   company's data). Never let it back.
2. **`INSERT ... VALUES (...) WHERE ...`** — invalid SQL. A `WHERE` clause
   requires `INSERT ... SELECT`.
3. **Dangling node references** — `$("Node Name")` pointing at a node that
   does not exist.
4. **Postgres nodes missing `alwaysOutputData`** — a conditional statement
   matching zero rows emits no items and the chain dies silently.
5. **User input interpolated raw** — `body.*` values inside SQL string
   literals with no escaping or character-class stripping.
6. **User input in an unquoted SQL position** — e.g. `final_cost = {{ ... }}`.
   Check 5 only ever looked *inside* quotes, so this whole class was
   invisible to it and two injections shipped through the gap. Quote escaping
   is no defence in an unquoted position: the attacker never needs a quote.
   Neither is `|| 'NULL'`, which substitutes only on a falsy value and passes
   any non-empty string through verbatim. Coerce numerics with `Number()`
   behind a `Number.isFinite` guard.

   The check distinguishes a value that can be **returned** (`v || 'NULL'`,
   concatenation, a bare accessor) from one that only **steers a choice**
   between fixed literals (`v ? 'true' : 'false'`). The second is safe — the
   untrusted value is a condition, never part of the emitted SQL — and is
   used deliberately in workflows 05 and 17.

What it does **not** check: anything outside `parameters.query`. Code node
`jsCode`, HTTP request bodies, XSS, authorization, tenant scoping, and rate
limiting are all invisible to it. A clean run means the known traps were
avoided, not that the change is safe. See [../SECURITY.md](../SECURITY.md).

## Importing

Import replaces the whole workflow. If only one node changed, paste that
node's JSON onto the canvas instead, it is faster and cannot pull in a stale
copy of everything else.
