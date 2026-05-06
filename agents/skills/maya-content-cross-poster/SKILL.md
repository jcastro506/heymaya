---
name: maya-content-cross-poster
version: 0.1.0-sprint3.5
description: Per-platform content variant generator. Takes one approved piece + the creator's connected platforms, produces optimized variants. Honors no-posting absolutely — prepares variants for one-tap publish by the creator and surfaces deep-link share-sheet URLs where platforms expose them. Never publishes on the creator's behalf.
when-to-use: On-demand when a creator approves a piece and asks give me this in every format. Also folded into Weekly content plan (per idea card) and surfaced after Post-publish reaction identifies a top-performer worth re-cutting.
plan-tier: ungated; bounded by handle cap (Starter 1, Pro 3, Studio 5).
thinking-budget: medium
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - content-publishing
      - cross-posting
      - per-platform-variant
      - creator
---

## Calls

- `maya-voice-applier` — mandatory on every caption variant
- `maya-platform-best-practice` — per-platform format choice (indirectly via cache, maya-platform-algo-researcher)
- `maya-citation-firewall` — mandatory if variant text references creator data

## Delegates to

- model router `callMaya` for per-platform rewriting


# maya-content-cross-poster

## Why this exists

Cross-posting "the same post" everywhere is the single most common creator
mistake. TikTok hates a YouTube watermark. Instagram suppresses cross-posted
TikToks. LinkedIn rejects vertical video. X downranks any post with an
external link in the first message.

The work is per-platform variants — same idea, optimized format per platform.
This is mechanical, repetitive, exactly what an AI manager should own. Maya
takes one approved source piece, reads the creator's connected platforms,
and emits one variant per platform with the right aspect ratio, the right
duration cut, the right caption shape, the right hashtag posture, the right
posting time, and a deep-link URL where the creator can one-tap publish.

**Maya does not publish.** Per `CLAUDE.md § What this product is NOT`, the
creator posts. Maya prepares.

## Inputs

```ts
{
  source: {
    caption: string;
    mediaUrl: string;            // Convex storage URL or external URL
    mediaType: 'video' | 'image' | 'carousel' | 'text';
  };
  creatorPlatforms: Array<{
    platform: 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
    handle: string;
  }>;
  creatorPicture: { /* from Convex `creatorPicture` table — niche, voice, audience */ };
  anchorPlatform: 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
  // anchorPlatform = the source piece's native platform; the variants are
  // adaptations FROM the anchor TO the others.
}
```

## Outputs

```ts
{
  variants: Array<{
    platform: 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
    format: string;              // "vertical 9:16 60s", "carousel 4:5 9 slides", etc.
    captionRewrite: string;      // voice-applied
    durationCutSuggestion?: string; // "trim to 0:00-0:42 — keep the hook + payoff, drop the credits"
    aspectRatioGuidance: string; // "9:16 vertical — re-export from your editor"
    hashtags: string[];          // platform-appropriate count and style
    postingTimeLocal: string;    // ISO time hint, creator's tz
    oneTapPublishUrl?: string;   // deep-link share-sheet URL where applicable
    fallbackPublishInstruction: string; // plain-language steps when no deep link
  }>;
  notes: string;                 // overall strategist note ("post TikTok first, then 24h later IG so the algo doesn't see cross-post signal")
}
```

## Per-platform format mapping

The format choice per platform is the canonical "right way to ship":

| Platform   | Default format                         | Notes                                              |
|------------|----------------------------------------|----------------------------------------------------|
| TikTok     | vertical 9:16, ≤60s                    | Native sound; first 1.5s decides distribution      |
| Instagram  | Reel 9:16 (≤90s) OR carousel 4:5       | Picks Reel for video sources, carousel for ≥3 images or text-heavy |
| YouTube    | Shorts 9:16 (≤60s) OR Long 16:9        | Picks Shorts for clips ≤60s, Long for evergreen   |
| LinkedIn   | Native video square 1:1 OR text post   | Picks text+thread for narrative; square video for capture |
| X          | Thread of 3-5 tweets, first as hook    | Image/video preferred over plain text; no link in first tweet |

