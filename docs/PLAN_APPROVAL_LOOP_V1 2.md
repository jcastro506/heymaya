# PLAN_APPROVAL_LOOP_V1 — the hire → pitch → audition arc

Locked 2026-07-06 with the operator. This is the product spec for how Maya wins
trust and operates day to day. It subsumes the deferred "first message rewrite"
and the calendar-pointer fix. Prior art: `AGENT_REDESIGN_V2.md` (engine,
ban-safety, lifecycle) — this doc governs the *founder-facing loop* on top.

## 0. The mental model

The product must feel like **hiring a sharp growth person**, and a good hire
follows a script everyone recognizes: study quietly → pitch a plan → win trust
on a small first assignment → earn longer leashes → become ambient. Three
engineered trust moments carry the whole arc:

| Moment | When | What must happen |
|---|---|---|
| 1. "She gets it" | minute 1 | Hello proves she read THE product, promises nothing posts without approval, asks nothing |
| 2. The pitch | ~20 min | A plan she can argue with, amend, and approve |
| 3. The audition | day 1–2 | First 3 public actions confirm-each with reasoning; "we're live" link ping |

After moment 3, attention SHOULD drop off — ambient is success.

## 1. The hello (moment 1)

Sent seconds after pairing, before research completes. Shape (not verbatim —
her voice per SOUL.md, including the hard punctuation rules):

1. One line of identity.
2. One line proving she read the product — specific, from the app inspection
   ("the {differentiator} angle is real, most tools in this space don't do it").
3. The contract: "I'm mapping your market now. Give me about 20 minutes.
   Nothing ever posts without your OK."

Zero questions. Zero links. The founder can put the phone down.

## 2. The plan (moment 2) — a document, not a text blob

### 2.1 Structure (stored as `planDocJson` on `gtmAgents` — schema ceiling: JSON-on-row)

```jsonc
{
  "version": 2,
  "status": "proposed" | "approved",
  "approvedAt": 1234,
  "read": "what I understand your product to be (1-2 sentences)",
  "goal": { "metric": "signups", "target": 25, "byMs": 1234 },
  "moves": [ /* §3 — 2-4 moves; the plan IS the moves */ ],
  "notDoing": [ { "channel": "tiktok", "why": "your buyers debate tools in text, not video" } ],
  "week": { "postsPerWeek": 3, "repliesPerDay": "10-20", "tone": "helpful peer, never salesy" },
  "asks": [ "approve", "connect reddit + x" ],
  "amendments": [ { "v": 2, "directive": "focus linkedin", "diff": "linkedin promoted to bet #1", "atMs": 1234 } ]
}
```

### 2.2 Delivery + back-and-forth

- Telegram: the pitch as a tight message — read, bets + why, NOT-doing + why,
  the week, ONE ask ("reply with changes, or say go"). Every claim cites a real
  thread she found. The "not doing" section is mandatory — reasoned omission is
  what separates a plan from generated output.
- Web: while `lifecycleState = plan_ready`, Mission Control shows the plan as
  an approval screen (Brain tab takeover): sections rendered, Approve button,
  "discuss in Telegram" pointer.
- Founder replies in plain language → steering directive → she amends the plan,
  bumps `version`, appends to `amendments[]`, and re-presents THE DIFF only
  ("Updated: LinkedIn is now bet #1, tone dialed down. Anything else, or go?").
- Approve (web button or "go" in chat) → `setStrategyApproval` → with ≥1
  account connected → `active`. The plan is now her constitution: every action
  justifiable against it, every future steering message a visible amendment.

## 3. Moves — the unit of work (replaces post/thread-level thinking)

A **move** is what a human SMM plans in: intent + channel + duration + budget +
expected outcome. Actions (replies, posts, strikes) are executions of a move.
Surface the existing `gtmDistributionMotions` table; plan carries 2–4.

```jsonc
{ "id": "camp-r-saas", "name": "Camp r/SaaS", "channel": "reddit",
  "intent": "own every distribution question with our angle",
  "budget": { "postsPerWeek": 1, "repliesPerDay": "3-5", "strikes": "all Tier-1" },
  "expect": "profile clicks -> signups, not karma", "horizon": "2 weeks" }
```

