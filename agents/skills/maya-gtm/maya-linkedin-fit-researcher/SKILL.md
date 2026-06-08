---
name: maya-linkedin-fit-researcher
description: Decide whether LinkedIn is the right channel per playbook/linkedin.md LI-1.1 - LI-1.3 + LI-10.2. Refuse if rule LI-10.2 applies.
---

# maya-linkedin-fit-researcher

## Purpose

LinkedIn is the right channel for a narrow slice of indie products — B2B SaaS, ops/marketing/HR/sales/finance buyers, mid-market ACV, narrative-writing founder — and the wrong channel for most. This skill runs the fit check, refuses when criteria don't hold, and — when LinkedIn is a fit — proposes the doc-carousel-first launch shape oriented around buyer conversations, not visibility metrics.

## When to invoke

- IF channel-judge is considering LinkedIn THEN run.
- IF operator says "I want to post on LinkedIn" AND product is consumer/dev-tool/sub-$500-ACV THEN run specifically to refuse with a cited rule.
- IF `icpHypotheses[].locatableOn.channel === "linkedin"` THEN run.
- NEVER recommend LinkedIn ads in V1 (linkedin.md LI-7.1, PLAYBOOK rule 9.21).

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 step 5 (LinkedIn primary conditions), § 4 (40/50/10), § 7 affinity.
3. **playbook/linkedin.md — MANDATORY full read.** Cite LI-* rules.
4. MEMORY.md.

## Decision rules

1. **LI-1.1 channel-tree gate.** Run PLAYBOOK § 3 first. LinkedIn-primary only when steps 4-5 explicitly route there.
2. **LI-10.2 hard refuse.** IF product is indie consumer / dev tool / API / product whose buyer doesn't live on LinkedIn professionally THEN `fit: "park"`, `refusalReason: "LI-10.2 — wrong audience composition"`. Do not soften.
3. **LI-10.3 writing-style gate.** IF operator cannot write substantively in their own voice — clearly, with specific detail, without corporate padding — THEN `fit: "secondary_with_caveat"` and recommend X-first. Length is not the test; voice and specificity are.
4. **ACV fit judgment.** Use ACV as a signal, not a cutoff formula. LinkedIn earns its way when the buyer is a professional making a deliberate purchase decision and your product touches something they're accountable for at work. Very low-cost impulse buys don't belong here; high-ACV enterprise deals belong in outbound, not content. Judge where this product falls on that spectrum.
5. **LI-10.4 launch format judgment.** Document carousel + personal narrative caption is the default launch shape because it earns reach natively and lets a non-technical buyer follow the story without clicking away. Choose this format when the story has enough texture to fill 8-12 slides without padding. If it doesn't, a long-form text post is better than a thin carousel. Format follows the story, not the other way around.
6. **LI-10.5 anti-announcement.** Reframe every launch as a "thinking-process" post per linkedin.md § 4. "Excited to announce" → rewrite.
7. **LI-10.6 engagement-bait closer ban.** No "Agree?" / "What do you think?" / "Like if this resonates."
8. **LI-10.7 follower-flip.** IF the operator has a small following THEN 1 original post/week + meaningful comment-mining time on large-account niche posts. Comment-mining is often more valuable than original posts at this stage; weight it accordingly.
9. **LI-10.8 comment-mining freshness.** Prefer posts where the reply window is still open — where the original post is actively circulating and a thoughtful comment still gets surface area. Judge freshness by whether the post is still getting new activity, not by a fixed clock window.
10. **LI-10.9 newsletter gate.** Only if operator already writes long-form monthly+ elsewhere.
11. **LI-10.11 60-day reweight.** IF leads but zero conversions at 60 days AND runway <6 months THEN `reweightToFasterChannel: true`.
12. **LI-10.14 link-in-first-comment.** Any draft URL moves to first comment.
13. **Style-exemplar capture (native-voice fidelity — Sprint I).** While mining large-account niche posts, capture **5-10 real, top-performing, HUMAN-written native LinkedIn posts verbatim** from this buyer's professional niche — substantive, voiced posts that earned real reach and *buyer* engagement (not broetry, not engagement-bait, not corporate-announcement slop). These are few-shot **voice/register anchors** for `maya-voice-matcher` + drafting: they encode how a credible person in *this professional niche* actually writes here — hook openers, paragraph rhythm, where they get specific, how they close without "Agree?". LinkedIn is the slop epicenter, so be ruthless: skip any exemplar that itself reads templated/AI/broetry. Match cadence/vocab/length/format; **never copy content.** Emit in `styleExemplars[]` — then, when fit is not park, land them via the REQUIRED `save_style_exemplars({ channel: "linkedin", styleExemplars: [...] })` call (see the Save section).
14. **LinkedIn caption craft — hook + "link in first comment" (linkedin.md § 4 / LI-10.14).** The first line is a scroll-stopping hook (a specific tension or concrete claim, never "Excited to announce"). The body is a thinking-process narrative a non-technical buyer can follow without clicking away. The URL/CTA lives in the **first comment**, not the post — the post itself never reads like an ad. No engagement-bait closer. Surface this in `captionCraft`.