The picker logic lives in `script.ts` as `pickFormat(anchorMediaType, targetPlatform)`.
Format choice is also informed by `maya-platform-best-practice` (consulted per
variant) so the static knowledge layer can override the default if the niche
demands it (e.g. food creators on YouTube perform best as Long, not Shorts).

## One-tap publish URLs

Where platforms expose deep-link share-sheet URLs, we surface them so the
creator's iPhone or Android can hand off the prepared media to the platform
app:

| Platform   | Deep link                                               | Fallback                             |
|------------|---------------------------------------------------------|--------------------------------------|
| TikTok     | `tiktok://share?media=<url>` (iOS sharesheet)            | "Open TikTok → tap +, import from camera roll" |
| Instagram  | `instagram://share?media=<url>` (iOS) or web composer   | "Open Instagram → tap +, choose Reel / Post" |
| YouTube    | `youtube://upload?file=<url>` (Android only, limited)    | "Open YouTube Studio app → Upload"   |
| LinkedIn   | `linkedin://share?url=<...>` (limited media support)    | "Open LinkedIn → Start a post → upload"  |
| X          | `twitter://post?message=<...>` (text only, no media)    | "Open X → New post → attach"         |

Deep links are best-effort. Where the platform changes its URL scheme (LinkedIn
recently restricted media in deep links), we degrade to the fallback string
and the creator gets clear plain-language steps. The choice is encoded in
`script.ts` as `oneTapUrlFor(platform, mediaUrl, captionDraft)`.

The skill never publishes. The deep-link only HANDS OFF to the platform's
app on the creator's device, where the creator confirms and posts.

## Plan-tier gating (server-side, fail-closed)

Enforced by the Convex action wrapping this skill:

- The number of variants emitted is capped at `planFeatures(creator).maxHandles`.
- Starter (1 handle) gets variants only for their single connected platform —
  effectively a "tighten this for your platform" pass, not a true cross-post.
- Pro gets up to 3 variants. Studio up to 5.
- `creatorPlatforms` input is intersected with `creatorHandles` rows in the
  DB at action entry — Maya cannot be tricked into producing variants for a
  platform the creator hasn't connected.

## Citation firewall

Caption rewrites that reference creator data ("your audience saves IG carousels
3x as much as Reels — leaning into carousel for this one") must pass
`maya-citation-firewall` with the supporting evidence. Pure-creative captions
(no factual claim) skip the firewall, by design — the firewall flags claims,
not opinions.

## Voice applier

Every caption variant runs through `maya-voice-applier` with the creator's
voice fingerprint. This is the cross-post-quality moat: the IG caption sounds
like the creator on IG, the X thread sounds like the creator on X, both
recognizably the same person.

## What this skill is NOT

- **Not auto-publish.** Never. See § "One-tap publish URLs" above. The
  creator posts.
- Not a video editor. We suggest cuts ("trim to 0:00-0:42"); we do not
  re-render media. Media re-render is the creator's editor's job.
- Not a scheduler. We suggest posting times; the creator (or a scheduler
  app of their choice) actually times the post.
- Not for the anchor platform. We do not regenerate the source — the source
  is what got approved. The anchor variant is a passthrough with format
  metadata only.

## Examples

See `examples/anchor-tiktok-3-platforms.json` for a Pro creator approving a
TikTok and getting IG Reel + YT Shorts + X thread variants.

See `examples/starter-anchor-only.json` for a Starter creator (1 platform);
the skill returns a single tightened variant.

## Sibling-file references

- Invoked from `agents/skills/maya-platform/playbook.md` § Weekly content plan
  (each idea card is materialized via this skill) and (forthcoming) § Cross-post.
- Listed in `agents/skills/maya-platform/skill.md` § Custom Maya skills.
- Note: the operator lead is backfilling playbook/skill/cron references in a
  separate task (per the parent agent brief). This SKILL.md is authored
  assuming those backfills land.
