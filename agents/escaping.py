"""HTML escaping for outbound email bodies.

Every email this service sends is assembled by f-string interpolation into
an HTML document, which means any interpolated value is markup unless it is
escaped first. A lot of those values are attacker-reachable — the
maintenance description arrives from the PUBLIC, unauthenticated intake
webhook, and names, addresses, and invoice text are all free-text fields.

The recipient is what makes this matter. These emails go to vendors,
residents, owners, suppliers, and customers, from a domain TraxKey signs
with DKIM. Unescaped input does not execute script in a mail client, so this
is not XSS — it is worse in the way that counts: an attacker can inject a
link into a legitimately-signed message from a company the recipient already
trusts. That is a phishing vector wearing our return address.

Use `esc()` on every interpolated value. For a value that is deliberately
markup we generated ourselves — a pre-rendered `<ul>` of items, say — leave
it unescaped, but build its contents with `esc()` too.
"""

import html


def esc(value):
    """Escape a value for interpolation into an HTML email body.

    `quote=True` also escapes " and ', so the result is safe inside an
    attribute (`href="..."`), not only in text.
    """
    if value is None:
        return ""
    return html.escape(str(value), quote=True)
