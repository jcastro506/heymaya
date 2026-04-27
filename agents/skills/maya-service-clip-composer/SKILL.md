---
name: maya-service-clip-composer
version: 0.2.0-clawhub-cloud
description: JUDGMENT wrapper around a ClawHub-installed cloud video composer (NemoVideo / Free Video Generator (CapCut) / operator-selected equivalent). Owns "which clips, what order, hook at second 0, what aspect ratio per platform, max-duration, music vibe, captions" — delegates rendering to the cloud skill. NO ffmpeg, NO local binaries, NO vendoring.
when-to-use: When a job upload includes ≥1 video clip + the asset cataloger has marked them as a "good content moment" (operator pre-set OR Maya's judgment), `clip-composer` queues a draft Reel/Short for operator approval. Studio-only initial gate (cloud render credits).
plan-tier: studio (initial gate per § 12.5.7 + Wave-4 video editing flag in `planFeaturesService.mayaVideoEditing`).
model-routing: Gemini 3 Flash MEDIUM thinking for the COMPOSITION JUDGMENT (which clips, what hook, what music). Cloud rendering is the installed ClawHub skill — no LLM thinking budget consumed for that, no local compute consumed either.
---

# maya-service-clip-composer

## Purpose

When the operator sends multiple video clips from a job site, the clips are typically raw and unedited. Posting them as-is on Instagram or TikTok is a guaranteed flop — those platforms punish unedited dumps. Maya's value-add is **judgment about composition**: which 4-6 seconds carry the story; what hook lands at second 0; what aspect ratio for which platform; what music vibe (or none) matches the brand voice; what max-duration the platform's algorithm rewards.

The actual rendering work — cutting, concatenating, rescaling, audio overlay, captions — is delegated to a **ClawHub-installed cloud video composer skill** (NemoVideo / Free Video Generator (CapCut) / operator-selected equivalent), installed via OpenClaw's runtime skill-download — NOT vendored on disk. See `docs/spikes/video-clip-skill-decision.md` for the corrected install-first decision (the original Wave C.6 vendor approach was rejected per the operator's no-vendoring rule, 2026-04-27 third correction). This skill is the JUDGMENT wrapper, not the pipeline.

**Per `feedback_install_first_not_build.md`**: Maya never authors video pipeline code, never vendors low-level binaries like ffmpeg. The wrapper composes a `compositionPlan` and hands it to the ClawHub-installed cloud composer via OpenClaw's skill-invocation surface; render is cloud-side (no local compute, no ffmpeg-on-Fly install dep).

## Inputs

```ts
{
  business: {
    businessId: Id<"businesses">;
    serviceTypes: ReadonlyArray<string>;
    brandVoice: string;
  };
  clips: ReadonlyArray<{
    assetId: Id<"mediaAssets">;
    storageUrl: string;
    durationSec: number;                          // from cataloger
    visualQuality: "excellent" | "good" | "fair" | "poor";
    primarySubject: string;                       // cataloger output
    serviceCategory: string;
    framingNotes: string;
  }>;
  /** Target platform — drives aspect ratio + max duration. */
  targetPlatform: "gbp" | "instagram-reel" | "tiktok" | "facebook";
  /** Operator-approved caption from gbp-post-optimizer / content-arc-planner.
   * Maya never invents this; she cites a queued post draft. */
  approvedCaption: string;
  /** Optional source post id for cite trail. */
  sourceGbpPostId?: Id<"gbpPosts">;
}
```

## Outputs

```ts
{
  compositionPlan: {
    aspectRatio: "16:9" | "9:16" | "1:1";        // platform-driven
    maxDurationSec: number;                       // platform-driven
    selectedClips: ReadonlyArray<{
      assetId: Id<"mediaAssets">;
      sourceStartSec: number;                     // start trim
      sourceEndSec: number;                       // end trim
      compositionOrder: number;                   // 0-indexed
    }>;
    hookText: string | null;                      // overlay at second 0
    musicVibe: "none" | "upbeat-energetic" | "calm-confident" | "warm-friendly";
    captionTextOverlay: string | null;            // optional burned-in text
  };
  rationale: string;                              // ≤300 chars: why these cuts
  derivedFromAssetIds: ReadonlyArray<Id<"mediaAssets">>;  // lineage
  /** Eventual `gbpPosts` row gets `status="pending"` — operator approves. */
  enqueuedForRender: boolean;
}
```

## Per-platform constraints (KNOWLEDGE, not hardcoded thresholds)

These are platform physics — they're real bounds Maya respects, not operator-tunable rules:

- **GBP video post**: 16:9 landscape; max 30s; no captions burned in (Google handles); music optional.
- **Instagram Reel**: 9:16 vertical; max 90s (sweet spot 15-30s); first 1-2 sec is the hook; captions strongly recommended.
- **TikTok**: 9:16 vertical; max 60s for trade-content (longer hurts retention); hook in first 1 sec; trending audio when wiki suggests it.
- **Facebook landscape**: 16:9 landscape; max 60s; first frame is the thumbnail.

