---
name: maya-content-format-miner
description: Extract reusable hook patterns, proof beats, CTA patterns from real competitor / niche content. Output is a remix kit for drafts.
---

# maya-content-format-miner

## Purpose

Don't write content from scratch. Mine what's already winning in the niche, extract the format skeleton, remix the operator's product into it (tiktok.md § 7 "format remix doctrine"). Emits hook templates + proof-beat structures + CTA patterns that downstream draft skills consume. NEVER ships final copy — that's the operator + slop-critic loop.

Winning means buyer conversation, not engagement theater. A pattern that generates "great post!" replies is worthless. A pattern that generates "where do I sign up" or "I've been struggling with exactly this — what's your process?" is gold. Every extraction decision flows from that distinction.

## When to invoke

- IF channel-strategy-judge has picked a primary channel THEN run to seed the draft library.
- IF results-reviewer detects a winning format AND recommends doubling down THEN re-run for more examples.
- IF a draft fails slop-critic 3x THEN re-run — operator's voice isn't matching the format used.
- NEVER from heartbeat.

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 4 (BUILD/ENGAGE/OFFER), § 6 (anti-slop — patterns that read AI get rejected on extraction).
3. playbook/{channel}.md hook catalogs (x.md § 5, tiktok.md § 2, reddit.md § 3, linkedin.md § 3).
4. MEMORY.md.

## Decision rules

1. **Buyer-conversation validation over example count.** Before a pattern enters the library, judge whether its real example threads generated buyer conversation: replies that ask "how does this work", "where can I try this", "I have this exact problem" — or DM floods, "link in comments?" signals. A handful of examples that provably generated buyer conversations beats many examples that generated vanity praise. Vanity patterns ("this is so good!" "fire content!") are explicitly rejected regardless of how many examples exist.

1a. **Recency + velocity — what's converting THIS WEEK, not all-time (applies to TEXT channels too, not just TikTok).** Formats decay; a pattern that crushed six months ago is often dead now. Prefer patterns whose winning examples are RECENT (last ~1-2 weeks) and whose engagement velocity is still *rising*, not patterns that peaked long ago. This is the TikTok format-recurrence rigor — "which exact format is provably winning right now" — ported to Reddit / X / HN / LinkedIn: a reply structure or post shape that's converting in the niche *this week* beats a timeless-looking template with stale examples. Tag each pattern's `freshness` (how recent its winning examples are) + a velocity read. When a pattern is hot right now, say so — that's the one to draft against first.