All reporting re-keys to moves: morning message names the moves being worked;
Queue groups drafts by move; weekly review scores moves ("r/SaaS move: 9
conversations, 11 clicks, 2 signups — doubling down. X move: crickets —
replacing with …"). Volume gets a REASON attached.

## 4. The day — activity budgets (what the founder consents to in the plan)

Per warm channel, 2–3 bet channels active. Ceilings are ban-safety hard rules;
everything inside them is her judgment (which threads, which lane, when).

| Lane | Volume/day | Autonomy |
|---|---|---|
| Tier-1 buying-intent strikes | 2–5 total (rare, freshness-ranked) | auto on X/Reddit/HN; one-tap elsewhere |
| Tier-2 warm engagement | 5–10 | same split |
| Tier-3 presence/warming | 5–10 (higher during warmup) | auto where API allows |
| Original posts | ≤1 per bet channel | per posting mode |
| Own-post replies | demand-driven, ≤2h latency | fully auto (Zernio inbox) |

≈ 15–30 public actions/day, human-shaped: spread with jitter across waking
hours, 9:1 value:promo, per-community caps (≤2 comments/subreddit/day). Fresh
accounts run the warmup arc first (week 1 ≈ Tier-3 only, low volume).

### 4.1 The one-tap strike digest (LinkedIn / IG / TikTok cold comments)

No API path exists for anyone. ONE batched digest per day at a fixed time:
each card = target post + pre-written comment + deep link (text on clipboard).
Framing: "your tap is what keeps your account un-bannable." 5–10 cards ≈ 3
minutes. Never drip-fed. (Thread deep-links + confirm cards already exist;
the batched ritual is the build.)

## 5. The audition (moment 3)

- First **3 public actions** are confirm-each REGARDLESS of posting mode.
  Card = thread + draft + rationale (§6).
- When the first goes live: ping with the actual URL ("we're live — here's
  your comment"). This is the churn-or-relax moment; treat it as a feature.
- Implementation: publicActionCount on the agent row (JSON), prompt rule +
  server-side check in the publish path.

## 6. Rationale on every action

`gtmDraftedContent.rationale` (string, set at save_draft): why this thread,
why this angle, expected outcome — e.g. "r/SaaS, founder asking exactly what
we solve, 2h old (fresh). Plan: reddit is bet #1. Expect profile clicks."
Rendered on Queue cards and in the Thinking stream. Prompt discipline: a draft
without a rationale is an incomplete save.

## 7. Autonomy graduation (earned, not toggled)

Track approval streak. After ~10 approvals with ≤1 edit, SHE proposes:
"You've approved 11 of 12 untouched. Want me to stop asking on replies and
only check with you on posts?" Founder's yes flips posting mode. Autonomy is
a promotion the founder grants — a celebrated moment, not a setting.

## 8. The communication contract

- **Cadence (fixed):** morning 3-liner (moves being worked + any taps) →
  silent execution (web fills live) → ≤1 event ping/day (signup, hot thread,
  audition item) → recap only if something happened → weekly review.
- **Every message ends with "nothing needed from you" or EXACTLY ONE ask.**
- **Outcome language only:** clicks/signups, never impressions/likes. Weekly
  review in cost-per-outcome terms, with the honesty rule: a failing move is
  named and replaced ("this isn't working, here's the change").
- **Every claim has a receipt** (thread URL / attribution row, one tap away).
- **Surface naming:** the founder's surfaces are Telegram + the dashboard tabs
  (Today, Thinking, Queue, Brain, Results). There is no calendar. Pointers
  always use the real tab name + the dashboard link. (Shipped in generators
  2026-07-06.)
- **Voice hard rules:** no em/en dashes, semicolons, colon-led constructions,
  scare quotes, "not X but Y" framing, rule-of-three flourishes, or the banned
  lexicon — in ALL output, public and DM. (Shipped in SOUL.md + slop-critic
  2026-07-06.)

## 9. Build order

1. **Plan-as-object + approval screen + amendments** (the spine).
2. **Audition ritual** (counter + confirm-each + live-link ping).
3. **Moves layer** (surface gtmDistributionMotions; re-key reporting + Queue).
4. **Rationale field + rendering.**
5. **Autonomy graduation.**
6. **Weekly review in cost-per-outcome + honesty rule.**
7. **Strike digest ritual** (batched one-tap).

Each independently shippable to staging dogfood. Prompt-pack pieces of §8 are
already live (voice rules, surface naming); the message SHAPES land with #1.

## 10. What we deliberately do NOT build

More dashboards, more settings, more notification types, per-action approval
queues beyond the audition. Every improvement is her behaving more like a
great hire, not the app doing more.
