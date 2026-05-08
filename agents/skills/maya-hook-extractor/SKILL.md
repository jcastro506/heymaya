---
name: maya-hook-extractor
version: 0.1.0-sprint3.5
description: Multimodal video → hook patterns. Watches the first 3 seconds of a post (Pro+), reads captions, scans top comments, and returns the hook structure plus a why-it-worked analysis grounded in retention proxies.
when-to-use: Fired by the post-publish reaction (event-driven, ~30min Pro / <5min Studio) and by the hook library auto-build behavior when a post crosses 2× baseline. Output writes to `posts.mayaAnnotation` (Sprint 4 schema add) and may append to `hookLibrary` if the pattern is novel.
plan-tier: Pro+ for the full multimodal video read; Starter falls back to caption + top-comments analysis only (no video frame ingestion). The fallback is documented; Maya tells the Starter creator the analysis is shallower.
thinking-budget: medium (post_publish_reaction / hook_library_build task tags)
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - hook
      - video-analysis
      - multimodal
      - performance
      - creator
---

# maya-hook-extractor

The hook is the post. Everything after the hook is whether the audience stays — but if they bounce in the first second, it doesn't matter how good minute three is. My job is to turn "your video did well" or "your video flopped" into "your hook pattern was X, here is why it worked or didn't, here is what to vary next time."

## When I run this

- Event-driven on post publish (`post_publish_reaction` program). Roughly 30 minutes after publish on Pro / Manager, under 5 minutes on Studio.
- When a post crosses 2× the creator's trailing baseline (`hook_library_build` — that hook gets extracted and added to `hookLibrary`).
- I do NOT run on every comment or like update. One pass per post is enough.

## How I read a hook

I'm watching for five things, in priority order:

1. **First 1–3 seconds (Pro+ only).** I pass the video URL to the multimodal model and ask it to describe the literal frames. What does the camera show? Is there a face by second 1? Is there text overlay by second 2? Is there movement, a cut, an audio sting? On TikTok and IG Reels, if seconds 0–2 are a static logo card or an over-edited intro, the hook is dead before the caption even loads.

2. **The first sentence of the caption.** This is the "hook in text" — what the audience reads if the video autoplays muted. Specific numbers, POV phrasing ("when your X does Y"), bold claims, "wait for it" tease, listicle openers ("3 things I learned from"), question openers. I classify against the known archetypes.

3. **Top 10 comments.** Comments are the receipt. If the top comments quote the hook verbatim ("the way you said 'I had $11 left' got me"), the hook landed. If they all reference something at minute 2, the hook didn't catch them — they stayed for the body. If they're all "first" and emoji-spam, the hook didn't earn engagement, distribution did.

4. **Platform fit.** TikTok rewards pattern interrupt in the first 1.5s — visual or audio. IG Reels rewards a strong cover frame because the Reel doubles as a static thumbnail. YouTube long-form rewards a 30-second hook arc, not a 1-second one. LinkedIn rewards a first-line that works without "see more." X rewards a first-tweet that stands alone. A hook that would crush on TikTok will eat dirt on LinkedIn.

5. **Voice fit.** Does this hook sound like the creator? A creator whose voice is dry-deadpan running a "OMG you guys won't BELIEVE—" hook is wearing someone else's costume. That gets flagged in `applicabilityToNiche` even if the hook archetype is sound.

## What I send back

```ts
{
  hook: {
    pattern: string;            // "POV bait" / "specific-number lead" / "wait-for-it" / "listicle opener" / "story tease" / "bold-claim" / "question-opener" / "unknown"
    firstSeconds: string;       // Pro+: described frames; Starter: first sentence of caption
  };
  whyItWorked: string;          // grounded in observable evidence: frame description + caption hook + top-comment reactions
  retentionScore: number;       // 0–1, derived from comment density + watch-signal proxies; rough on Starter
  applicabilityToNiche: string; // one sentence on whether this pattern fits THIS creator's voice
  citations: Array<{ kind: 'post' | 'audience'; id: string; fact: string }>;
  mode: 'multimodal' | 'caption-only';
}
```

## The two paths

- **Pro / Studio (Manager-tier) — multimodal.** Full video URL goes to Gemini 3 Flash with the caption + top comments. The model watches the first ~3 seconds and describes them. `firstSeconds` carries the actual frame description. This is the "she actually watched my video" moment.
- **Assistant / Starter — caption-only.** No video frames. Caption + top comments only. `firstSeconds` is set to the first sentence of the caption. `retentionScore` is a rough proxy from comment density (lots of comments early → engagement caught; sparse comments → likely scroll-past). I tell the creator: "I'm reading the caption + comments only — full video analysis is on the Manager tier."

The action layer enforces this via `planFeatures(creator)`. The skill itself does not branch on plan — the resolved `plan` is passed in.

## When I don't have enough

- `videoUrl` is null on a Pro+ post (private account, ScrapeCreators couldn't pull it). I fall back to caption-only with `mode: 'caption-only'` and a confidence note. I do NOT silently pretend I watched the video. The creator will catch that lie immediately.
- Caption is empty AND there are no comments AND we're caption-only. I return a low-confidence stub: `pattern: 'unknown'`, `whyItWorked: 'Insufficient signal to extract a hook pattern.'` Maya then stays silent on this post — the "grounded or silent" rule applies. Better quiet than fake.
- Multimodal call fails (model timeout, rate limit). Fall back to caption-only with the note. Never invent the frame description.

## Hand-offs

- I run inside `post_publish_reaction` (event-driven) and `hook_library_build` (when a post crosses 2× baseline).
- Output writes to `posts.mayaAnnotation` and may append to `hookLibrary` if the pattern is novel for this creator.
- `whyItWorked` passes through `maya-citation-firewall` before persistence.
- `maya-platform-best-practice` is consulted by the prompt builder when classifying whether a hook archetype fits the platform's distribution model.
- The hooks I extract feed `maya-pre-post-scorer` — when the creator drafts a future post, the scorer checks the draft's opener against this creator's known top-hook patterns.

## Plumbing

`script.ts` exposes two pure helpers:

1. `classifyHookFromCaption(caption, topComments, platform)` — runs the caption-only path. Classifies against the archetype library (POV, specific-number, bold-claim, wait-for-it, listicle, question, story-tease) and weights against platform physics.
2. `buildMultimodalPrompt(caption, topComments, platform, videoUrl)` — builds the `ChatMessage[]` array for the Pro+ multimodal pass with `taskTag: 'post_publish_reaction'`, medium thinking.

The action layer owns: plan-tier branching, model-router wiring, persistence to `posts.mayaAnnotation` + `hookLibrary`, and the final firewall pass.

## Examples

- `examples/tiktok-pov-bait.json` — caption-only TikTok with a clear POV opener
- `examples/yt-listicle-opener.json` — YouTube long-form, numbered listicle hook
- `examples/empty-caption-fail.json` — empty caption + no comments → low-confidence stub

## Sibling files

- `playbook.md` § Post-publish reaction, § Hook library auto-build
- Inventory: `maya-platform/SKILL.md` § Custom Maya skills
- Writes: `posts.mayaAnnotation`, `hookLibrary`
- Output passes through: `maya-citation-firewall`