The composition plan ALWAYS satisfies the target's aspect + duration. The selection logic is Maya's judgment: which clips, what trim points, what order. Gemini 3 Flash MEDIUM looks at the cataloger's `framingNotes` + `primarySubject` per clip and picks.

## Hard rules

- **Never ship a clip flagged `visualQuality: "poor"`.** Even if it's the only one available.
- **Never exceed the platform's max duration.** Validated post-plan; truncates the last selected clip if needed (ffmpeg-side trim).
- **Never invent a hook.** `hookText` MUST be either null (no overlay) OR a substring of `approvedCaption` (cited).
- **Never auto-publish.** The composition outputs a `gbpPosts.status="pending"` row; the operator approves; the renderer + uploader run on approval, NOT on draft.
- **Studio-only initial gate.** `planFeaturesService(business).mayaVideoEditing === true` is the required precondition; the orchestrator fails closed before invoking this skill.
- **Cataloger output is the source of truth for clip metadata.** The wrapper does NOT introspect video bytes; that's the cataloger's job (Wave B). If `framingNotes` is empty, Maya falls back to `primarySubject` only.

## Music vibe selection

A 4-way enum over the brand voice + service category:
- "friendly-neighborhood-pro" + landscaping/cleaning → `warm-friendly`
- "professional-efficient" + electrical/HVAC commercial → `calm-confident`
- "authoritative-expert" + restoration/roofing → `calm-confident`
- High-energy job-site action shot (cataloger flags `framingNotes` as "action") → `upbeat-energetic`
- Default → `none`

The actual track selection happens in the installed skill or a Phase 1.5 expansion — for v0, the music vibe is a TAG passed to the renderer; the renderer picks from a curated pool.

## Memory-wiki integration (§ 9.5)

- **Pre-judgment**: `wiki_get("concepts/what-works/video/<platform>/*")` for outcome-attributed video patterns. When the wiki says "9-sec Reels with face-on-camera hook drove 4× the leads of voice-over hooks for THIS operator," Maya's judgment weights toward face-on-camera selection.
- **Post-render (non-blocking)**: when a composed video is operator-approved AND drives outcomes via Wave C.5 attribution, the learnings extractor promotes the pattern. Ship a `wiki_apply` to `sources/video-renders/<gbpPostId>` recording the composition plan + which clips were used.

## Plan-tier

Studio-only initial gate. Per § 12.5.7 the wave-4 video-edit worker is Studio gated; the wrapper orchestrator MUST check `planFeaturesService(business).mayaVideoEditing` before invoking and FAIL CLOSED otherwise.

## Test categories

1. **Cross-tenant** — orchestrator validates every `mediaAssets.assetId` belongs to the caller's `businessId` before invoking the wrapper.
2. **Plan-tier** — Studio-only gate; Starter/Pro callers fail-closed (no draft queued, no render).
3. **Adversarial** — empty clip array, all-poor-quality clips, malformed cataloger output, prompt-injection in `framingNotes`, invented hook (not in `approvedCaption`).
4. **Composition determinism on fixture clips** — given a fixed set of cataloged clips, the script picks consistent cuts (LLM seam injectable for stability).
5. **Aspect-ratio + max-duration enforcement** — output plan is always within bounds; over-budget plans are truncated.
6. **Install-skill-availability fail-gracefully** — when no ClawHub cloud video composer is installed, the wrapper returns `enqueuedForRender: false` + a clear rationale ("Maya can install one from ClawHub via maya-skill-installer on operator approval"); never crashes the brief.

## Sibling files

- Calls (delegate): a ClawHub-installed cloud video composer skill — downloaded by OpenClaw at runtime from the ID locked into the deploy-time workspace manifest at `convex/agents/packs/maya_service/`. Same uniform manifest for every Maya — no per-business install divergence. Top candidates: `vcarolxhberger/free-video-generator-capcut` (CapCut wrapper, NemoVideo backend, 100 free credits / 7d for anonymous), or NemoVideo first-party `nemovideo/nemovideo_skills`.
- Calls: `maya-service-citation-firewall` for the `approvedCaption` cite trail.
- Reads: `mediaAssets.catalog` for clip metadata; `wiki_get("concepts/what-works/video/*")` for outcome weights.
- Writes: `gbpPosts` row with `status="pending"`; `mediaAssets` row for the rendered output (lineage via `derivedFromAssetIds`).
- Standing order: Folded into `daily_content_check` prose (when operator sends multi-clip media in a 60-sec window, asset cataloger runs → if `serviceCategory` indicates a "good content moment" + Studio-tier, this skill drafts). NOT a new standing-order entry; array length stays at 15 per Wave C.5 precedent.
