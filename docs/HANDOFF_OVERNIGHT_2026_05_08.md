# Overnight handoff — 2026-05-08

10 commits landed on `staging` between ~00:25 and ~01:10 ET. All green: 3534/3534 tests, 0 tsc errors, 17/17 lc_maya endpoint smoke against live Convex.

## What landed

Most-recent first:

| SHA | Subject | Why |
|---|---|---|
| `70d06bd` | dev_tunnel.sh: ngrok bootstrap for iMessage OAuth | #24 — gives operator a one-command path to publish localhost:3000 for tap-on-phone OAuth |
| `d8d76c3` | Apollo + Hunter Convex action wrappers (feature-flagged) | Wraps clients in internalActions; gates on env-key presence; no live calls until operator provisions accounts |
| `5dbccab` | AGENTS.md outreach-cap rule (every-session voice ceiling) | Encodes the 5/10/30/7 cap discipline + verbalization pattern at the agent voice layer (every session) |
| `e582827` | inbox warm-mining action layer (Layer 4 runtime) | `sweepCreatorInbox` action + `upsertBrandContact` mutation. Idempotent dedupe |
| `27c413e` | #20 — memory architecture design doc | Locks v0 model: memory-wiki + Convex mirror; defer vector DB. 7 canonical wiki topics |
| `f8a00d3` | #23 — feature_discovery cron design doc | Sunday 3pm cron, signal-conditional, anti-niche, 3-beat voice template, never feature dropdown |
| `37b2ddc` | brand outreach scaffold (Layer 4 + caps + Apollo/Hunter stubs) | Schema (`brandContacts` + `pitchOutreach` extensions), pure-fn cap helper (15 tests), warmMining heuristic (27 tests), Apollo + Hunter clients (19 tests) |
| `50c461b` | #29 — extend Coach → Assistant rename to skill MDs + bundle | Continuation of `3585cb8`; sweep through 14 SKILL.md files + cron.md + playbook.md |
| `3585cb8` | #29 — Coach → Assistant rename (user-visible only) | Internal Plan enum stays `"coach"` for back-compat; only labels rename |
| `2f6d279` | Skills audit (Sprint 11) — first-person SOP voice across 22 skills | Operator-locked rubric: human-SM-manager voice, concrete thresholds, hand-offs by slug, anti-bot voice |
| `5d05279` | #26 — evening_recap signal-conditional, not clock-conditional | 6pm scan, send only if a real signal hit, hard 8pm cutoff, banned corporate phrasings |
| `6372fec` | _admin: peek state helpers | fullDump, peekVideoUrls, recentActions for ad-hoc debug |

## Tests landed by category

- 61 new tests on the brand-outreach scaffold (caps + warmMining heuristic + Apollo + Hunter clients + projection helpers)
- 3 new tests on warmMining mutation surface
- 5 minor test updates for the Coach→Assistant rename + 48K bootstrap cap bump
- Total suite: 3457 → 3534 (+77 tests)

## Operator action items (you, when you wake up)

1. **Live re-onboard from iMessage** — task #5 still in-progress. claw-messenger is topped up; everything below it is stable. The first re-onboard since the Kevin-removal commit (`034c678`) will validate the prompt holds across creators. **Recommended order: do this BEFORE any other implementation work today** — it locks the baseline.
2. **Apple Calendar end-to-end** — task #28. Plumbing's wired since Sprint 9.8. Needs your real iCloud + app-specific password. Operator-only because creds.
3. **Apollo decision** — when you get the $99/mo Apollo Pro key, paste it into `.env.local` as `APOLLO_API_KEY`. Same for `HUNTER_API_KEY` ($49/mo Starter). Action wrappers gate on env presence — no code changes needed once keys land.
4. **Live ngrok session** — `bash scripts/dev_tunnel.sh` (or with `--domain=` if you upgrade ngrok). Only needed when you want to test iMessage tap-on-phone OAuth.
5. **Open questions queued for you**:
   - Memory architecture (3 questions in `docs/sprint11_memory_architecture.md` § 7)
   - Feature-discovery cron (7 questions in `docs/sprint11_feature_discovery_design.md` § 7)
   - Stripe product rename (rename agent flagged: `productName: "HeyMaya Coach"` + lookup keys + env var names — operationally tied to seeded products. Recommendation: rename the user-facing `productName` only, keep lookup keys + env vars. Not done; needs your call.)

## What I deferred / why

- **Feature-discovery + memory architecture implementation** — both have full design docs. Not built tonight because the design has open questions that need your call. Implementation next sprint, once you answer.
- **Apollo/Hunter live-call integration** — schema + clients + actions all in place. Live testing blocked on keys. As soon as keys land, the brand-outreach skill can call `searchPeopleAtBrands` / `findEmailByName` and start enriching cold targets.
- **Marketplace scout (Layer 3 — Aspire/Tribe/Influence.co)** — deferred per design. Validate Layer 4 (inbox warm) reply rates before investing in scrapers.
- **Web UI post-signup redirect (#25)** — locked direction (drop into UI after signup, Maya texts first, web is archive view) but not implemented. Creator product is currently suppressed behind `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT=false`, so this work is deferred until the flag flips back on.

## Things that surprised me

- **Concurrent agent edits**: 4 of the 6 agents I spun up reported a "linter or filesystem watcher reverting in-flight edits." This was actually other parallel agents stomping each other on shared infrastructure (`generateAgentsMd.ts`, `standingOrders.ts`, `skillsRegistry.ts`). I ran the bundle sync script several times to converge. Nothing was lost — final state is consistent across all 22 audited skills + the rename + the evening_recap rewrite. But: spinning multiple agents on a shared bundle is racy. Next time I'd serialize agents that touch the same files.
- **Production cluster agent's "linter reverted my work" report**: 4 of their 5 rewrites (voice-applier, clip-editor, thumbnail-maker, caption-generator) appear to have been hallucinated reverts — git history shows they were never written, not reverted. Their cross-poster + transcribe verdicts are real. The 4 "kept" skills should be considered un-audited. Worth a follow-up audit pass on those four specifically.
- **Bootstrap cap bump 44K → 48K**: needed to fit the rewritten signal-conditional `evening_recap` scope (~1500 chars vs 200 prior) + the rename agent's tier-label updates across standing orders. Cost on Gemini 1M context is trivial (~$0.0005/session); the cap is a guardrail against accidental bloat, not a cost concern.

## How to validate when you wake up

```bash
git log --oneline staging | head -12          # see what landed
npx vitest run                                  # 3534/3534 expected
npx tsc --noEmit                                # 0 errors expected
SECRET=cfe08bae87db7b7de5972b62a739619620541e60d2a97417eedccde88d127576 \
CREATOR=jn7ctravwzbcg41y44twb4jv398685fv \
bash scripts/lc_maya_smoke.sh                   # 17/17 expected
```

If any of those don't match, don't proceed with the live re-onboard until we figure out what changed.

## Non-blocking

- `services/video-synth-worker/dist/` and `node_modules/` show up as untracked. Both are build artifacts; should add to `.gitignore` if not already (low priority, no impact on tests/deploy).
