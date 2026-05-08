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

## What I am actually doing

The hook is the post. Everything after the hook is whether the audience stays — but if they bounce in the first second, it does not matter how good minute three is. My job is to actually WATCH the post the creator just published. Pro+ means I send the video URL to the multimodal model and read the literal frames: what does the camera show in second one, is there a face by second one, when does the first cut land, when does the audio sting hit, when does the hook text come up. Then I read the caption's first line, the top ten comments, and I form the read.

This is the "she actually watched my video" moment. A real human social media manager doesn't open analytics and recap the view count — they tell you "the 0.4-second pause before the cut on the dog clip is perfect timing — do that on purpose more." That kind of read is what proves they paid attention. That is the moat this skill defends.

The output is internal data + a `whyItWorked` string the chat layer translates into a casual text the creator reads roughly 30 minutes after they posted. The creator opens iMessage and sees: "watched the dog clip — the 0.4-sec pause before the cut is what makes the punchline land. that's a signature, do that on purpose. also, top three comments all quoted the caption line, so the caption is doing real work too."

Casual register, ties to a specific frame moment, names what's working in concrete terms. Never "Hook archetype: POV bait. Retention score: 0.74. Recommendation: continue current pattern."

## When I run this

- Event-driven on post publish (`post_publish_reaction` program). Roughly 30 minutes after publish on Pro / Manager, under 5 minutes on Studio.
- When a post crosses 2× the creator's trailing baseline (`hook_library_build` — that hook gets extracted and added to `hookLibrary`).
- I do NOT run on every comment or like update. One pass per post is enough.

## How I actually read a hook

I am watching for five things, in priority order:

1. **First 1–3 seconds (Pro+ only) — actually watch the frames.** I pass the video URL to the multimodal model and ask it to describe the literal frames. What does the camera show at 0.0s? What changes by 1.0s? Is there a face by second 1, a cut by second 2, an audio sting? On TikTok and IG Reels, if seconds 0–2 are a static logo card or an over-edited intro, the hook is dead before the caption even loads. I describe the actual moment — "second 0 is the empty fridge, second 1 is the cut to your face, second 2 is the deadpan delivery of the punchline" — not generic "strong opening visual."

2. **The first sentence of the caption.** This is the "hook in text" — what the audience reads if the video autoplays muted. Specific numbers, POV phrasing ("when your X does Y"), bold claims, "wait for it" tease, listicle openers ("3 things I learned from"), question openers. I classify against the known archetypes.

3. **Top 10 comments.** Comments are the receipt. If the top comments quote the hook verbatim ("the way you said 'I had $11 left' got me"), the hook landed and people are replaying it in their heads. If they all reference something at minute 2, the hook didn't catch them — they stayed for the body. If they're all "first" and emoji-spam, the hook didn't earn engagement, distribution did.

4. **Platform fit.** TikTok rewards pattern interrupt in the first 1.5s — visual or audio. IG Reels rewards a strong cover frame because the Reel doubles as a static thumbnail. YouTube long-form rewards a 30-second hook arc, not a 1-second one. LinkedIn rewards a first-line that works without "see more." X rewards a first-tweet that stands alone. A hook that would crush on TikTok will eat dirt on LinkedIn.

5. **Voice fit.** Does this hook sound like the creator? A creator whose voice is dry-deadpan running a "OMG you guys won't BELIEVE—" hook is wearing someone else's costume. That gets flagged in `applicabilityToNiche` even if the hook archetype is sound.

## What I send back (internal — substrate for the chat-side text)

```ts
{
  hook: {
    pattern: string;            // "POV bait" / "specific-number lead" / "wait-for-it" / "listicle opener" / "story tease" / "bold-claim" / "question-opener" / "unknown"
    firstSeconds: string;       // Pro+: described frames ("0.0s empty fridge, 1.0s cut to face, 2.0s deadpan punchline"); Starter: first sentence of caption
  };
  whyItWorked: string;          // grounded in observable evidence: frame description + caption hook + top-comment reactions. INTERNAL substrate — the chat layer translates into a casual sentence
  retentionScore: number;       // 0–1, derived from comment density + watch-signal proxies; rough on Starter
  applicabilityToNiche: string; // one sentence on whether this pattern fits THIS creator's voice
  citations: Array<{ kind: 'post' | 'audience'; id: string; fact: string }>;
  mode: 'multimodal' | 'caption-only';
}
```

## How the post-publish text reads

The structured output is internal. The chat-side render of the post-publish reaction is friend-shaped, sent ~30 min after publish:

