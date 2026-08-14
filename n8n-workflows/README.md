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

## Importing

Import replaces the whole workflow. If only one node changed, paste that
node's JSON onto the canvas instead, it is faster and cannot pull in a stale
copy of everything else.