1b. **The product twist is MANDATORY — ProductDiagnosis × format (every pattern must carry it).** A mined format is only useful once it's been remixed onto THIS product. For every pattern, read the `ProductDiagnosis` (from maya-app-inspector: promise / activation moment / wedge vs incumbents) and produce a `productTwist`: the specific way this product slots into the format — its activation moment as the proof beat, its wedge as the hook's angle. A pattern with no credible product twist is NOT usable; drop it. This is what makes a draft *theirs* and not generic format-cloning: the winning shape carries the product's real "aha", not a hollow plug. Downstream drafting REQUIRES the twist — a draft that just clones the format without the product twist fails.
2. **Verbatim hook capture.** Hooks recorded verbatim with source URL. No paraphrase, no "improved" version.
3. **Anti-slop on extraction.** Reject candidates that depend on banned phrases (PLAYBOOK § 6) or anti-pattern structures.
4. **Pattern-mode tagging.** Tag each: BUILD (post-shaped) / ENGAGE (reply-shaped) / OFFER (CTA-shaped).
5. **Channel-specific hook taxonomy.** Use the channel's own catalog (x.md § 5 1-15, tiktok.md § 2 a-j, reddit.md § 3, linkedin.md § 3).
6. **Proof beats separately from hooks.** A proof beat is a specific concrete claim ("$10K MRR in 3 weeks") — extract as substitution-slots.
7. **CTA taxonomy.** Catalog: search-by-name / pinned-URL-comment / DM-keyword / soft-DM / link-in-first-comment. Tag channel compatibility.
8. **Voice-fingerprint from reply threads, not just polished posts.** The real voice fingerprint lives where niche winners defend, clarify, or follow up in replies — not in the highly-edited top-level hook. Mine reply threads: how do they explain themselves when challenged? How do they handle "this doesn't work for me"? How do they follow up with someone interested? That's the authentic rhythm, sentence length, and vocabulary that built their audience. Capture it from replies, not just the hook post.
9. **Mimicry concentration judgment.** If most of the niche patterns trace back to one or two accounts, flag `mimicryRisk: "high"` and note who dominates. Don't gate on a fixed percentage — judge whether the pattern diversity is real or essentially one person's format spread across reposts.
10. **No final-copy generation.** Patterns + slots + examples, never final drafts.
11. **Style-exemplar capture (native-voice fidelity — Sprint I).** Separate from hook templates, capture **5-10 real, top-performing, HUMAN native posts verbatim** for the chosen channel — whole posts/replies that read like a real participant wrote them, not just extractable hook skeletons. These are few-shot **voice/register anchors** for `maya-voice-matcher` + drafting (cadence, vocabulary, length, format, how natives open and close). Distinct from `hookPatterns[].realExamples` (which prove a *pattern* won): exemplars are full-text register references. Match cadence/vocab/length/format; **never copy content.** Skip anything that reads templated/AI. Emit in `styleExemplars[]`. Honest framing: no platform AI-detector to dodge — the enemy is generic content the community ignores and the algorithm starves.
12. **Caption-craft per channel (Sprint I).** Roll up the channel's caption conventions into `captionCraft` so drafting has them inline. Encode each platform's native craft where relevant to the chosen channel: **TikTok** hook-line + small native hashtag set; **Instagram** story-shaped caption + one CTA; **YouTube** title = the CTR lever (curiosity/specific, front-loaded) + a description that does light SEO and carries the link; **Reddit** the title is everything; **X** the post text IS the caption; **LinkedIn** hook first line + link in first comment. Draw conventions from the captured exemplars, not generic advice.

## Output schema

```ts
interface ContentFormatLibrary {
  channel: string;
  hookPatterns: Array<{
    patternId: string;
    name: string;
    catalogRef: string;
    mode: "BUILD" | "ENGAGE" | "OFFER";
    template: string;
    slots: string[];
    realExamples: Array<{
      url: string;
      verbatim: string;
      metrics: { likes?: number; views?: number; replies?: number };
      buyerConversationEvidence: string;    // what happened in the replies — buyer questions, DM floods, etc.
      vanitySignal: boolean;                // true if replies were primarily praise with no buyer signal
    }>;
    voiceFingerprint: string;               // captured from reply threads, not just the hook post
    voiceFingerprintSource: string;         // url(s) of reply threads where this fingerprint was drawn from
    buyerConversionJudgment: "strong" | "moderate" | "vanity" | "unknown";
    // S8 — recency/velocity: is this pattern winning RIGHT NOW, or stale?
    freshness: "hot_this_week" | "recent" | "stale";  // recency of the winning examples
    velocityNote: string;                   // is engagement on the examples still rising, or peaked-and-cooled?
    // S8 — the mandatory product twist (ProductDiagnosis × this format).
    productTwist: string;                   // how THIS product slots in — activation moment as proof beat, wedge as the angle. Required; a pattern without one is dropped.
  }>;
  proofBeats: Array<{ beatId: string; template: string; slots: string[]; realExamples: Array<{ url: string; verbatim: string }> }>;
  ctaPatterns: Array<{
    ctaId: string;
    template: string;
    channelCompatibility: { x: boolean; reddit: boolean; tiktok: boolean; linkedin: boolean; instagram: boolean };
    bannedOn?: string[];
  }>;
  rejectedPatterns: Array<{ reason: "vanity_engagement" | "slop_phrase" | "mimicry_concentration" | "banned_phrase" | "other"; description: string; exampleUrl?: string }>;
  mimicryRisk: "low" | "medium" | "high";
  mimicryNote?: string;                     // who dominates if mimicryRisk is medium/high
  /** 5-10 real, top-performing, HUMAN native FULL posts/replies captured VERBATIM
   *  for this channel — the few-shot voice/register anchors for maya-voice-matcher
   *  + drafting (distinct from hookPatterns.realExamples, which prove a pattern).
   *  Match cadence/vocab/length/format; NEVER copy content.
   *  This array is the shape of your thinking; it LANDS via the REQUIRED
   *  save_style_exemplars({ channel: <this.channel>, styleExemplars: [...] }) call
   *  (see the Save section) — described-but-unsaved = lost. */
  styleExemplars: Array<{
    url: string;
    verbatim: string;
    whyExemplary: string;                   // why this reads native to the channel/niche
    landedSignal: string;                   // engagement / standing that shows it landed
  }>;
  /** Per-channel caption conventions rolled up for inline use by drafting. */
  captionCraft: {
    channel: string;
    convention: string;                     // the channel's caption craft (e.g. YouTube title=CTR lever + SEO description; Reddit title-is-everything; X post-is-the-caption; LinkedIn hook + link-in-first-comment; TikTok hook-line + hashtags; IG story + CTA)
    antiPatterns: string[];
  };
  rulesCited: string[];
}
```

