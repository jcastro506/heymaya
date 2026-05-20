# Handoff — Sprint 12.6 integrated-read overhaul + nuclear wipe

**Status:** clean slate, awaiting macOS TCC restore before re-onboard.
**Branch:** `staging` (commits below pushed to origin).
**Date written:** 2026-05-10 evening → 2026-05-11.

## What shipped this session

Three commits on top of `38208b1` (Sprint 12.5):

| Commit    | Title                                                       |
|-----------|-------------------------------------------------------------|
| `95960d9` | Sprint 12.6: integrated-read overhaul                       |
| `278aa82` | Sprint 12.6.1: silent aborts + timezone discipline          |
| `7affa28` | Sprint 12.6.2: wipeEntireDatabase + wipeEverythingNuclear   |

3593/3593 tests passing, tsc clean.

## Sprint 12.6 — Maya thinks like a human, not a tag-matcher

**The bug:** Sunday 4pm `weekly_content_plan` grounded all 3 ideas in observed-only material (London setting / Piccadilly clip / "lucky they are" line from a London POV) while the creator's stated lane was observational humor / NYC. Maya pattern-matched recency tags into "this is the niche."

**The fix:** structural, not procedural. Maya now reads USER.md / AGENTS.md the way a human manager would — stated and observed as different things.

### `generateUserMd.ts` — section restructure

| Old section | New section |
|---|---|
| `## Niche & audience` (stated niche slammed against observed audience tags) | `## Stated lane (their words)` — niche-in-own-words + 3-month goal + anti-niches anchor at top |
| `## What I observed watching your videos` | `## What their content actually looks like (last 30 posts)` — explicit header note: this is what the watched window CONTAINED, not the niche |
| _(merged with above)_ | `## Audience demographics` — note that demographics ≠ creator lane |
| _(none)_ | `## Divergence flag (stated vs observed)` — renders when `needsVerification[]` has entries |
| _(appended to bottom)_ | `## How I ground recommendations` — 5-point pre-check |

### `generateAgentsMd.ts` — new top-section rules

Added under "ONE manager reading an integrated picture":

1. **Stated lane = grounding floor. Observed signal = recency, not intent.**
2. **Format ≠ setting ≠ niche.** Reason at format layer (handheld POV / walking monologue / kitchen-counter explainer).
3. **Every proactive surface runs the same pre-check.**
4. **Calendar + cadence ground every plan.**
5. **Divergence-flag handling.** Ask the alignment question; observed-only material off-limits as new-idea grounding until gap closes.

Old Kevin-specific niche-divergence rule (London / Piccadilly / gym-fitness examples) stripped down to a short pointer to the top-section rule.

### `standingOrders.ts` — READ-FIRST pre-check across 7 proactive orders

Pre-check prepended to scope of: `weekly_content_plan`, `morning_brief`, `evening_recap`, `trend_watcher`, `daily_niche_scan`, `hook_library_build`, `opportunity_scout_daily`.

### Bootstrap cap bumps

- `MAYA_BOOTSTRAP_MAX_CHARS`: 66K → **80K** (production)
- `DEFAULT_BOOTSTRAP_MAX_CHARS`: 36K → 42K (non-embedded path)
- `assembleWorkspaceBundle` CAP test: 40K → 45K

Cost on Gemini 1M context is trivial.

## Sprint 12.6.1 — Silent aborts + timezone discipline

**Two bugs in one live message at 22:00 UTC:**

> "The current time is 10:00 PM (22:00 UTC). Per the instruction 'Never send after 8pm local — if the tick lands ≥20:00, abort,' I am aborting this run. No signals were scanned and no message will be sent."

### Bug 1 — UTC vs local cutoff conflation

Cron tick at 22:00 UTC = 18:00 ET (6pm local), well before 20:00 cutoff. Maya never converted to `creators.timezone` before comparing.

**Fix — new top-section AGENTS rule:** Every hour-of-day rule refers to LOCAL time in `creators.timezone` (surfaced in USER.md § Who they are). Worked example baked in:

- Tool returns `2026-05-10T22:00:00Z`
- Creator tz = `America/New_York` (UTC-4 in DST)
- Local hour = 18, not 22
- The 8pm cutoff is 20:00 LOCAL; 18:00 LOCAL is well before it
- Never write "the current time is 22:00 UTC, that's past the 8pm cutoff" — that's the bug

Default tz when missing = `America/New_York` AND flag as USER.md question.

### Bug 2 — Maya announced the abort

Internal cron/cutoff reasoning leaked to creator. Existing rules ("Sends go to the creator verbatim", "NEVER prefix with planning") didn't reach her at cron-evaluation moment.

**Fix — new top-section AGENTS rule:** Abort paths produce ZERO outbound messages. Banned phrases: "Per the instruction", "I am aborting", "No message will be sent", "No signals were scanned", "The current time is X UTC", "The tick lands at". Rule covers cutoff aborts, no-signal scans, citation-firewall fails, tool 5xx caught+retried, picture-not-ready ticks.

evening_recap scope rewritten with both rules at the top before the signal-conditional logic.

## Sprint 12.6.2 — Nuclear wipe admin actions

Added to `convex/_admin/realWorldDeploy.ts`:

