---
name: maya-reddit-demand-researcher
description: Find Reddit buyer intent for the product's pain — surface reply targets ranked by purchase signal, map the live comment tree for follow-up questions, return promotion-risk score. Budget-bounded.
---

# maya-reddit-demand-researcher

## Purpose

Reddit is the highest-conversion buyer-intent channel for indie products IF the operator is a real participant. This skill finds threads where a buyer is actively describing the product's pain and seeking a solution, subreddits where those buyers concentrate, and reply-mining opportunities ranked by purchase-conversion potential — not vanity metrics. It refuses to recommend Reddit when warmup math doesn't work.

## When to invoke

- IF channel-judge is considering Reddit (primary or secondary) THEN run.
- IF `icpHypotheses[].locatableOn.channel === "reddit"` THEN run.
- IF the operator says "let me post on Reddit" THEN run BEFORE drafting.
- IF a results-reviewer flags a Reddit post got removed THEN re-run to find a different sub.
- NEVER from heartbeat. Each invocation spends up to 8 `research_reddit` / `research_reddit_comments` calls.

## Required reads

1. `APP.md`, `GTM.md`.
2. PLAYBOOK.md § 1, § 3 (channel tree steps 4-7), § 4 (BUILD/ENGAGE/OFFER — Reddit is 10/80/10).
3. **playbook/reddit.md — MANDATORY full read.** Every decision must trace to a numbered rule in § 8.
4. MEMORY.md for prior Reddit attempts.

## Decision rules

1. **Warmup gate (reddit.md § 8.1).** IF `operator.reddit.accountAgeDays < 30` OR no recent comment history THEN return `recommendation: "warmup_first"`. No reply targets surfaced.
2. **Karma floor (§ 8.2).** IF karma in best-fit niche sub < 10 THEN add precondition: "5-10 helpful comments in {sub} first."
3. **Domain age check (§ 8.14).** IF `app.domain` < 30 days old THEN `domainRiskElevated: true`.
4. **Subreddit selection.** 2-3 candidate subs per ICP. From reddit.md § 1 or niche subs the founder already participates in. NEVER recommend r/marketing, r/programming, r/technology, r/AskReddit for product mention (§ 8.12).
5. **Funnel-stage tagging.** Awareness / consideration / decision per reddit.md § 1. Decision-stage subs (r/Notion, r/Obsidian) are reply-only.
6. **Subreddit evidence floor.** A sub is only worth recommending if there is genuinely enough buyer-pain signal to justify sending the operator there — judge by whether the found threads contain people actively describing the product's exact problem and seeking a solution, not by a raw count. If the first page of results is thin or stale, search deeper until you can make a confident judgment; stop when you are confident, not at a fixed page limit.
7. **Reply-target quality bar.** Threads where (a) the thread still feels alive — OP is still responding, new comments are arriving, the conversation has not gone cold — (b) OP or a commenter asked a pain-related question, and (c) the product is a credible answer within one degree of fit. § 4 + § 8.10. A recent-but-dead thread is theater; deprioritize it. Before surfacing any thread as a reply target, check whether the post or its key comments were removed by moderators; a removed thread is a wasted reply — tier it down or drop it.
8. **r/SaaS 60-day clock.** IF recommending r/SaaS main-feed THEN flag the cost and recommend weekly feedback thread unless operator's narrative is unusually strong.
9. **r/IndieHackers SHOW IH one-shot.** Only if `app.stage === "shipped"` AND operator has a metric/testimonial.
10. **Live-product check (§ 8.9).** IF `app.stage === "pre-launch"` AND only waitlist exists THEN remove r/SideProject from candidates. Substitute r/AlphaAndBetaUsers.
11. **Cross-post block (§ 8.7).** No same post in >2 subs in a week. Rewrite each for sub culture or stage 7+ days apart.
12. **First-comment URL rule (§ 8.8).** For r/SaaS / r/startups / r/Entrepreneur, URL goes in the first comment, not the post body.
13. **Style-exemplar capture (native-voice fidelity — Sprint I).** While mining each recommended sub, capture **5-10 real, top-performing, HUMAN-written native posts/comments verbatim** from that exact sub — the kind that actually landed there (high upvotes/engagement, written by a real participant, not removed, not an obvious ad or bot). These become few-shot **voice/register anchors** for `maya-voice-matcher` and the drafting step: they encode the cadence, vocabulary, length, formality, and format a real member of *this sub* uses. The point is to match how natives write, NOT to copy what they wrote — **never reuse their content, angle, or specifics.** Skip any post that itself reads templated/AI. Emit in `styleExemplars[]`. The honest framing: there is no platform AI-detector to beat; the enemy is generic content that mods remove and the community ignores. Exemplars make the founder's reply read like it belongs here.
14. **Reddit caption craft — the title IS everything (reddit.md).** On Reddit the post title carries the entire click decision; body is secondary. When proposing any post (not reply) target, the title must read like a real human asking/sharing in this sub: lowercase-friendly where the sub is, no hype-jargon, no emoji, no "Excited to announce," curiosity or concrete-specific over clickbait. For replies, the first line is the title-equivalent — it has to earn the read before the fold. Surface title guidance in `captionCraft`.