## Comment-target qualification

When mining comments on large-account niche posts for reply targets, the goal is a buyer conversation that can convert — not visibility. Apply this filter:

**Keep a comment if the author signals:**
- A tool, stack, or process they're currently running ("we use X for this", "switched from Y to Z", "our team does it manually")
- A real pain they're sitting in ("biggest headache is…", "this cost us three weeks", "still haven't solved…")
- A budget constraint or buying context ("too expensive for early stage", "looking for something cheaper than X", "evaluated Y but…")
- A job title or company context that matches the buyer ICP — especially if their profile shows they're the decision-maker or primary user for the problem domain

**Reject a comment if it:**
- Is pure engagement bait ("Great point!", "So true!", "This is gold", "Saving this")
- Affirms the post without adding any signal about their own situation
- Is self-promotional about a competing product
- Is from a creator/influencer account with no buying context

The goal is: find someone who already has the problem, knows they have it, and is one good conversation away from looking for a solution. If the comment doesn't suggest that, skip it.

**Depth and freshness:** Fetch comments newest-first and go deep enough to find buyer-language ones. Don't stop at the top 10 comments — those are usually the loudest voices, not the buyers. On posts that are actively circulating, a thoughtful reply gets real surface area. Judge freshness by activity signal (are people still replying?), not the timestamp alone. A 4-hour-old post that's still getting comments is a better target than a 30-minute post that went cold.

**Author company/industry as a buyer-fit signal:** When a comment author's profile shows company size, industry, or role that matches the ICP — note it as a fit signal. A mid-market ops manager at a 50-person SaaS company commenting on a post about process chaos is more valuable than a solo consultant saying the same words. Use this as judgment, not a filter.

## Output schema

```ts
interface LinkedInFitReport {
  fit: "primary" | "secondary" | "secondary_with_caveat" | "park";
  refusalReason?: string;
  acvFitJudgment: {
    buyerType: string;        // how you're characterizing the buyer and their purchase context
    linkedInFitReason: string; // one-sentence judgment on whether that buyer lives on LinkedIn
    passes: boolean;
  };
  writingStyleCheck: {
    capableOfVoicedLongForm: boolean;
    evidence: string;         // specific signal from APP.md or operator history
  };
  recommendedLaunchShape?: {
    format: "doc_carousel" | "long_form_text_post" | "native_video";
    formatJustification: string;  // why this format fits the story and audience
    caption: { type: "personal_narrative"; openingPattern: string };
    cta: "link_in_first_comment";
  };
  commentTargets: Array<{
    postUrl: string;
    authorHandle: string;
    authorTitle?: string;      // job title if visible
    authorCompanySize?: string; // signal of buyer fit
    authorIndustry?: string;
    commentExcerpt: string;
    buyerLanguageSignal: string;  // what specifically makes this a buyer signal
    icpMatch: string;             // how this person maps to the buyer ICP
    postStillActive: boolean;     // is the post still getting new activity?
    suggestedCommentDraft: string;
    conversionPath: string;       // what's the realistic next step — DM, reply thread, profile visit?
  }>;
  postingCadence: { originalPostsPerWeek: number; commentMiningMinPerDay: number };
  /** 5-10 real, top-performing, HUMAN-written native LinkedIn posts captured
   *  VERBATIM from this professional niche — the few-shot voice/register anchors
   *  for maya-voice-matcher + drafting. NOT broetry/engagement-bait/announcements.
   *  Match cadence/vocab/length/format; NEVER copy content. */
  styleExemplars: Array<{
    postUrl: string;
    authorHandle: string;
    verbatim: string;
    whyExemplary: string;          // why this reads like a credible voiced person in this niche
    buyerEngagementSignal: string; // evidence it earned real (buyer, not vanity) engagement
  }>;
  /** LinkedIn caption craft: hook + thinking-process body + link in first comment. */
  captionCraft: {
    hookConvention: string;        // how the scroll-stopping first line reads (specific tension / concrete claim)
    bodyShape: string;             // thinking-process narrative, non-technical-buyer-readable
    ctaPlacement: "link_in_first_comment";
    antiPatterns: string[];        // broetry, "Excited to announce", "Agree?" closers, AI-emoji bullets
  };
  rulesCited: string[];
  reweightFlag?: boolean;
}
```

