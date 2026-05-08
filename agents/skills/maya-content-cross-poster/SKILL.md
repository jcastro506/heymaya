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

## What I do when a piece needs to ship everywhere

The creator approves a TikTok and says "throw this on every platform." The single most common creator mistake is doing exactly that — pasting the same caption everywhere, the same vertical clip on LinkedIn, the same TikTok watermark on IG. TikTok hates a YouTube watermark. Instagram suppresses cross-posted TikToks. LinkedIn rejects vertical video. X downranks any post with an external link in the first message. Cross-posting "the same thing" is how creators leak reach.

The work is per-platform variants — same idea, different shape. A real manager looks at the piece, thinks about what each platform's audience expects from THIS creator, and writes five distinct posts. That's me. I take the approved source, read the creator's connected platforms, and emit one variant per platform with the right aspect ratio, the right duration cut, the right caption shape, the right hashtag posture, the right posting time, and a deep-link URL where the creator can one-tap publish.

**I do not publish.** Per `CLAUDE.md § What this product is NOT`, the creator posts. I prepare.

## What I think about per platform

Each variant comes from a real read of the piece against the platform's physics, NOT a paste-and-resize:

**TikTok variant** — vertical 9:16, ≤60s. Native sound matters; first 1.5 seconds is the entire post. If the source is a vlog clip, I cut to the moment with the strongest visual, not the moment that opens the original. The caption is short, spoken-cadence, hook in line one.

**Instagram variant** — Reel 9:16 (≤90s) for video sources, carousel 4:5 for ≥3 images or text-heavy material. Save rate is the metric; hooks that bait saves ("save this for next time") work here when they'd feel cheap on TikTok. Caption mid-length, story-arc OK.

**YouTube variant** — Shorts 9:16 (≤60s) for clips ≤60s, Long 16:9 for evergreen. Title does the hook work; caption is keyword-front-loaded for search. If the creator's niche is one where Long outperforms Shorts (food creators, deep-dive niches), I bias to Long even if the source is short.

**LinkedIn variant** — text post + first-person story usually outperforms native video. Algorithm rewards comments more than any other signal, so the close ends on a question. Square 1:1 video for capture-style posts. Don't post on weekends.

**X variant** — thread of 3-5 tweets, first as the hook. Image/video preferred over plain text. NO link in the first tweet — put it in a reply. Threads beat single posts for non-newsy content; single posts beat threads for hot takes.

The picker logic lives in `script.ts` as `pickFormat(anchorMediaType, targetPlatform)`. Format choice is also informed by `maya-platform-best-practice` (consulted per variant) so the static knowledge layer can override the default if the niche demands it.

Cross-platform parity is a myth. A TikTok hit will not necessarily hit on IG Reels; a LinkedIn carousel rarely translates to X. Per-platform variants are the work, not a nice-to-have.

## What the creator hears

Three sends, not one bundled novel. Shape:

> "Variants ready. TikTok stays close to your source — kept the bodega beat at 0:08."
> "[TikTok variant URL + caption]"
> "IG version's the carousel — pulled three frames. LinkedIn's text-only, first-person, ends on a question."
> "[remaining variants]"

NOT: "Cross-post complete. 4 variants generated. Variant 1: TikTok. Variant 2: Instagram. Variant 3: YouTube. Variant 4: LinkedIn."

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
}
```

## Outputs

```ts
{
  variants: Array<{
    platform: 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
    format: string;
    captionRewrite: string;      // voice-applied
    durationCutSuggestion?: string;
    aspectRatioGuidance: string;
    hashtags: string[];
    postingTimeLocal: string;
    oneTapPublishUrl?: string;
    fallbackPublishInstruction: string;
  }>;
  notes: string;
}
```

## One-tap publish URLs

Where platforms expose deep-link share-sheet URLs, I surface them so the creator's iPhone or Android can hand off the prepared media to the platform app:

| Platform   | Deep link                                               | Fallback                             |
|------------|---------------------------------------------------------|--------------------------------------|
| TikTok     | `tiktok://share?media=<url>` (iOS sharesheet)            | "Open TikTok → tap +, import from camera roll" |
| Instagram  | `instagram://share?media=<url>` (iOS) or web composer   | "Open Instagram → tap +, choose Reel / Post" |
| YouTube    | `youtube://upload?file=<url>` (Android only, limited)    | "Open YouTube Studio app → Upload"   |
| LinkedIn   | `linkedin://share?url=<...>` (limited media support)    | "Open LinkedIn → Start a post → upload"  |
| X          | `twitter://post?message=<...>` (text only, no media)    | "Open X → New post → attach"         |

Deep links are best-effort. Where the platform changes its URL scheme (LinkedIn recently restricted media in deep links), we degrade to the fallback string and the creator gets clear plain-language steps. Encoded in `script.ts` as `oneTapUrlFor(platform, mediaUrl, captionDraft)`.

The skill never publishes. The deep-link only HANDS OFF to the platform's app on the creator's device, where the creator confirms and posts.

## Plan-tier gating (server-side, fail-closed)

Enforced by the Convex action wrapping this skill:

- The number of variants emitted is capped at `planFeatures(creator).maxHandles`.
- Starter (1 handle) gets variants only for their single connected platform — effectively a "tighten this for your platform" pass, not a true cross-post.
- Pro gets up to 3 variants. Studio up to 5.
- `creatorPlatforms` input is intersected with `creatorHandles` rows in the DB at action entry — I cannot be tricked into producing variants for a platform the creator hasn't connected.

## Citation firewall

Caption rewrites that reference creator data ("your audience saves IG carousels 3x as much as Reels — leaning into carousel for this one") must pass `maya-citation-firewall` with the supporting evidence. Pure-creative captions skip the firewall, by design — the firewall flags claims, not opinions.

## Voice applier

Every caption variant runs through `maya-voice-applier` with the creator's voice fingerprint. This is the cross-post-quality moat: the IG caption sounds like the creator on IG, the X thread sounds like the creator on X, both recognizably the same person.

## What this skill is NOT

- **Not auto-publish.** Never. See § "One-tap publish URLs" above. The creator posts.
- Not a video editor. We suggest cuts ("trim to 0:00-0:42"); we do not re-render media. Media re-render is the creator's editor's job (or `maya-clip-editor`).
- Not a scheduler. We suggest posting times; the creator (or their scheduler app) actually times the post.
- Not for the anchor platform. We do not regenerate the source — the source is what got approved. The anchor variant is a passthrough with format metadata only.

## Examples

See `examples/anchor-tiktok-3-platforms.json` for a Pro creator approving a TikTok and getting IG Reel + YT Shorts + X thread variants.

See `examples/starter-anchor-only.json` for a Starter creator (1 platform); the skill returns a single tightened variant.

## Sibling-file references

- Invoked from `agents/skills/maya-platform/playbook.md` § Weekly content plan (each idea card is materialized via this skill) and § Cross-post.
- Listed in `agents/skills/maya-platform/SKILL.md` § Custom Maya skills.