- **`wipeTableBatch`** (internalMutation) — deletes up to N rows from one table per call. BATCH_SIZE=25 keeps each mutation under Convex's 16MB-per-execution read limit (scrapeCreatorsCache rows are 100KB+ each).
- **`wipeEntireDatabase`** (internalAction) — loops every table in a hand-curated `ALL_TABLES` list, calls wipeTableBatch until hasMore=false.
- **`wipeEverythingNuclear`** (internalAction) — chains `wipeEverything` (creator-cascade + Fly destroy) then `wipeEntireDatabase` (every-table sweep).

`ALL_TABLES` is hand-curated (~67 tables enumerated from `convex/schema.ts`). **New tables added to schema MUST be appended here or they'll be skipped on the nuclear path.**

## Current deployment state

**Convex (`dev:vibrant-platypus-264`):** every table at 0 rows. `wipeEverythingNuclear` output: 118 orphan scrapeCreatorsCache rows wiped, every other table already at 0.

**Fly:** zero `maya-*` apps. Only base infra (`heymaya-openclaw` suspended, `heymaya-video-synth` suspended).

**Staging branch:** 3 commits ahead of Sprint 12.5 PR #6. Tests: 3593/3593. tsc: clean.

## Blocker — macOS TCC lockout (recurring)

At session-end (~21:50 ET 2026-05-10), macOS revoked Terminal's Desktop folder access mid-session. Same lockout as the 2026-05-07 morning incident.

Symptoms:

- `EPERM: operation not permitted, uv_cwd` on every `npx convex` call
- `sed` / `cat` / `head` fail with "Operation not permitted" on files under `/Users/joshcastro/Desktop/heymaya/**`
- Shell cwd auto-resets to `/Users/joshcastro` after every command
- `ls` (directory listing) works; file-content reads fail
- Read tool fails with EPERM; Write tool can write to new file names in Desktop but cannot overwrite existing files (because it requires a prior Read)

**Operator action to resume:** System Settings → Privacy & Security → Files & Folders → grant Desktop access to Terminal (or iTerm / Warp / whatever shell host Claude Code runs under). If already enabled, toggle off + on. Restart the host.

## Resume path — re-onboard Kevin (test creator)

Operator's intent before TCC lockout:

> "Ok lets you onboard me again with the number 16313357603 And Kevin.castro9996 as Tik tok account"

The `_admin/realWorldDeploy:run` action has these defaults baked in, matching the operator's request exactly:

| Constant | Value |
|---|---|
| TEST_CLERK_USER_ID_PREFIX | `test_real_world_kevin_` |
| TEST_HANDLE | `Kevin.Castro9996` |
| TEST_PHONE | `+16313357603` |
| TEST_NAME | `Kevin Castro` |
| TEST_TIMEZONE | `America/New_York` |

After TCC restore, the resume command is:

```bash
cd /Users/joshcastro/Desktop/heymaya
npx convex run _admin/realWorldDeploy:run '{}'
```

This seeds the creator row → persists onboarding answers → triggers `deployMaya` → fresh `maya-*` Fly app boots with the new integrated-read workspace. First Maya text lands on iMessage.

## What to look for on the live re-onboard

This is the first live test of:

1. **Integrated-read picture** — does Maya's first message stay in stated lane vs leaking observed-only signal?
2. **Timezone discipline** — when evening_recap fires at 22:00 UTC tomorrow, does she correctly read 18:00 local and proceed (not abort)?
3. **Silent aborts** — if she DOES need to abort for any reason, does she stay silent? No "Per the instruction…" leaks.
4. **Format ≠ setting ≠ niche** — when ideas surface in `weekly_content_plan`, do they ground at format layer or leak to setting?

## Pending tasks (carry-forward)

- #5 Operator re-onboards from real iMessage — blocked on TCC restore
- #25 Decide when to give creators the web UI (Plan / Performance / Today screens)
- #28 Test Apple Calendar (CalDAV) end-to-end with real iCloud account (code preserved, NOT offered in chat per Sprint 12.1)
- #36 Live iMessage smoke baseline — verify 034c678 holds before more changes

## File-touch reference

Files changed across the three Sprint 12.6.x commits:

- `convex/agents/packs/maya/workspace/generateUserMd.ts` — Stated lane / Divergence / Audience renames + new renderers
- `convex/agents/packs/maya/workspace/generateAgentsMd.ts` — 5 integrated-read rules + tz-discipline + silent-abort rules
- `convex/agents/packs/maya/workspace/standingOrders.ts` — pre-checks across 7 proactive orders; evening_recap rewrite
- `convex/agents/packs/maya/configGeneratorMaya.ts` — MAYA_BOOTSTRAP_MAX_CHARS 66K → 80K
- `convex/agents/packs/maya/workspace/__tests__/generateUserMd.test.ts` — header rename assertions
- `convex/agents/packs/maya/workspace/__tests__/assembleWorkspaceBundle.test.ts` — CAP 40K → 45K, PROD_CAP 66K → 80K
- `convex/agents/packs/maya/__tests__/configGeneratorMaya.test.ts` — 66K → 80K assertion
- `convex/agents/packs/maya/__tests__/openclaw423Migration.test.ts` — 66K → 80K assertion
- `convex/_admin/realWorldDeploy.ts` — wipeTableBatch / wipeEntireDatabase / wipeEverythingNuclear

**Loose end:** `app/page.tsx` shows uncommitted local-only stub (re-exports CreatorLanding). NOT touched by me, left unstaged. Operator decision whether to keep.