## Save — land the ICP knowledge + voice anchors (REQUIRED when fit is not park)

When `fit` is `primary` / `secondary` / `secondary_with_caveat` (LinkedIn cleared as a bet), two saves are REQUIRED before you return — the `LinkedInFitReport` schema is the shape of your thinking; these calls are how it lands:

1. **`save_style_exemplars({ channel: "linkedin", styleExemplars: [ … 5-10 verbatim native LinkedIn posts … ] })`** — REQUIRED. The verbatim native posts you captured in decision rule 13 anchor `maya-voice-matcher` Anchor B; **skip this and every later LinkedIn draft defaults to generic LLM tone** (the broetry/announcement slop LinkedIn is the epicenter of). Pass each as `{ platform: "linkedin", community: <niche>, verbatim, why, capturedAt }`. This is the persisted form of the `styleExemplars[]` schema above — described-but-unsaved = lost.
2. **`save_foundation_channel_scorecard({ channel: "linkedin", …, icpKnowledge: { venues, watch, complaints, topics, nativeStyle } })`** — REQUIRED for a bet channel. Populate per-channel `icpKnowledge`: `venues` (the niche's large accounts/communities you mined as `{ name, kind: "account", url, whyHere }`), `watch` (the trusted professional voices), `complaints` (verbatim buyer pain `{ quote, sourceUrl }` from the comment targets), `topics` (what this professional buyer discusses), and `nativeStyle` (`{ exemplars: [{quote,sourceUrl}], cadenceNotes, vocab }` — credible-voiced, no-broetry register). A LinkedIn bet with empty `icpKnowledge` is an incomplete scorecard — the morning cron reads this stored knowledge instead of re-deriving the ICP. (When `fit: "park"`, skip both — there is no bet to score.)

## Failure modes

- **Operator insists LinkedIn for consumer app.** `fit: "park"` + cited refusal + one-sentence alternative. Document override but don't silently comply.
- **No buyer-language comment targets found.** Return empty `commentTargets` with an explicit note that the comments mined were engagement-bait, not buyer signals. Recommend mining a different set of posts — ones closer to the pain domain, not the founder/indie-hacker audience. Do not pad the list with non-buyer comments just to have something to show.
- **ScrapeCreators LinkedIn endpoints fail.** Try `/v1/linkedin/company` + `/v1/linkedin/company/posts`. If both fail, downgrade to `fit: "secondary_with_caveat"`.
- **Author profile data unavailable.** If company/industry/title is not visible, note the absence and weight the buyer-language signal alone. Don't reject the target just because profile metadata is missing — strong buyer language stands on its own.

## Cost discipline

Max 4 ScrapeCreators calls. 1-2 WebFetches. 1 main_maya call. Timeout 12 min.

## Anti-slop check

LinkedIn is the slop epicenter. Every `suggestedCommentDraft` and `caption.openingPattern` MUST pass `maya-slop-critic` — including its structural AI-tell pass (tidy tricolons, "it's not X it's Y", em-dash cadence, uniform rhythm, no-stance hedging) — with LinkedIn-specific bans (linkedin.md § 9): no broetry overuse, no "thrilled/excited/honored", no tagged-friend humblebrag, no engagement-bait closers, no AI-emoji bullet lists. `styleExemplars[].verbatim` is a voice reference only — never copy content; drop any exemplar that itself reads broetry/AI.
