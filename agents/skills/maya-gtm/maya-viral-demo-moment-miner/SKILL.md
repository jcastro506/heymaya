---
name: maya-viral-demo-moment-miner
description: Find showable app moments — before/after contrasts, screenshot sequences. Source: walkthrough + product UI.
---

# maya-viral-demo-moment-miner

## Purpose

TikTok / Reels / native LinkedIn video rewards a specific kind of moment: a UI change a stranger can comprehend in 2 seconds. Cal AI's "point camera at food → calories appear" is the textbook example (tiktok.md § 1). This skill mines the operator's product for those moments.

## When to invoke

- IF `productDiagnosis.showability` is screen-recordable or screenshot-only THEN run.
- IF channel-strategy chose TikTok / Reels / native-LinkedIn-video as primary THEN run.
- IF first demo video underperforms THEN re-run to find a different beat.
- IF a new feature ships THEN re-run.
- NEVER from heartbeat (multimodal walkthrough analysis is expensive).

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 step 1-3 (showability), § 5 Failure Mode 4 (demos must SHOW outcomes, not list features).
3. playbook/tiktok.md § 1, § 2, § 3 (faceless demo anatomy).
4. MEMORY.md.

## Decision rules

1. **The 10-second comprehension rule.** Every demo beat is a UI change a stranger can comprehend in <10 seconds without audio.
2. **Before/after > before-only.** Beats with explicit before→after framing rank higher.
3. **Output-object detection.** If product produces an interesting output standalone (image, video, code, doc), the output IS a demo beat.
4. **Mute-test.** Every beat readable with sound off (~85% of social video watched without sound initially).
5. **Hook moment in frame 1.** No "let me explain" intro. Demo opens with the action.
6. **Safe-zone awareness.** Bottom 250px / right 130px are TikTok UI overlay zones — de-rank beats with key UI there.
7. **3-beat minimum, 7-beat maximum.** Below 3 = nothing to mine; above 7 = over-shopping. Return top 5 by rank.
8. **Anti-feature-list.** "1. opens app, 2. shows dashboard" fails. Beats represent moments of *change* the viewer can react to.
9. **Pre-launch products.** IF `app.stage === "pre-launch"` AND only mockups exist THEN mark beats `mockupOnly: true` — fake-demo TikToks worked for Pushscroll but operator must disclose if asked.
10. **Citation-firewall.** Each beat describes a real observable change. If operator says "the app does X" but walkthrough doesn't show X, do NOT mine X. Mark `unverifiable: true`.

## Output schema

```ts
interface ViralDemoBeatLibrary {
  beats: Array<{
    beatId: string;
    label: string;
    sequence: Array<{ tSec: number; visualState: string; uiChange: string; muteReadable: boolean }>;
    durationSec: number;
    beatType: "before_after" | "demo_cold_open" | "output_reveal" | "pattern_interrupt";
    hookRank: number;
    safeZoneOk: boolean;
    mockupOnly: boolean;
    unverifiable: boolean;
    sourceFrame?: string;
    recommendedHookCatalog: string;
  }>;
  rejectedCandidates: Array<{ candidate: string; reason: string }>;
  overallShowabilityVerdict: "rich" | "thin" | "unshowable";
  rulesCited: string[];
}
```

## Failure modes

- **No walkthrough + thin landing page.** `status: "walkthrough_required"`. Operator intake: "Record one 30-second screen recording of you doing the single thing that makes a user say 'oh'."
- **All candidates fail mute-test.** Product is voice/audio-dependent. Recommend founder-talking-head (tiktok.md rule 8).
- **All candidates are dashboards.** Dashboards-with-numbers don't perform on TikTok. `overallShowabilityVerdict: "thin"`, recommend slideshow Photo Mode.
- **Multimodal extraction worker 409.** Fall back to screenshot-only. Mark `multimodalDegraded: true`. No fabrication.

## Cost discipline

0 ScrapeCreators. 1 extraction_worker pass over walkthrough if available. 1 main_maya synthesis. Timeout 15 min.

## Anti-slop check

`label` and `uiChange` strings go to demo-strategist + format-miner. Run `maya-slop-critic` (banned-phrase scan). Specifically banned: "seamlessly", "magically", "instantly transforms", "effortlessly". Describe literal UI change in operator's vocabulary.
