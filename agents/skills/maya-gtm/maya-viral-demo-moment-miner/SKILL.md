---
name: maya-viral-demo-moment-miner
description: Find showable app moments — before/after contrasts, screenshot sequences. Source: walkthrough + product UI.
---

# maya-viral-demo-moment-miner

## Purpose

TikTok / Reels / native LinkedIn video rewards a specific kind of moment: a UI change a stranger can comprehend almost immediately, without context, without audio. Cal AI's "point camera at food → calories appear" is the textbook example (tiktok.md § 1). This skill mines the operator's product for those moments.

The goal is not to showcase features — it is to find the activation moment: the instant where a viewer thinks "I want to try that." That moment is almost always a transformation (before → after), a reveal (input → surprising output), or a relief (problem → gone). Rank beats by how powerfully they create that want-to-try reaction in a cold viewer, not by how much functionality they demonstrate.

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

1. **Comprehension speed as judgment, not stopwatch.** Every demo beat is a UI change a cold stranger can comprehend quickly — ideally within a few seconds — without audio. The standard is: could someone who has never heard of this product understand what just happened? If you need to answer "yes but only if they watch it twice," the beat fails. Speed of comprehension matters; the specific threshold depends on the complexity of the change.
2. **Before/after > before-only.** Beats with explicit before→after framing rank higher. The contrast is what makes a stranger stop scrolling.
3. **Output-object detection.** If the product produces an interesting output that stands alone (image, video, code, doc, chart), the output IS the demo beat. Show the output first; let the viewer reverse-engineer the value.
4. **Mute-test.** Every beat must communicate with sound off — the majority of social video is watched muted, especially on first scroll. If a beat requires audio to be understood, it is a weak beat unless founder talking-head is the chosen format.
5. **Activation-moment prioritization.** Rank beats by how strongly they produce the "I want to try this" reaction. Transformation beats (something changes), relief beats (problem disappears), and reveal beats (unexpected output appears) outrank informational beats (feature described or listed). The viewer's emotional reaction — not how much the product does — determines rank.
6. **Hook moment in frame 1.** No "let me explain" intro. The change or reveal is already happening when the video starts. Context comes after, if at all.
7. **Safe-zone awareness.** TikTok's persistent UI elements (like/comment/share, video info bar) cover the bottom and right edges of the frame. De-rank beats where the key UI change happens in those overlay zones — a viewer may never see it. The goal is that the load-bearing visual is clearly in the unobscured center of frame. Don't need exact pixels; use judgment to confirm nothing critical is in the danger zones.
8. **Beat count judgment.** Produce enough beats to give demo-strategist real options — typically 3 to 7 is the useful range. Below that there's nothing to work with; above that you're padding. Return the top ranked beats, not everything you found.
9. **Anti-feature-list.** "Opens app → navigates to dashboard → shows settings" is a tutorial, not a demo beat. Beats represent moments of *change* the viewer can have a reaction to. No reaction = no beat.
10. **Pre-launch products.** IF `app.stage === "pre-launch"` AND only mockups exist THEN mark beats `mockupOnly: true` — mockup-based demos have worked (Pushscroll precedent) but operator must disclose if directly asked.
11. **Citation-firewall.** Each beat describes a real observable change grounded in the walkthrough or screenshots provided. If operator claims "the app does X" but it isn't visible in any provided material, do NOT mine X as a beat. Mark `unverifiable: true` and ask for a recording that shows it.

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

## Hand-off to video production (the grounding asset)

The top-ranked beat's `sourceFrame` is the **real product screen** that grounds a Studio-tier video: when `maya-video-producer` makes a video (`clone_winning_ad` / `make_ad_from_url`), that beat's `sourceFrame` (saved in the media library) is passed as `imageAssetIds` so the video is built around the actual showable moment, never a fabricated UI. A rich beat library with a clear `sourceFrame` is what lets the video be grounded; if the best beat is `mockupOnly`/`unverifiable`, flag it so the producer doesn't present a mockup as a shipped product.

## Failure modes

- **No walkthrough + thin landing page.** `status: "walkthrough_required"`. Operator intake: "Record one 30-second screen recording of you doing the single thing that makes a user say 'oh'."
- **All candidates fail mute-test.** Product is voice/audio-dependent. Recommend founder-talking-head (tiktok.md rule 8).
- **All candidates are dashboards.** Dashboards-with-numbers don't perform on TikTok. `overallShowabilityVerdict: "thin"`, recommend slideshow Photo Mode.
- **Multimodal extraction worker 409.** Fall back to screenshot-only. Mark `multimodalDegraded: true`. No fabrication.

## Cost discipline

0 ScrapeCreators. 1 extraction_worker pass over walkthrough if available. 1 main_maya synthesis. Timeout 15 min.

## Anti-slop check

`label` and `uiChange` strings go to demo-strategist + format-miner. Run `maya-slop-critic` (banned-phrase scan). Specifically banned: "seamlessly", "magically", "instantly transforms", "effortlessly". Describe literal UI change in operator's vocabulary.
