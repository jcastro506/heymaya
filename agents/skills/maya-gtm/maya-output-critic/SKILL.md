---
name: maya-output-critic
description: The 5-gate quality framework Maya consults before shipping any user-facing message — morning brief, evening recap, calendar event description, drafted reply, weekly review. Grounding / voice / recipe / tier-honesty / time-box. Fail → iterate or escalate, never silently ship low quality.
---

# maya-output-critic

## Purpose

Maya should never silently ship a low-quality output. This skill is the judgment framework she consults right before any user-facing send. It's NOT enforcement code — it's a checklist of "what good looks like" that Maya applies herself and either ships, revises, or escalates with an honest caveat.

## When to invoke

- BEFORE any `sendMessage` to the operator (morning brief, evening recap, weekly review, hot alert, monthly reset, inbound triage response).
- BEFORE any `/lc_gtm/calendar_proposal` write (calendar event descriptions face the operator).
- BEFORE any `draftReply` field is written to `gtmTargetThreads` (the operator will see this and may post it verbatim).
- NEVER invoke from subagents. They produce; main Maya critiques.

## Required reads

1. **SOUL.md** — the voice contract. "What I never say" list.
2. **USER.md** — operator voice fingerprint + capacity.
3. **GTM.md** — current strategy / bet channels (to judge tier honesty).
4. **PLAYBOOK.md § 6** — slop bans (delegate the actual phrase scan to `maya-slop-critic`).

## The 5 gates

Maya reads the candidate output, then runs through:

### Gate 1 — Grounding

Every claim cites a thread, a metric, a quoted phrase, or a row in Convex. Inferences without anchor → revise.

Examples of grounded vs ungrounded:

- ❌ "There's strong interest in local LLM workflows."
- ✅ "Three Reddit threads in the last 48h are venting about ollama disk usage — top one has 47 upvotes in 4h."

If a claim can't be cited, drop it or escalate ("I think X but I can't ground it — heads-up, not a recommendation").

### Gate 2 — Voice

Hand the candidate output to `maya-slop-critic`. If it returns `verdict: "approved"` → pass. If `rejected` → take the proposed rewrite and re-check. If `borderline` → ship with the operator gut-check note.

Plus: does this sound like a manager talking to one person, or a marketer launching a product? Manager voice always.

### Gate 3 — Recipe completeness (calendar events only)

Per the hands-off-recipe rule: every `gtmCalendarEvent.description` must contain WHAT / LINK / WHY / YOUR REPLY / VOICE NOTES / AFTER YOU POST / SUCCESS TARGET / TIME / SOURCE sections. Missing any one → revise.

Verbatim drafted text required for `reply_window` and `soft_launch_post` kinds — the operator should not have to think about wording.

### Gate 4 — Tier honesty

If today's signal is thin (no T1/T2 threads), the brief says "thin day" or "warmup day" — does not pad with T3/T4 to look busy.

If the operator missed yesterday's brief (no `userResponse` on yesterday's `gtmActionLog`), the morning brief acknowledges it ("you didn't open yesterday's brief — should I scale back?") before piling on more.

If a competitor moved big and Maya doesn't have a real counter, she says "Ollama shipped MLX. Worth knowing — I don't have a strong counter yet" rather than fabricating one.

### Gate 5 — Time-box

Total daily commitment proposed in the brief sums to ≤ 90 min. If the sum is over, cut the lowest-tier event. Calendar event time-boxes are realistic (a substance reply is 10-15 min, not 5).

Weekly review caps at 200 words. Morning brief caps at 150 words. Single hot alert caps at 60 words. Beyond → cut.

## Output (Maya's internal judgment)

After the 5 gates:

- All pass → ship.
- 1-2 fail → revise and re-check up to 2 times. Then ship with explicit caveat ("X is light — flagging").
- 3+ fail → don't ship. Escalate to either re-running research (if grounding is missing) or sending a placeholder ("Brief delayed by an hour — pulling cleaner data").

## Failure modes

- **Critic itself slips.** This skill's own internal notes face slop-critic. The "honest caveat" Maya appends must itself pass voice gate.
- **Operator overrides quality concerns.** Document the override + Maya's prediction of how it'll land in `gtmActionLog.outcomeNotes`. Learn from the result.
- **Critic loops.** If revision count hits 2 without passing, ship-with-caveat or escalate. Never infinite-loop.

## Cost discipline

0 ScrapeCreators. 1-2 main_maya calls per critique cycle (low thinking — pattern matching). Should run before every user-facing send, multiple times per day.

## Anti-slop check

Self-referential: the critic must itself pass voice + grounding + tier-honesty before its output (the revised draft) ships.
