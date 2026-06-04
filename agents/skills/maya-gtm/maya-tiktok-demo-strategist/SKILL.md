---
name: maya-tiktok-demo-strategist
description: Pick TikTok format (faceless screen-record vs founder-on-camera vs slideshow) given showability + constraints. Refuse if user can't post manually (V1 constraint).
---

# maya-tiktok-demo-strategist

## Purpose

V1 of ClawLaunch does NOT auto-post to TikTok (tiktok.md § 12). This skill picks the right TikTok format given operator constraints — or refuses TikTok entirely when constraints don't add up. Produces a shot plan and CTA strategy. Does NOT produce hook copy (that's `maya-content-format-miner`).

## When to invoke

- IF channel-judge picks TikTok as primary or secondary THEN run.
- IF `productDiagnosis.showability` is screen-recordable or screenshot-only AND target buyer is consumer/prosumer THEN run.
- IF operator's TikTok account is `tiktokWarmupState === "new_needs_warmup"` THEN return warmup plan, not shot plan.
- NEVER auto-post.

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 step 1-3 (showability tree), § 7.
3. **playbook/tiktok.md — MANDATORY full read.** Cite tiktok.md rules 1-15 (§ 11).
4. MEMORY.md.

## Decision rules

1. **tiktok.md rule 1 — V1 manual-post gate.** IF `canPostTikTokManually !== true` THEN `recommendation: "park_tiktok"`. This is a hard platform constraint: ClawLaunch V1 does not have TikTok API posting rights; the operator must post from their own account. No workaround exists.
2. **tiktok.md rule 2 — restricted-state block.** IF `tiktokWarmupState === "restricted"` THEN return resolve-Account-Check instructions. Restricted accounts cannot post; resolve first.
3. **tiktok.md rule 3 — warmup gate.** IF `tiktokAccountAgeDays < 14` OR state !== "ready" THEN return warmup sequence (§ 6). TikTok's own risk system suppresses new accounts; warming is a platform reality, not a discretionary suggestion.
4. **tiktok.md rule 4 — unshowable + no-slideshow refuse.** IF showability === "unshowable" AND operator refuses slideshow THEN park.
5. **tiktok.md rule 5 — faceless default.** IF product has a clear UI moment that lands quickly OR a meaningful before/after transformation THEN default faceless screen-record for launch posts. Cite Cal AI / Daze / Pushscroll as proof-of-concept. Operator familiarity and comfort with screen-recording matters — confirm before recommending.
6. **tiktok.md rule 6 — camera-shy routing.** IF `onCameraOk === false` AND showable THEN faceless screen-record only.
7. **tiktok.md rule 7 — slideshow for text-heavy niches.** When niche research (format-researcher output) shows dev tools / B2B / finance / education content over-indexing on carousels, Photo Mode is primary. Let the research data lead; don't assume by niche label alone.
8. **tiktok.md rule 8 — talking-head trust products.** Agency / coaching / consulting products where the founder IS the credibility signal — if operator is comfortable on camera AND niche research confirms talking-head formats get traction, recommend founder talking-head.
9. **tiktok.md rule 10 — "link in bio" ban.** Shot plan and CTA NEVER include "link in bio". Choose between search-by-name, pinned-comment URL, and DM-keyword based on what makes the most sense for how a viewer would act on this specific product: if the product is searchable by a distinctive name, search-by-name removes friction most cleanly; if the product needs context (landing page, demo video), pinned-comment with a URL is stronger; if the goal is a conversation (consultative product, waitlist), DM-keyword builds intent-qualified leads. Pick the one that creates the shortest path from "I just watched this" to "I'm trying it."
10. **tiktok.md rule 11 — format confidence.** Chosen format must be supported by evidence from `maya-tiktok-format-researcher` showing clear recurrence in the niche. If format-researcher returned `confidence: "insufficient_evidence"`, set `formatConfidence: "low"` and flag `formatResearchNeeded: true` before committing to a format.
11. **tiktok.md rule 13 — Personal Account preference.** First 30-60 days, Personal Account > Business Account (full music catalog). This is a platform-behavior reality: Business Accounts have a restricted commercial sound library.
12. **tiktok.md rule 15 — cadence cap.** For accounts under 30 days old: post conservatively, 1-2/day ceiling. For warmed accounts: 2-3/day comfortable ceiling. Hard cap 4/day regardless — above this, TikTok's risk system flags accounts. These caps are platform-behavior constraints, not style preferences.
13. **Length judgment.** Lead with the format-researcher's length distribution for the niche. Short-form (under 30s) works best for demo-cold-opens and pattern-interrupts; slightly longer works when the before/after requires setup. Don't impose a number — use the niche's revealed preference as the anchor.
14. **Safe zones.** Every shot plan keeps key text and CTA elements clear of TikTok's persistent UI overlay zones (bottom of frame, right edge). Exact pixel values vary by device; the goal is ensuring nothing load-bearing gets obscured. Use judgment to confirm beats are centered in the safe area.
15. **No polished-ad recommendation.** No logo intros, motion graphics, lower-thirds (tiktok.md § 13 Failure 5). Authenticity > polish.