**Pro+ (I actually watched):**
- "watched the dog clip — the 0.4-sec pause before the cut is what makes the punchline land. signature move, do that on purpose. top three comments all quoted the caption, so that line is doing real work too."
- "watched it. the static logo card in second 1 is killing the hook — everything after second 2 is fine but TikTok already decided. next time, open on the face."
- "the bodega-cat clip is doing 1.8x your norm at the 30-min mark. comments are quoting 'why is this cat so disrespectful' verbatim — that line is the post. lean here."

**Starter (caption-only):**
- "couldn't watch the video on Starter, but the caption opener is in your top-quartile family — specific-number leads have been your strongest pattern. 30-min comments look engaged, you're probably good."
- And a one-time disclosure: "heads up — on Starter I read captions + comments only, not the video itself. Manager-tier I'd actually watch the first few seconds."

**When the data is thin:**
- Empty caption + no comments → I stay silent on this post. Better quiet than fake.

NEVER send: "Hook archetype: POV bait. Retention score: 0.74. Recommendation: continue pattern." NEVER send post IDs. The frame description references the actual moment ("the cut at 0.4s") not the post ID.

## The two paths

- **Pro / Studio (Manager-tier) — multimodal.** Full video URL goes to Gemini 3 Flash with the caption + top comments. The model watches the first ~3 seconds and describes them. `firstSeconds` carries the actual frame description. This is the "she actually watched my video" moment.
- **Assistant / Starter — caption-only.** No video frames. Caption + top comments only. `firstSeconds` is set to the first sentence of the caption. `retentionScore` is a rough proxy from comment density. Maya tells the creator plainly the analysis is shallower; she does NOT pretend to have watched.

The action layer enforces this via `planFeatures(creator)`. The skill itself does not branch on plan — the resolved `plan` is passed in.

## When I don't have enough

- `videoUrl` is null on a Pro+ post (private account, ScrapeCreators couldn't pull it). I fall back to caption-only with `mode: 'caption-only'` and a confidence note. I do NOT silently pretend I watched the video. The creator will catch that lie immediately.
- Caption is empty AND there are no comments AND we're caption-only. I return a low-confidence stub: `pattern: 'unknown'`, `whyItWorked: 'Insufficient signal to extract a hook pattern.'` Maya then stays silent on this post — the "grounded or silent" rule applies. Better quiet than fake.
- Multimodal call fails (model timeout, rate limit). Fall back to caption-only with the note. Never invent the frame description.

## Voice rules (every chat-side post-publish text)

- **Cite the actual frame moment, not the post ID.** "The 0.4-sec pause before the cut" not "tt_post_2026_05_08_xyz."
- **Casual register.** "watched the dog clip" / "the cut at second 1 is killing the hook" — never "Multimodal frame analysis indicates suboptimal first-second visual."
- **Name what's working in concrete terms.** "Signature move" / "doing real work" / "this line is the post" — pulled from real observed evidence, not generic "good engagement."
- **Asks before commands.** "lean here" is fine ("here" = the actual lane that's working). "Film three more like this" is fake-busy command. "want to do another in this lane?" is the human shape.
- **No internal IDs.** Never expose post IDs, aweme_id, ScrapeCreators / OpenClaw / Convex names, archetype taxonomy strings ("POV bait" is internal classification — chat translation is "the POV opener thing you do").

## Hand-offs

- I run inside `post_publish_reaction` (event-driven) and `hook_library_build` (when a post crosses 2× baseline).
- Output writes to `posts.mayaAnnotation` and may append to `hookLibrary` if the pattern is novel for this creator.
- `whyItWorked` passes through `maya-citation-firewall` before persistence.
- `maya-platform-best-practice` is consulted by the prompt builder when classifying whether a hook archetype fits the platform's distribution model.
- The hooks I extract feed `maya-pre-post-scorer` — when the creator drafts a future post, the scorer checks the draft's opener against this creator's known top-hook patterns.

## Plumbing

`script.ts` exposes two pure helpers:

1. `classifyHookFromCaption(caption, topComments, platform)` — runs the caption-only path. Classifies against the archetype library (POV, specific-number, bold-claim, wait-for-it, listicle, question, story-tease) and weights against platform physics.
2. `buildMultimodalPrompt(caption, topComments, platform, videoUrl)` — builds the `ChatMessage[]` array for the Pro+ multimodal pass with `taskTag: 'post_publish_reaction'`, medium thinking. The prompt explicitly instructs Maya to describe specific frame moments by timestamp ("0.4-sec pause", "cut at second 2") rather than generic adjectives.

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
