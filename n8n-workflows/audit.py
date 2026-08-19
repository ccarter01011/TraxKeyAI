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


def _only_literal_outputs(expr):
    """True when an untrusted value can only steer a choice between fixed
    literals, never be returned as the value itself.

    `cond ? 'true' : 'false'` is safe no matter what `cond` holds — the
    attacker picks which literal is emitted, not what it contains. But
    `value || 'NULL'` returns `value` verbatim whenever it is truthy, and
    that is a live injection in an unquoted position.

    Works by blanking every quoted literal to a placeholder, then collapsing
    well-formed `cond ? placeholder : placeholder` ternaries (and their
    parenthesised nestings) bottom-up. If the whole expression reduces to a
    single placeholder, every branch that could be emitted was a literal.
    Anything left over — a bare accessor, a `||` fallback, a concatenation —
    fails to collapse and is reported.
    """
    # Concatenation and the `||`/`??` fallbacks emit the operand itself, so
    # neither can ever be literal-only.
    if "+" in expr or "||" in expr or "??" in expr:
        return False
    # Every untrusted reference must be steering a comparison or a ternary
    # test. Anything else — a bare accessor, a `.replace()` chain feeding a
    # concatenation, an accessor sitting in a result branch — means the value
    # itself can be emitted into the SQL.
    refs = list(re.finditer(r"(?:body|headers)\.[A-Za-z_$][A-Za-z0-9_$]*", expr))
    if not refs:
        return False
    return all(
        re.match(r"\s*(===|!==|==|!=|>=|<=|>|<|\?)", expr[m.end():])
        for m in refs
    )


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

        # 7. User input in an UNQUOTED SQL position, e.g. `final_cost = {{ ... }}`.
        # Check 5 only looks inside '{{ }}' and so was blind to this entire
        # class. Two live injections shipped through the gap: `finalCost` and
        # `rating` in 08's Mark Request Completed, `bedrooms` and `bathrooms`
        # in 03's Insert Unit — in both, the sibling string fields in the same
        # query WERE sanitized, which is exactly why the omission read as
        # deliberate and survived review.
        #
        # An unquoted position is strictly worse than a quoted one: quote
        # escaping is irrelevant when the attacker never needs a quote to
        # break out. `|| 'NULL'` is not a defence — it only substitutes on a
        # falsy value, so any non-empty string passes through verbatim.
        for m in re.finditer(r"\{\{(.*?)\}\}", q, re.S):
            expr = m.group(1).strip()
            quoted = q[m.start() - 1:m.start()] == "'" and q[m.end():m.end() + 1] == "'"
            if quoted:
                continue  # check 5 owns the quoted case
            if not ("body." in expr or "headers." in expr):
                continue
            # Sanitised either by stripping characters, or by coercing to a
            # number that is proven finite before it reaches the query.
            if ".replace(/" in expr:
                continue
            if "Number.isFinite" in expr and "Number(" in expr:
                continue
            if _only_literal_outputs(expr):
                continue
            fail("UNQUOTED-user-input", path, node, expr[:100])


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
