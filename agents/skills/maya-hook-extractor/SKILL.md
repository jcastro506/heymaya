---
name: maya-hook-extractor
version: 0.1.0-sprint3.5
description: Multimodal video → hook patterns. Watches the first 3 seconds of a post (Pro+), reads captions, scans top comments, and returns the hook structure plus a why-it-worked analysis grounded in retention proxies.
when-to-use: Fired by the post-publish reaction (event-driven, ~30min Pro / <5min Studio) and by the hook library auto-build behavior when a post crosses 2× baseline. Output writes to `posts.mayaAnnotation` (Sprint 4 schema add) and may append to `hookLibrary` if the pattern is novel.
plan-tier: Pro+ for the full multimodal video read; Starter falls back to caption + top-comments analysis only (no video frame ingestion). The fallback is documented; Maya tells the Starter creator the analysis is shallower.
thinking-budget: medium (post_publish_reaction / hook_library_build task tags)
---

# maya-hook-extractor

The hook is the post. This skill turns "your video did well / your video flopped" into "your hook pattern was X, here's why it worked, here's what to vary."

## Inputs

```ts
{
  postId: string;             // ID in `posts` table
  videoUrl: string | null;    // Pro+: passed to Gemini 3 Flash multimodal; Starter: ignored
  caption: string;
  topComments: Array<{ author: string; text: string; likeCount: number }>;
  platform: 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
  plan: 'starter' | 'pro' | 'studio';  // determines whether multimodal video ingestion runs
}
```

## Outputs

```ts
{
  hook: {
    pattern: string;            // human-readable label, e.g. "POV bait" / "specific-number lead" / "wait-for-it"
    firstSeconds: string;       // transcribed/described content of first 3 seconds (Pro+) or first sentence of caption (Starter)
  };
  whyItWorked: string;          // grounded in observable evidence — caption hook + top-comment reactions + (Pro+) frame description
  retentionScore: number;       // 0–1, derived from comment density and watch signal proxies; rough on Starter
  applicabilityToNiche: string; // one sentence on whether the pattern fits the creator's voice
  citations: Array<{
    kind: 'post' | 'audience';
    id: string;
    fact: string;
  }>;
  mode: 'multimodal' | 'caption-only';  // surfaces which path ran, for telemetry
}
```

## Plan-tier behavior

The calling Convex action MUST consult `planFeatures(creator)` and pass the resolved `plan` into this skill:

- **Starter** — `mode: 'caption-only'`. The skill does NOT call Gemini 3 Flash with the video URL. It analyzes the caption + top-comments only. `firstSeconds` is set to the first sentence of the caption. `retentionScore` is rough (comment-density-based proxy). Maya tells the creator: "I'm reading the caption + comments only — full video analysis is on Pro."
- **Pro / Studio** — `mode: 'multimodal'`. The full video URL is passed to the model router (Gemini 3 Flash, medium thinking) which watches the first 3 seconds of frames and transcribes them.

This is enforced server-side in the calling action. If a Starter creator's tier is somehow elevated client-side, the action's `planFeatures(creator)` check is the source of truth — fail-closed.

## How it works

`script.ts` exposes two pure helpers:

1. `classifyHookFromCaption(caption, topComments, platform)` — runs the caption-only path. Pattern-matches the caption against a library of known hook archetypes (POV, specific number, bold claim, wait-for-it, listicle opener, question opener, story tease) and weights each against the platform's distribution physics (TikTok rewards pattern interrupt, IG rewards saves-driving, YT rewards retention curve hooks, etc).

2. `buildMultimodalPrompt(caption, topComments, platform, videoUrl)` — assembles the prompt the calling action sends to the model router for the Pro+ multimodal path. Returns a `ChatMessage[]` array ready to pass to `callMaya` with `taskTag: 'post_publish_reaction'`.

The Convex action calling this skill is responsible for:
- Plan-tier branching (multimodal vs caption-only)
- Wiring the model router call (Pro+ only)
- Writing the result to `posts.mayaAnnotation` (TODO(s3.5): table needs `mayaAnnotation` column added in Sprint 4 schema work — not yet present in `convex/schema.ts`)
- Passing the final `whyItWorked` string through `maya-citation-firewall` before persisting

## Failure handling

- If `videoUrl` is null on a Pro+ creator (ScrapeCreators didn't return a URL — happens on private accounts), fall back to caption-only with `mode: 'caption-only'` and a confidence note. Don't silently pretend the video was watched.
- If the caption is empty AND there are no comments AND we're on the caption-only path, return a low-confidence stub: `pattern: 'unknown'`, `whyItWorked: 'Insufficient signal to extract a hook pattern.'` Maya then stays silent on this post (per "grounded or silent").

## Examples

- `examples/tiktok-pov-bait.json` — caption-only TikTok with a clear POV opener
- `examples/yt-listicle-opener.json` — YouTube long-form with a numbered listicle hook
- `examples/empty-caption-fail.json` — empty caption + no comments → low-confidence stub

## Sibling files

- Referenced in: `agents/skills/maya-platform/playbook.md` § Post-publish reaction, § Hook library auto-build
- Inventory entry: `agents/skills/maya-platform/skill.md` § Custom Maya skills → `maya-hook-extractor`
- Convex tables touched (write): `posts.mayaAnnotation` (Sprint 4 schema add), `hookLibrary` (Sprint 4 schema add)
- Output passes through: `maya-citation-firewall` before persistence