## Save — land the voice anchors + ICP knowledge for `channel` (REQUIRED)

The `ContentFormatLibrary` schema is the shape of your thinking; the call below is how its voice anchors land for the chosen `channel`. REQUIRED before you return:

1. **`save_style_exemplars({ channel: <this.channel>, styleExemplars: [ … your 5-10 full-text verbatim native posts/replies … ] })`** — REQUIRED. The full-text native posts you captured in decision rule 11 (distinct from `hookPatterns[].realExamples`, which prove a *pattern*) anchor `maya-voice-matcher` Anchor B; **skip this and drafting on this channel defaults to generic LLM tone** the community ignores and the algorithm starves. Pass each as `{ platform: <this.channel>, community: <niche>, verbatim, why, capturedAt }`. This is the persisted form of the `styleExemplars[]` schema above — described-but-unsaved = lost.
2. If this run is the per-channel scorecard owner (no upstream researcher already populated it), also enrich **`save_foundation_channel_scorecard({ channel: <this.channel>, …, icpKnowledge: { …, complaints, topics, nativeStyle } })`** with the buyer-conversation evidence and native-voice fingerprints you mined — `complaints` (verbatim buyer pain `{ quote, sourceUrl }` from the winning examples' reply threads), `topics`, and `nativeStyle` (`{ exemplars: [{quote,sourceUrl}], cadenceNotes, vocab }` drawn from reply-thread voice fingerprints). The per-channel researcher owns `venues`/`watch`; this skill deepens the native-voice + complaints layer. Don't overwrite a populated scorecard — merge.

## Failure modes

- **No patterns reach buyer-conversation threshold.** Flag `confidence: "library_underweight"`. Do not populate the library with vanity patterns as a fallback — an empty library is more honest. Request more example pulls targeting threads with high reply-to-like ratios, which correlate with discussion rather than passive consumption.
- **All examples from one creator.** `mimicryRisk: "high"`. Recommend operator build authority from scratch or pick a niche where format ownership is distributed.
- **Slop pattern detected.** Reject explicitly. Document in `rejectedPatterns[]`.
- **Reply threads unavailable.** If the platform or upstream data doesn't surface replies, note `voiceFingerprintSourceLimited: true` and flag that the voice fingerprint is inferred from post-level phrasing only — lower confidence.

## Cost discipline

0 new ScrapeCreators (consumes upstream researcher outputs). Up to 3 WebFetches if reply threads need to be loaded directly to validate buyer-conversation evidence. 1 main_maya synthesis. Timeout 12 min.

## Anti-slop check

Each `template` must pass `maya-slop-critic` on the template-skeleton itself — including the structural AI-tell pass (no tidy tricolons, "it's not X it's Y", em-dash cadence, uniform rhythm baked into a template). Real verbatim examples with banned phrases stay in `realExamples` (as evidence of what won) but DO NOT promote into templates. Every pattern in the final library must have `buyerConversionJudgment: "strong" | "moderate"` — patterns rated "vanity" or "unknown" are moved to `rejectedPatterns[]`. `styleExemplars[].verbatim` is a voice/register reference only — never copy an exemplar's content into a draft; drop any exemplar that itself reads templated/AI.
