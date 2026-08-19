# Mission Control, for a UGC agent

**Design, 2026-08-19.** What the dashboard is for now that Maya makes vertical
video for TikTok, Instagram and YouTube.

## The constraint that decides everything

> **"The product is the agent in the messenger. The dashboard is connect +
> receipts, never a workbench."** — CLAUDE.md, principle 1

Work happens in Telegram. Mission Control exists to answer the questions a
founder cannot ask a chat log, and **any screen that invites them to do work is
wrong**. That single rule kills most of what a "content dashboard" would
otherwise grow: no editor, no calendar to drag, no queue to reorder.

## What a paying founder is actually anxious about

Five questions, in the order they ask them. Every screen earns its place by
answering one:

| Question | Answered by |
|---|---|
| Is she working? | **Today** |
| Is the work any good? | **Videos** ← does not exist |
| Is it doing anything? | **Results** |
| Does she need me? | **Today** (drafts, assets) |
| Does she understand my product? | **Rules**, **Brain** |

## The screens

### Today ✅ mostly right
What shipped, what needs a decision, what is next. Already reads v2 for drafts,
channels and activity.

**Still v1:** the calendar, plan approval, the snapshot.

### Videos ⛔ MISSING — and it is the most important screen
A UGC product whose dashboard cannot show you the videos is not a UGC product's
dashboard. Every video she made, newest first:

| Field | Source | Exists? |
|---|---|---|
| the video itself, playable | `mediaAssets.publicUrl` (kind `video`, source `generated`) | ✅ |
| which channels it went to | `placements` by `mediaAssetIdsJson` | ✅ |
| views per channel | `placements.metricsJson` | ✅ |
| the idea it came from | `placements.ideaId` | ✅ |
| the shape it borrowed | `placements.formatCardId` | ✅ |
| **which rung built it** — founder footage / screen recording / screenshots / avatar | — | ❌ |
| **what it cost** in credits | — | ❌ |

⚠️ **The last two do not exist and both matter.** A founder looking at a video
that underperformed needs to know whether it used their real screens or a
generated presenter — that is the single most useful thing about it, and §7.5.3
makes it the product's central claim. Right now nothing records it: `video.ts`
computes `assetNote` and `usesAvatar` onto the BRIEF, and the brief is not kept.

**Fix:** persist the brief's verdict on the placement, or a `videoRenders` row
carrying rung, `usesAvatar`, credits, and the vendor job id. Cheapest is two
optional fields on `placements`.

### Results ✅ shape is right, data is v1
Attribution: which posts produced installs. `attribution.myResults` and
`dashboard.resultsLadder` already exist.

⚠️ Add **cost per result** once credits are recorded. "$0.90 a video, 14 videos,
6 signups" is the sentence that renews a subscription.

### Brain ⛔ WRONG QUESTIONS, not wrong queries
Currently "Intent signal", "Pain, verbatim", "Who she believes is buying" — the
SUPERSEDED intent-hunting design (docs/AGENT_REDESIGN_V2.md). Replace with three
panels, all three queries now written:

- **What she is watching** — `formats.myFormats` (hook line + metrics, never the
  full card: copy the structure, never the content)
- **What she plans to make** — `dashboard.myIdeaBank`
- **What she has to make it with** — `dashboard.myMediaLibrary`, showing the
  LADDER VERDICT rather than a count. "You have 6 assets" is not useful;
  "everything here is generated, so your videos use a presenter" is.

### Rules ✅ v2 already
### Plan ✅ v2 already — the week's shape once `pick-the-week` ships
### Settings 🟡 billing last, after the v2 Stripe path is proven live

### Activity — probably delete
v2's activity IS the placement ledger, which is Today's ticker and the Videos
screen. A separate feed of "what she did" invites exactly the activity theatre
§12 rules out. **Fold into Today; do not migrate.**

## How Maya updates it

**She does not.** Principle 2: *the database is the truth; the model is a
participant.* Maya writes rows — `placements`, `drafts`, `ideas`, `mediaAssets`,
`directives` — and every screen is a live Convex query over them. There is no
push, no dashboard state she maintains, and no way for the screen to disagree
with what actually happened.

⚠️ `dashboardState` exists as a DERIVED cache (`dashboard.refresh`). It must
stay derived. The moment a number lives only there, the dashboard can say
something the rows do not support, which is the failure §16.4 is about.

**Freshness** is therefore whatever the rows say, and metrics carry
`metricsAsOf` so the screen can state when a number was last true rather than
implying it is live.

## Order

1. **Record how a video was made** — two fields; unblocks the Videos screen and
   cost-per-result
2. **Videos screen** — the missing one, and the reason a founder opens this at all
3. **Brain rebuild** — three panels, all queries ready
4. **Today's remaining v1** — calendar, plan approval, snapshot
5. **Results** — swap, then add cost
6. **Delete Activity**, fold into Today
7. **Settings/billing** — last
