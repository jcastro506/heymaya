# Lifecycle & Messaging V1 — the agent as I'd want it if it were my hire

Status: LOCKED design target (2026-07-13, operator green-light: "set this up in a
way that we would want it to work for our business").

Companion to `AGENT_REDESIGN_V2.md` (agent shape) and
`PLAN_APPROVAL_LOOP_V1.md` (approval product). This doc owns exactly one layer:
**when the agent speaks and who decides**. The premise, proven live three times
(3x-plan-dupe in June; blackholed synthesis on 7/10; eaten replies + double
plan on 7/13): letting N concurrent LLM sessions each decide "the founder
should hear this" and patching the collisions with dedup guards is
architecture whack-a-mole. When one send path needs four guards
(hello-once, synthesis-claim, 30-min cooldown, class dedup), the path is
designed wrong.

## Principle

**Code owns WHEN. The model owns WHAT.**
Messages to the founder are state-transition side effects in Convex, or
replies threaded to something the founder said. The model composes text; it
never decides, during onboarding, that now is the moment to speak. A state
can only transition once, so a duplicate message becomes IMPOSSIBLE rather
than SUPPRESSED — and the guards get deleted, not maintained.

## The experience contract

### Day 0 — signup to first move (founder sees exactly 4-5 messages)

1. **Hello** (within ~1 min of deploy). One short message: who she is, what
   she's doing right now, honest time window. Sent by CONVEX on the
   `deployed → researching` transition. The agent cannot send it.
2. *(Silence while she works — 15-30 min. The web Thinking tab shows live
   research activity for founders who want to watch. No progress spam.)*
3. **The plan** (once). Research completes → ONE dedicated synthesis turn
   composes the plan and returns it as DATA (cache first, never send) →
   Convex delivers the cached text on the `researching → plan_ready`
   transition. Ends with the two asks: approve + connect.
4. **Kickoff** (once, after approve + ≥1 channel connected). "We're live,
   first move is X, it goes out today." Sent by Convex on the
   `plan_ready → active` transition. The approval-notification turn to the
   agent says ACKNOWLEDGE IN ONE LINE — the plan was already delivered;
   re-pitching is a bug.
5. **First-move receipt** (same day). The one-tap card or the "posted, here's
   the link" — this is the first message the AGENT initiates, and it goes
   through the outbox (below).

### Every day thereafter (steady state, ~2-4 messages/day)

- **7am — morning brief.** The one daily planning message. Commit the 5-8
  warmest live threads; the pulse fills the rolling 15-20/day budget.
- **Through the day — the pulse works silently.** Every ~3h it scans one
  channel. Auto-postable channels: she posts, no message. One-tap channels:
  strikes batch into a SINGLE midday digest unless something is truly hot
  (buying-intent thread <2h old) — that may interrupt once.
- **Replies — always, instantly.** Founder texts → agent turn → reply
  threaded by turnId → NEVER deduped, NEVER cooled down. Ghosting the boss
  is the one unforgivable failure.
- **8pm — evening recap** only if the day had substance (posts/replies/
  results). Honest: flops named as flops. Skip-when-empty.
- **Sunday — weekly review.** Score vs the north star, what converted,
  re-weight channels, next week's plan awaiting one-tap approval.
- **Never:** progress narration, "still working on it", re-articulations of
  prior messages, two messages where one suffices.

## The mechanics

### Onboarding FSM (Convex, `agentLifecycle`)

States already exist (`fresh → researching → plan_ready → active`). Changes:

- Each founder-facing onboarding message is sent by the TRANSITION mutation
  (atomic; stamps `helloSentAt` / `strategyDeliveredAt` / `kickoffSentAt` in
  the same write that flips the state).
- `/lc_gtm/send_update` HARD-REJECTS proactive sends while lifecycle is not
  `active` (returns ok:true + reason so the agent doesn't retry-loop). Replies
  (turnId present) flow in every state.
- The synthesis turn's contract flips from "send_update the plan" to
  "cache_synthesis_plan + mark research complete". Delivery is Convex's job
  (the `pushCachedPlan` path — already built, already idempotent).
- DELETE: `claimFounderSynthesisSend`, `SYNTH_HANDOVER_COOLDOWN_MS`,
  `HELLO_BURST_COOLDOWN_MS` hello-claim logic. The FSM makes them dead code.

### Replies (post-active AND pre-active)

- The inbound envelope (telegramHandoff) MINTS a turnId, includes it in the
  envelope text, and instructs the agent to pass it to send_update.
- send_update with a turnId = reply = always delivered (subject only to the
  leak firewall, which sanitizes rather than blocks on DMs).
- Belt-and-suspenders: even a turnId-less send classified `tactical` is never
  eligible for synthesis dedup (which no longer exists anyway).

### Proactive outbox (post-active)

Every agent-initiated, non-reply message goes through ONE mutation:
`enqueueFounderMessage({ kind, dedupeKey, text })` — e.g.
`("morning_brief", "mb-2026-07-14")`, `("hot_strike", threadId)`,
`("recap", "recap-2026-07-14")`. Unique dedupeKey per kind per window =
idempotent by construction. A per-day budget (default 6) fails additional
proactive sends into the activity feed instead of the founder's phone.

### What the agent can no longer do

- Speak during onboarding (Convex speaks for her, using her words).
- Send the same kind of proactive message twice in its window.
- Exceed the daily proactive budget.
- Be silenced on a reply, ever.

## Non-goals

- No change to research/foundation content, crons' schedules, pulse cadence,
  publish/approval gating, ban-safety, or the plan-approval product.
- No new tables (dedupe keys ride gtmAgents JSON fields / existing tables
  per the 138-table ceiling).
