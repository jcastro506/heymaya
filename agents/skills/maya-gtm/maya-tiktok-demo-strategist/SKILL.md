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

1. **tiktok.md rule 1 — V1 manual-post gate.** IF `canPostTikTokManually !== true` THEN `recommendation: "park_tiktok"`.
2. **tiktok.md rule 2 — restricted-state block.** IF `tiktokWarmupState === "restricted"` THEN return resolve-Account-Check instructions.
3. **tiktok.md rule 3 — warmup gate.** IF `tiktokAccountAgeDays < 14` OR state !== "ready" THEN return warmup sequence (§ 6).
4. **tiktok.md rule 4 — unshowable + no-slideshow refuse.** IF showability === "unshowable" AND operator refuses slideshow THEN park.
5. **tiktok.md rule 5 — faceless default.** IF product has clear UI moment ≤10s OR before/after THEN default faceless screen-record for first 10 launch posts. Cite Cal AI / Daze / Pushscroll.
6. **tiktok.md rule 6 — camera-shy routing.** IF `onCameraOk === false` AND showable THEN faceless screen-record only.
7. **tiktok.md rule 7 — slideshow for text-heavy niches.** Dev tools / B2B / finance / education niches over-indexing on carousels → Photo Mode primary.
8. **tiktok.md rule 8 — talking-head trust products.** Agency / coaching / consulting AND operator comfortable on camera → founder talking-head.
9. **tiktok.md rule 10 — "link in bio" ban.** Shot plan and CTA NEVER include "link in bio". Substitute search-by-name / pinned-comment / DM-keyword.
10. **tiktok.md rule 11 — 5-video format rule.** Chosen format must have ≥5 winning examples in operator's niche (verified by `maya-tiktok-format-researcher`). If <5, `formatConfidence: "low"`.
11. **tiktok.md rule 13 — Personal Account preference.** First 30-60 days, Personal Account > Business Account (full music catalog).
12. **tiktok.md rule 15 — cadence cap.** 1-2/day for <30d accounts, 2-3/day for warmed. Never >4/day.
13. **Length sweet spot.** 22-28 seconds for first 10 hero posts. Carousel default 6 slides.
14. **Safe zones.** Every shot plan places text/CTA inside central safe zone (≥150px top, ≥250px bottom, ≥130px right).
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

## Anti-slop check

`onScreenText` and `voiceOver` strings must pass slop-critic (banned phrases). Hook copy itself comes from `maya-content-format-miner` with full slop-critic pass.
