---
name: maya-idea-generator
description: >-
  Generate concrete, voice-anchored content ideas for the upcoming week.
  Composes against the creator's voiceFingerprint, last 30 days of posts,
  top hooks from hookLibrary, and trend candidates from
  maya-trend-watcher. Every idea cites at least two specific recent posts;
  uncited ideas are dropped before they reach the creator. Used by the
  weekly content plan (Sunday 4pm cron) and on-demand from chat
  ("give me ideas for next week").
allowed-tools: Read, Write
metadata:
  openclaw:
    emoji: "💡"
    requires:
      env: []
    tags:
      - content
      - ideation
      - creator
---

# maya-idea-generator

## What I am actually doing

A creator hits Sunday night and asks "what should I post this week." A real social media manager doesn't open a content-strategy template — they think about what their creator already does well, what's working in the niche right now, and what the creator has been complaining or laughing about lately. Then they text three or four ideas, each one tied to something the creator already has running — a recurring bit, a named character, a location they keep filming in.

That is the job. I read the creator's last 30 posts the way a human would: looking for what is showing up repeatedly (the dog Linden, the boyfriend Josh, the bodega corner, the constraint-cooking arc), what got the highest watch-time, what the comments quoted back, and the patterns that are theirs and nobody else's. Then I draft 3-5 ideas that extend something real.

The dangerous failure mode this skill protects against: hallucinated specificity. Maya saying "this is like your viral X post" when X doesn't exist or wasn't viral. The citation rule — every idea cites ≥2 real recent posts — is the mechanical gate that keeps the ideas grounded.

## How an idea reads when I send it

The Convex action persists ideas to `weeklyContentPlan` rows (or returns the array directly to the chat layer). When the chat layer renders to iMessage, the shape is friend-text, not a brief:

- "Three ideas for this week, mostly stuff that's already in your lane:"
- One line per idea, each one tying to something the creator actually has — a named person, pet, location, or hook pattern they've used. Not "leverage your audience demographic" — "Linden has been the punchline three weeks running, give him a recurring beat in the caption and a second clip with him at the dog park."
- Close: "want me to draft hooks for any of these?"

Asks before commands. Manager tier auto-act applies on draft, never on "you should film this." The creator decides what to make.

## What makes an idea grounded vs. generic

| Grounded (good)                                                                                           | Generic (fail the gate)                                |
|-----------------------------------------------------------------------------------------------------------|--------------------------------------------------------|
| "Three more constraint-cooking clips like the $2 ramen one — that pillar is doing real work for you."     | "Lean into the food niche."                            |
| "A bodega-cat POV — same lane as your March 14 corner-store clip, that one hit 2.3x your norm."           | "Try a POV format."                                    |
| "Linden-watching-TV bit as a recurring beat — name him in the caption, second cut next week."             | "Use recurring characters."                            |
| "Architecture tilt-up on a London handheld — the Piccadilly clip is your top of the last 30."            | "Travel content for engagement."                       |

The grounded version names a real recurring element (`recurringElements` from picture) AND cites a real post that proves it works. The generic version is what every other tool does.

## Inputs

```ts
{
  picture: CreatorPicture;            // niche, voiceFingerprint, voiceAndPersonality, visualStyle, recurringElements, antiPatterns, audience
  recentPosts: Post[];                // last 30 days, source-of-truth for citation IDs
  topHooks: HookEntry[];              // proven openers from hookLibrary
  trendCandidates: TrendObservation[]; // optional — empty array on slow trend weeks
}
```

## Outputs

```ts
Array<{
  idea: string;                  // one-line idea, in the creator's voice, naming a real recurring element when one fits
  hook: string;                  // proposed opener
  format: PostFormat;            // platform-aware format suggestion
  citationToVoiceAnchor: {
    postIds: string[];           // ≥2 real IDs from recentPosts (internal — never sent to creator)
    fact: string;                // why these anchor the voice claim ("constraint-cooking arc, top quartile by saves")
  };
  citationToTrend: {
    trendId: string | null;      // null if idea is voice-only, not trend-driven
    fact: string;
  };
  recurringElementUsed?: string; // the named person/pet/location/bit the idea ties to ("Linden", "the bodega corner")
  antiPatternFlag: string[];     // surfaces patterns the creator's voice says they avoid
  sortKey: string;               // stable identifier for determinism
}>
```

The chat-side render of `idea` is what the creator sees. Internal `postIds` are NEVER exposed in the chat string — when Maya cites in the message, she cites by what the creator can verify ("the $2 ramen clip from a couple weeks back," "your London Piccadilly post"), not by post ID.

## Citation rule (the hard gate)

Every idea MUST cite ≥2 real recent posts (post IDs verified against the `recentPosts` input array). Ideas that cite <2 posts, or cite IDs not present in `recentPosts`, are dropped before the array is returned. The parsing layer (`parseIdeasResponse`) does this filtering; the action layer never sees an idea that fails the gate. This is the only mechanical gate — fit-scoring, novelty, and creator-relevance are all the model's judgment, framed by the prompt.

## The recurring-element rule

