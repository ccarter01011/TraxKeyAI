#!/usr/bin/env python3
"""Pre-commit audit for TraxKey n8n workflow JSON.

Every check here exists because the failure it catches actually shipped and
cost real debugging time. This is not a generic linter, it is a list of
scars. Run it before committing any workflow change:

    python3 n8n-workflows/audit.py

Exits non-zero if anything fails.
"""

import glob
import json
import os
import re
import sys

AUTH_EXPR = "headers.authorization"
AUTH_SAFE = 'replace(/[^a-zA-Z0-9]/g, "")'

# Values that come from the database or are generated server-side. Safe to
# interpolate, they can never carry an attacker-controlled quote.
TRUSTED = re.compile(
    r"^\$json\.(company_id|user_id|id|unit_id|resident_id|vendor_id|admin_id"
    r"|assigned_vendor_id|token|expiresAt|expires_at)$"
    r"|^\$\(.+\)\.first\(\)\.json\.(id|unit_id|company_id|end_date|rent_amount"
    r"|deposit_amount|rent_due_day|notice_days|renewal_rent_amount|renewal_status"
    r"|assigned_vendor_id)$"
)

failures = []


def fail(kind, f, node, detail=""):
    failures.append(f"[{kind}] {os.path.basename(f)} / {node}" + (f"\n        {detail}" if detail else ""))


def audit(path):
    d = json.load(open(path))
    names = {n["name"] for n in d.get("nodes", [])}

    for n in d.get("nodes", []):
        p = n.get("parameters", {})
        q = p.get("query", "")
        node = n["name"]

        # 4. Postgres node without alwaysOutputData: a conditional statement
        # matching zero rows emits nothing and the chain dies silently.
        if n.get("type", "").endswith("postgres") and not n.get("alwaysOutputData"):
            # Unconditional INSERT/UPDATE always emits, so it is exempt.
            if q and re.search(r"\bWHERE\b", q, re.I):
                fail("no-alwaysOutputData", path, node)

        if not q:
            continue

        # 1. CRITICAL: session token from the Authorization header must be
        # character-stripped. Shipping this raw allowed a full auth bypass.
        if AUTH_EXPR in q and AUTH_SAFE not in q:
            fail("AUTH-BYPASS", path, node,
                 "Authorization header interpolated without .replace(/[^a-zA-Z0-9]/g, \"\")")

        # 2. INSERT ... VALUES (...) WHERE ... is invalid SQL.
        m = re.search(r"\bVALUES\s*\(", q, re.I)
        if re.search(r"INSERT\s+INTO", q, re.I) and m:
            tail = q[m.start():]
            if re.search(r"\bWHERE\b", tail, re.I) and "SELECT" not in tail.upper().split("WHERE")[0]:
                fail("invalid-sql", path, node, "INSERT ... VALUES ... WHERE requires INSERT ... SELECT")

        # 3. Dangling $("Node Name") references.
        for ref in re.findall(r'\$\("([^"]+)"\)', q):
            if ref not in names:
                fail("dangling-ref", path, node, f'$("{ref}") does not exist')

        # 5. Raw user input inside a SQL string literal.
        for m in re.finditer(r"'\{\{(.*?)\}\}'", q, re.S):
            expr = m.group(1).strip()
            if TRUSTED.match(expr):
                continue
            if ".replace(/'/g" in expr or ".replace(/[^" in expr:
                continue
            if "body." in expr or "headers." in expr:
                fail("raw-user-input", path, node, expr[:100])

        # 6. Raw string concatenation into a quoted SQL literal, the
        # `cond ? "'" + value + "'" : 'NULL'` idiom. Easy to miss because it
        # sits outside the quoted-literal pattern check above.
        for m in re.finditer(r"\"'\"\s*\+\s*([^+]{0,120}?)\s*\+\s*\"'\"", q):
            inner_expr = m.group(1)
            if ".replace(/" not in inner_expr:
                fail("raw-concat", path, node, inner_expr.strip()[:100])


for f in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "*.json"))):
    audit(f)

# The duplicate-copy trap: a second copy of any workflow outside this
# directory is how a stale version gets imported by accident.
repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
strays = glob.glob(os.path.join(repo_root, "TraxKey-*.json"))
for s in strays:
    failures.append(f"[duplicate-copy] {os.path.basename(s)} exists outside n8n-workflows/, delete it")

if failures:
    print(f"AUDIT FAILED, {len(failures)} issue(s):\n")
    for x in failures:
        print("  " + x)
    sys.exit(1)

print("Audit passed.")