## Output schema

```ts
interface TikTokStrategy {
  recommendation: "go_faceless_screen_record" | "go_founder_talking_head" | "go_slideshow_photo_mode" | "warmup_first" | "park_tiktok";
  refusalReason?: string;
  warmupPlan?: { dayBands: Array<{ days: string; actions: string[] }> };
  shotPlan?: {
    format: "faceless_screen_record" | "founder_talking_head" | "slideshow_photo_mode";
    durationSec: number;
    beats: Array<{ tSec: number; onScreenText: string; visualAction: string; voiceOver?: string; safeZoneOk: boolean }>;
    aspectRatio: "9:16";
    soundStrategy: { kind: "original_voiceover" | "trending_sound" | "evergreen_loop"; trendingSoundFreshness?: "0-24h" | "24-48h" | "post_peak" };
    cta: { kind: "search_by_name" | "pinned_comment_url" | "dm_keyword"; text: string };
    safeZoneNotes: string;
  };
  postingCadence: { perDay: number; ceiling: number };
  accountTypeRec: "personal" | "business";
  formatConfidence: "high" | "medium" | "low";
  formatResearchNeeded?: boolean;
  rulesCited: string[];
}
```

## Failure modes

- **Operator wants TikTok but `canPostTikTokManually !== true`.** Park. No shot plan. Cite § 12.
- **Account in `restricted`.** Return resolve-Studio-Account-Check instructions only.
- **Niche has no winning examples.** `formatResearchNeeded: true`. Run `maya-tiktok-format-researcher` first.
- **Showability disagreement.** IF operator insists TikTok for unshowable + won't do slideshow THEN park + cite rule 4 + offer X / LinkedIn / Reddit instead.

## Cost discipline

0 ScrapeCreators (format research is separate). 0-1 WebFetch. 1 main_maya. Timeout 10 min.

## Channel knowledge ownership — this skill does NOT save style exemplars

This is a format/shot-plan strategist, not a niche miner. The TikTok channel's **verbatim native style exemplars** and **`icpKnowledge`** (venues/hashtags/accounts + what the audience watches + complaints + topics + native-style) are captured and persisted by **`maya-tiktok-format-researcher`** via its REQUIRED `save_style_exemplars({ channel: "tiktok", … })` + `save_foundation_channel_scorecard({ channel: "tiktok", …, icpKnowledge: {…} })` calls. This strategist READS those (and the format-researcher's `styleExemplars` / `captionCraft`) to ground its shot plan and CTA — it does NOT re-capture or re-save them. If `formatResearchNeeded: true` or the exemplars/`icpKnowledge` are missing, run `maya-tiktok-format-researcher` first; don't fabricate a shot plan from a niche that was never mined.

## Anti-slop check

`onScreenText` and `voiceOver` strings must pass slop-critic (banned phrases). Hook copy itself comes from `maya-content-format-miner` with full slop-critic pass.