## Output schema

```ts
interface RedditDemandReport {
  recommendation: "go" | "warmup_first" | "park";
  warmupPlanWeeks?: number;
  warmupActions?: string[];
  candidateSubs: Array<{
    name: string;
    funnelStage: "awareness" | "consideration" | "decision";
    rationale: string;
    rulesCited: string[];
    karmaRequired: number | "unstated";
    postFreqCap: string;
    flairRequired: string | null;
    evidenceThreadCount: number;
  }>;
  evidenceCards: Array<{
    threadUrl: string;
    sub: string;
    title: string;
    ageHours: number;
    buyerIntentSignal: string; // why this counts as buyer intent — active problem-seeker, not just a lurker
    painSnippet: string;      // VERBATIM quote from the thread
    productFit: "direct" | "adjacent" | "weak";
    threadAlive: boolean;     // OP still responding / new comments arriving
    modRemoved: boolean;      // post or key comments removed by mods
  }>;
  replyTargets: Array<{
    threadUrl: string;
    sub: string;
    opQuestion: string;
    buyerIntentRationale: string; // why this person is likely a buyer, not just curious
    conversionPath: string;       // honest, non-spammy path to try the product that fits the reply context
    suggestedFramework: "been-there-done-that" | "counterintuitive" | "tactical-playbook" | "tool-neutral-recommendation" | "quiet-authority";
    mentionRecommended: boolean;
    /** The actual reply text, in the operator's voice, ready to paste.
     *  Reddit replies have no separate caption layer — the first line is
     *  the hook. Lead with empathy / answer the ask / soft product mention
     *  only if it genuinely fits (URL per § 8.8 first-comment rule) / end
     *  with a follow-up question. This is what gets saved via
     *  save_draft, not returned for Maya to write later. */
    draftReply: string;
    /** When the highest-value reply target is a COMMENT, not the OP.
     *  Populated when comment-tree mining finds a follow-up question
     *  the OP never answered and the product addresses directly —
     *  highest-intent target in the thread. Drives "reply to that
     *  comment's question, not OP's" routing. */
    commentReplyTarget?: {
      commentId: string;
      author?: string;
      excerpt: string;
      whyHigherIntent: string; // why this comment beats the OP as a reply target
    };
  }>;
  /** Per-thread full comment-tree intel. Maya descends the entire
   *  comment tree — including nested replies — before declaring a
   *  reply target. The sharpest buyer language (pain restated in
   *  visceral terms, competitor named, workaround rejected) and the
   *  highest-intent follow-up questions routinely sit deeper than the
   *  top-voted comments. The morning_brief uses this to pick the
   *  single best reply target across (a) the OP question and (b) the
   *  best mineable comment deeper in the tree. */
  commentMining: Array<{
    threadUrl: string;
    minedComments: Array<{
      commentId: string;
      author?: string;
      body: string;
      nestingDepth: number;  // 0 = top-level, 1 = reply to top-level, etc.
      kind: "buyer_intent" | "pain_restatement" | "competitor_mention" | "op_rejection" | "high_velocity";
      competitorName?: string;
      whyMineable: string;
    }>;
  }>;
  promotionRiskScore: 0 | 1 | 2 | 3 | 4 | 5;
  riskFlags: string[];
  domainRiskElevated: boolean;
  /** 5-10 real, top-performing, HUMAN-written native posts/comments captured
   *  VERBATIM from the recommended subs — the few-shot voice/register anchors
   *  maya-voice-matcher + drafting use to make the founder's reply read native
   *  to THIS sub. Match cadence/vocab/length/format; NEVER copy content.
   *  This array is the shape of your thinking; it LANDS via the REQUIRED
   *  save_style_exemplars({ channel: "reddit", styleExemplars: [...] }) call
   *  (see the Save section) — described-but-unsaved = lost. */
  styleExemplars: Array<{
    sub: string;
    url: string;
    kind: "post" | "comment";
    verbatim: string;           // the real native text, unedited
    whyExemplary: string;       // why this reads like a real member of this sub (cadence, register, format)
    upvotesOrSignal: string;    // engagement / standing signal that it landed here
  }>;
  /** Reddit caption craft: the title is the whole click decision. */
  captionCraft: {
    titleConvention: string;    // how titles read in THIS sub (case, length, curiosity vs concrete, jargon tolerance)
    titleAntiPatterns: string[];// e.g. emoji-in-title, hype-jargon, "Excited to announce"
    firstLineGuidance: string;  // for replies: the title-equivalent first line that earns the read
  };
  parkReasons?: string[];
}
```