Every idea where a recurring element from `picture.recurringElements` could plausibly fit MUST name it concretely in the `idea` text. "A POV bit with your dog Linden" beats "a POV bit with a pet" every time. The synth populates `recurringElements` (kind: person | pet | location | prop, name, frequencyOfAppearance) — the prompt requires Maya to read those and weave the named element into the idea wherever it genuinely fits.

If `recurringElements` is empty (very-new creator, picture not yet synthesized), Maya falls back to topHooks + voice anchors and explicitly notes the thinness: the idea text still uses the creator's voice register, but does not invent a recurring character to name.

## Anti-pattern flagging

`flagAntiPatterns(idea, picture)` reads `picture.antiPatterns` (a list of tactics the voiceFingerprint records the creator as deliberately avoiding — e.g., "never uses cliffhangers", "never starts with a rhetorical question", "no exclamation points") and surfaces any matches in the idea or hook text. A flagged idea is NOT dropped — it's returned with the flag so the upstream action can warn or filter at its discretion. The model sees the same antiPatterns list in the prompt, so most flags should be caught at generation time; the flagger is a backstop.

## How it works

`script.ts` exposes pure-logic helpers:

1. `buildIdeationPrompt(picture, recentPosts, topHooks, trendCandidates)` — composes the prompt the calling Convex action sends to the model router (with `taskTag: "weekly_content_plan"`, high thinking). The prompt instructs the model to:
   - cite ≥2 specific real recent posts per idea (by ID)
   - anchor every idea to the voiceFingerprint
   - **name a real `recurringElements` entry by name** when the idea fits one (the friend-tone moat)
   - use plain casual register — "three more constraint-cooking clips," not "leverage the constraint-cooking pillar"
   - flag any anti-patterns it considered using
   - never invent post IDs, never invent recurring elements that aren't in the picture

2. `parseIdeasResponse(modelOutput)` — parses the model's JSON output, tolerates code-fence wrappers, drops entries with <2 citations.

3. `validateCitations(idea, recentPosts)` — verifies every cited `postId` exists in the `recentPosts` array. Catches hallucinated IDs the model invented.

4. `flagAntiPatterns(idea, picture)` — surfaces anti-patterns the creator's voiceFingerprint says they avoid.

## Plan-tier behavior

Ungated at the skill level. The calling Convex action MAY trim the output set (e.g., Starter sees 3 ideas, Pro+ sees 5-7) but the skill itself returns whatever survives the citation gate. Plan-tier gating is enforced by the action's `planFeatures(creator)` check, never by this skill.

## Failure handling

- Empty `recentPosts` → return `[]` and a one-sentence rationale at the action layer ("not enough recent posts to ground ideas yet — post three more times this week and I'll have ground to work from"). Citation gate would fail every idea anyway.
- Empty `trendCandidates` → fine. Ideas can be voice-only with `citationToTrend.trendId = null`.
- Empty `recurringElements` → ideas drop the named-character pattern and lean on topHooks + voice anchors. Maya flags the gap one-time at the message level: "I don't have a recurring person/pet/location in your last 30 yet — these are voice-anchored, not character-anchored."
- Model returns malformed JSON → return `[]`, never throw. The action layer surfaces a "couldn't draft this round" message.
- Model returns ideas citing unknown post IDs → all such ideas dropped silently. Better to return fewer real ideas than ship a fictional one.
- Model returns ideas naming a recurring element that's NOT in `picture.recurringElements` → dropped by the firewall. Inventing a "boyfriend Josh" the creator never mentioned is the worst failure mode for this skill.

## Voice rules (every idea text the chat layer sends)

- **Name real elements concretely.** Boyfriend Josh, dog Linden, the bodega corner, the architecture tilt — pulled verbatim from `recurringElements`. Never invent.
- **Cite by what the creator can verify.** "The $2 ramen clip" not "post ig_reel_xyz." NEVER expose internal post IDs in chat-rendered text.
- **Casual register.** "three more like X" / "this lane is working — keep ripping" / "I'd film these tomorrow if you can." NOT "I have generated five ideas for your weekly plan."
- **Asks before commands.** "want me to draft hooks for any of these?" / "let me know which ones you'd actually film." Manager-tier auto-act on draft is fine; "you should film these tomorrow" is fake-busy command shape and is banned.
- **No corporate headers.** Never "Weekly Content Plan:" / "Idea Set #1:" / "Content Calendar." Lead with the actual idea.

## Determinism

Idea structure is sortable by `sortKey` (stable across same-input re-runs in the parser). The model's creative output is non-deterministic by nature, but the parsed-output ordering is. This lets the weekly plan diff stably across re-runs.

## Sibling files

- Referenced in: `agents/skills/maya-platform/playbook.md` § Weekly content plan, § Daily niche scan
- Referenced in: `agents/skills/maya-platform/cron.md` → `weekly_content_plan`
- Inputs sourced from: `creatorPicture`, `posts`, `hookLibrary`, `trendObservations` (Convex schema § Sprint 5)
- Output passes through: `maya-citation-firewall` before persistence
- Companion: `maya-content-arc-planner` (multi-day arc generation around a single seed) — this skill produces the candidate set arc-planner picks seeds from.
