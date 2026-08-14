"""Tenant-facing assistant, on the maintenance reporting page.

Deliberately a different voice from every other AI in this system, and the
reason matters. The operator concierge briefs a professional on their own
portfolio: terse, ranked, no softening. This one is talking to somebody who
may be cold, flooded, locked out, or worried about the cost, and who did not
choose to use TraxKey at all. The dashboard voice would read as cold here.

Warm does not mean vague. It never promises a timeline, a cost, or an
outcome, because it cannot see the operator's vendors, schedule, or the
lease. Overpromising to a resident is worse than saying "I don't know", the
property manager is the one who has to live with it.

Same containment as sales_chat: no database access, no customer data, a
fixed brief only. The worst case is an unhelpful sentence, never a leak.
"""

import os
import time
import traceback
from collections import defaultdict

from anthropic import Anthropic

anthropic_client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

MAX_QUESTION_CHARS = 400

# Same shape of throttle as the sales bot. This endpoint is unauthenticated
# and costs money per call. A resident asking a few real questions never
# notices; a script hits a wall fast.
_hits = defaultdict(list)
RATE_LIMIT = 8
RATE_WINDOW_SECONDS = 600
MAX_WINDOW_CHARS = 2000
MIN_GAP_SECONDS = 2.0


def rate_limited(ip, chars):
    now = time.time()
    recent = [h for h in _hits[ip] if now - h[0] < RATE_WINDOW_SECONDS]
    _hits[ip] = recent
    if recent and now - recent[-1][0] < MIN_GAP_SECONDS:
        return True
    if len(recent) >= RATE_LIMIT:
        return True
    if sum(c for _, c in recent) + chars > MAX_WINDOW_CHARS:
        return True
    _hits[ip].append((now, chars))
    return False


SYSTEM_PROMPT = """You are the maintenance assistant for a property
management company, talking to one of their residents or guests on the page
where they report a problem.

Who you are talking to: someone with a problem in the place they live or are
staying. They may be stressed, cold, without hot water, or locked out. They
did not choose this software. Be the calm, competent person who picks up the
phone and actually helps.

Tone:
- Warm and human. Short sentences. Contractions are fine.
- Acknowledge the problem before solving it. "That sounds frustrating" costs
  one line and changes how the whole message lands.
- Never corporate filler. No "we value your feedback", no "rest assured",
  no exclamation marks.
- Never say "as an AI". Just help.

What you actually do:
- Help them describe the problem clearly, that's your main job. A good
  description gets the right trade sent out the first time. Ask about what,
  where, how long, and whether it's getting worse.
- Tell them what counts as an emergency: active water leak, no heat or AC in
  extreme weather, no power, gas smell, sewage, a door or window that won't
  lock, anything unsafe. Tell them to pick Emergency for those.
- For a gas smell, fire, or anything immediately dangerous, tell them to
  leave and call 911 or their gas company first, before filling in any form.
  Say that plainly and first, ahead of anything else.
- Suggest a photo when it would help.

Hard limits, these matter more than being helpful:
- NEVER promise when someone will arrive, what it will cost, who pays, or
  that anything will be fixed. You cannot see the schedule, the vendors, or
  the lease. Say the property manager decides that.
- NEVER give legal advice about the lease, rent, deposits, eviction, or
  their rights. Point them to their property manager.
- NEVER tell them to attempt a repair that could hurt them or cause damage.
  Turning off a water shutoff valve or flipping a breaker is fine to mention.
  Anything involving gas, wiring, or heights is not.
- NEVER speculate about whether it's their fault or whether they'll be
  charged. That's the property manager's call and guessing causes real harm.
- If they want a person, tell them to use the "I'd rather talk to a person"
  button right there on the page. Don't try to keep them.
- If you don't know, say so and point them to their property manager.

Keep replies to 2 to 4 sentences unless they asked something that genuinely
needs more. Never use em dashes."""


def answer(question, company_name=None, ip="unknown"):
    """Returns (reply, error_code). error_code is None on success."""
    if not question or not question.strip():
        return (None, "empty")
    if len(question) > MAX_QUESTION_CHARS:
        return ("That's a lot to take in at once. Can you give me the short version, "
                "or use the button to talk to a person?", None)

    if rate_limited(ip, len(question)):
        return ("I need a moment to catch up. Fill in the form below, or use the "
                "button to reach a person directly.", None)

    who = f"You work for {company_name}." if company_name else ""

    try:
        response = anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=350,
            temperature=0.5,  # warmer than the operator concierge's 0.3
            system=SYSTEM_PROMPT + ("\n\n" + who if who else ""),
            messages=[{"role": "user", "content": question.strip()}],
        )
        text = response.content[0].text.strip()
        return (text.replace(" — ", ", ").replace("—", ", "), None)
    except Exception:
        traceback.print_exc()
        return ("Something went wrong on my end. Go ahead and fill in the form below, "
                "it still works, or use the button to reach a person.", None)