## How you deliver — call the tool per item, don't just return a report

When invoked as a Phase-2 demand worker (the first-wake actionable pass), you own each reply target end to end — you do NOT hand a `RedditDemandReport` back for Maya to act on later. You HAVE the typed tools (`save_target_thread`, `save_draft`, `research_reddit`, `research_reddit_comments`, …) — call them directly; a finding you describe in text but never save is lost. For EACH `replyTarget` worth a reply, in its own item loop:

1. `save_target_thread({ url, externalId, platform, title, excerpt, currentMetrics, subredditOrCommunity, recommendedAction, painQuote: <verbatim>, velocityScore, priorityScore })` → returns a targetThreadId.
2. Compose `draftReply` in the operator's voice per the rules above (first line earns the read; § 8.8 first-comment URL rule).
3. `save_draft({ kind: "reply", platform: "reddit", targetThreadId, draftText: <draftReply> })`.
4. `save_target_thread({ externalId: <same>, draftReply })`, to keep the row's one-tap deep link in sync.

One self-contained tool sequence per thread — the same per-item discipline that makes the foundation strategy saves reliable. An `OK ...` return = it landed. The `RedditDemandReport` schema above stays the shape of your *thinking* per target; the tool calls are how it lands. Exact sequence: `maya-foundation-research` Phase 2.

### REQUIRED before you return — land the ICP knowledge + voice anchors (once per run)

These two saves are what make the daily cron and the drafting step work. They are not optional extras; a run that surfaces reply targets but skips them has left the channel scorecard incomplete.

5. **`save_style_exemplars({ channel: "reddit", styleExemplars: [ … 5-10 verbatim native posts/comments … ] })`** — REQUIRED. The verbatim native posts you captured in decision rule 13 anchor `maya-voice-matcher` Anchor B; **skip this and every later Reddit draft defaults to generic LLM tone** that mods remove and the sub ignores. Pass each as `{ platform: "reddit", community: <sub>, verbatim, why, capturedAt }`. This is the persisted form of the `styleExemplars[]` schema above — the schema is your thinking; this call is how it lands.
6. **`save_foundation_channel_scorecard({ channel: "reddit", …, icpKnowledge: { venues, watch, complaints, topics, nativeStyle } })`** — REQUIRED for a bet channel. Populate per-channel `icpKnowledge`: `venues` (the recommended subs as `{ name, kind: "subreddit", url, whyHere }`), `watch` (what these buyers read/follow), `complaints` (verbatim pain `{ quote, sourceUrl }` from the threads you mined), `topics` (what they talk about), and `nativeStyle` (`{ exemplars: [{quote,sourceUrl}], cadenceNotes, vocab }`). A Reddit bet with empty `icpKnowledge` is an incomplete scorecard — the morning cron reads this stored knowledge instead of re-deriving the ICP.

## Failure modes

- **No evidence threads found.** Park. Surface to channel-judge.
- **All candidate subs are decision-stage.** Return `replyTargets` only, `recommendation: "go"` constrained to reply-only.
- **`research_reddit` / `research_reddit_comments` fails.** Return the tool's `FAILED ...` status; do NOT degrade to training-data recommendations.
- **Domain blacklist detected.** `domainBlacklisted: true` + recommend domain change (reddit.md § 6).

## Comment-tree mining (mandatory for every replyTarget)

For each thread in `replyTargets` (and any direct/adjacent `evidenceCard`), Maya descends the **full** comment tree — including all nested reply chains — before declaring the reply target. Do not stop at top-level comments. The sharpest buyer language and the highest-intent follow-up questions routinely sit in nested replies that never bubbled to the top.

1. **Fetch the comments.** Call `research_reddit_comments({ url })` for the full tree. If the thread is large, go as deep as needed until you are confident you have seen all subtrees that could contain the five mining kinds below.
2. **Mine the full tree** against the 5 kinds at every nesting level:
   - `buyer_intent` — a commenter asked a follow-up question that the product directly answers and that OP never addressed. This is typically the **highest-intent reply target in the thread** because the person is still actively seeking a solution. Note the nesting depth; a question buried three levels deep that went unanswered for days is a better target than a top-level comment that already has five replies.
   - `pain_restatement` — a comment that re-articulates the buyer's pain in sharper, more visceral language than OP did. Mine the VERBATIM phrasing; it becomes the lede of the drafted reply.
   - `competitor_mention` — a commenter names a specific competitor or alternative ("I've been using ToolX but it keeps breaking because…"). Set `competitorName`. Drives differentiation angle in the draft.
   - `op_rejection` — OP (or another commenter) explicitly said a class of solution "didn't work" or "I already tried X." Flags what NOT to recommend in the reply.
   - `high_velocity` — a comment that has gathered unusual traction relative to the thread's typical engagement pace and its own age, judged by whether it reads as a thread that is actively heating up right now, not just one that happened to be posted recently.
3. **Emit `commentMining[]`** with the scored comments including `nestingDepth`, AND populate `commentReplyTarget` on the corresponding `replyTarget` entry when the best reply target is a comment, not OP.
4. **Follow-up-question routing.** When a `buyer_intent` comment surfaces an unanswered question, that comment — not OP's original post — becomes the primary reply target. Surface this clearly in `commentReplyTarget.whyHigherIntent`.

Skipping full-tree descent on direct/adjacent threads is a failure — `maya-continuous-research` will steer the worker to re-run mining before accepting the output.

## Cost discipline

Max 8 `research_reddit` calls: 3 × subreddit/search, 2 × general search, 2 × subreddit details, 1 reserve. Comment-tree mining adds 1 `research_reddit_comments` call per thread that gets to T1/T2 (typically 2-3 threads per run, so +2-3 calls). 1 main_maya synthesis. Timeout 20 min.

## Anti-slop check

- `painSnippet`, `opQuestion`, and every `body` in `commentMining` are VERBATIM from Reddit. Do not paraphrase. Quote and link.
- `buyerIntentRationale` must state specifically why this person is likely a buyer seeking a solution — not just "they mentioned the topic." If you cannot articulate a purchase-intent signal, drop the thread.
- `conversionPath` must be honest and non-spammy: a way to mention the product or offer a trial that fits naturally in a helpful reply. "Link in bio" or naked URL dumps are not acceptable.
- `whyHigherIntent` on `commentReplyTarget` must explain concretely why that comment beats OP as a reply target — e.g., "OP's question was answered; this nested reply from 3 days later is still unanswered and directly names the product's pain."
- Never surface a thread as a reply target and leave `modRemoved: true` without explicitly flagging it to the caller as low-priority.
- `styleExemplars[].verbatim` is captured VERBATIM as a voice/register reference only. Downstream drafting matches cadence/vocab/length/format — it must NEVER copy an exemplar's content, angle, or specifics. Drop any exemplar that itself reads templated or AI-written; it can't anchor native voice.
