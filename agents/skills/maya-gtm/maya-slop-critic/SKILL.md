---
name: maya-slop-critic
description: The anti-slop / AI-tell critic. Apply PLAYBOOK § 6 banned-phrase list + banned-structure scan + LLM-judgment structural AI-tell pass + voice match + read-aloud test. Returns "rejected with reasons" on any trip. The bar is native-voice fidelity, NOT detector-dodging.
---

# maya-slop-critic

## Purpose

Every draft prose output in the system passes through this skill before shipping. The job is to detect writing that reads like a generic AI / templated marketer wrote it and surface specific rewrites — banned phrases, banned structures, *structural AI-tells*, voice divergence, generic-template feel. PLAYBOOK § 6 codifies the lexical rules; this skill enforces them AND adds an LLM-judgment structural pass.

## The honest framing (read before judging anything)

The enemy is **not an AI detector**. There is no reliable platform AI-detector demoting text as a ranking signal — detectors are noisy and platforms don't run them at scale. We never chase "undetectable." The real penalties are concrete: Reddit/HN **community + mod rejection** (and founder-account ban risk), and TikTok/IG/YT **engagement starvation** of generic, voiceless content. So the single question this skill answers, on every draft, is:

> **"Would a real person from this community have actually written this?"**

A draft that reads as native, specific, and opinionated passes — even if it happens to trip a hypothetical detector. A draft that is smooth, tidy, hedged, and voiceless FAILS — even if it has zero banned phrases. Structural tidiness is the giveaway, not vocabulary alone.

**Personality is a PASS, not a fail.** This skill kills *slop* (hype, emoji-vomit, tidiness, voicelessness, press-release tone), NOT *character*. Warmth, a clear opinion, dry wit, a wry aside, a genuine human reaction to a real win, a little profanity if it fits the operator's voice — these are native-voice POSITIVES. Never reject a draft for "being too casual" or "having a personality" or "an emotional reaction"; a real person from the community has all of those. The failures are specifically: hype words, exclamation/emoji spam, forced jokes / try-hard cheese, machine smoothness, and zero stance. Warm + opinionated + specific = exactly what we want. Flat corporate-neutral is its own failure (voicelessness) — flag it too.

## When to invoke

- IF any other skill produces draft prose (post body, reply, caption, hook, CTA, calendar event description) THEN invoke before the parent skill returns.
- IF the operator drafts something and asks Maya to review THEN invoke.
- IF results-reviewer detects "high impressions + low engagement" (cringe-launch symptom, Failure Mode 3) THEN re-invoke retroactively on last 5 posts.
- HEARTBEAT-COMPATIBLE — local-state-only, no external API spend.

## Required reads

1. **PLAYBOOK.md § 6 — MANDATORY full read.**
2. USER.md (operator voice fingerprint: Stated lane / Observed signal).
3. playbook/{channel}.md for channel-specific bans (LinkedIn broetry, TikTok "link in bio", Reddit "DM me").
4. MEMORY.md for repeat traps.

## Decision rules

1. **Rule 9.10 — banned-phrase scan.** Any hit on PLAYBOOK § 6 list = REJECT and rewrite. The list:
   - "game changer", "game-changing"
   - "unlock", "unlock the power of"
   - "supercharge", "turbocharge"
   - "empower", "empowers you to"
   - "leverage" (as verb), "leveraging"
   - "delve into", "dive deep into"
   - "tapestry", "landscape", "ecosystem" (metaphorical)
   - "testament to"
   - "vibrant", "robust", "seamless"
   - "pivotal", "crucial", "vital" (dramatized)
   - "In today's competitive landscape", "In today's fast-paced world"
   - "It's worth noting that", "It's important to note"
   - "Not just X, but Y" (structural pep)
   - "comprehensive", "endeavour", "optimise"
   - "furthermore", "moreover", "additionally" (as openers)
   - "Excited to announce", "Thrilled to share", "Beyond excited"
   - "We are pleased to", "I'm proud to"
   - "Whether you're X, Y, or Z" (tricolon-of-personas opener)
   - "Game-changer.", "Mind-blowing.", "Absolute fire." (one-word punch closes)

2. **Rule 9.11 — banned-structure scan.** Any hit = REJECT:
   - Em-dash cadence (>1 em-dash per paragraph).
   - Stacked one-line takes (3 single-line statements pretending to be profound).
   - Emoji-bullet lists.
   - X-Y-Z tricolon ("Faster, better, and cheaper.").
   - "I'm building [adjective] [adjective] [thing]" structure.
   - Hedging seesaw ("It's not just X — it's Y. But it's also Z.").
   - Uniform sentence length (4 in a row at 12-18 words).
   - Passive voice as default.
   - Em-dash + colon stacking in the same line.

3. **Rule 9.11b — STRUCTURAL AI-tell critic (LLM JUDGMENT, not regex).** This is the load-bearing addition. The banned-phrase and banned-structure lists above catch known surface patterns; this pass catches the *shape* of AI-generated prose that no phrase list can enumerate. **Do NOT implement this as regex, counts, or hardcoded thresholds** (per the no-heuristics rule) — read the draft as a human from the target community would and judge whether it has the telltale smoothness of machine-written or template-marketer text. Look for, and reason about, these tells together (any one is a yellow flag; a cluster is a REJECT):
   - **Em-dash as default connective — now a HARD BAN, not a feel call.** Per SOUL.md's punctuation rules: ANY em dash or en dash in a draft is an automatic hit. Same for semicolons, colon-led constructions ("Here's the thing:"), scare quotes, "it's not X, it's Y" framing, and rule-of-three flourishes. These are the exact tells readers screenshot as "this is AI." The fix is always the same: periods, shorter sentences, one concrete specific.
   - **Suspiciously tidy tricolons / rule-of-three.** "Faster, cheaper, and more reliable." Real people don't naturally land on three balanced items this often. One deliberate tricolon is fine; a draft built out of them is a tell.
   - **"It's not just X, it's Y" (and "not only… but also").** The signature AI pivot-to-profundity construction. Almost always a tell. Flag every instance.
   - **Quotation-mark theater.** Quoting the target thread's own words back at its author (`"Zero visitors. Zero trials." — felt this`), staging one's own thoughts as dialogue (`I thought to myself "why does it have to be this hard?"`), or air-quotes around ordinary words. Real people say the thing; they don't perform it in quotes. One quoted span citing a real number, source, or another person's actual words is fine — more than one in a short message, or ANY quote-back of the OP, is a hit.
   - **Uniform sentence rhythm.** Real writing has burstiness — a fragment, then a long winding sentence, then three words. AI defaults to a metronome of medium-length, evenly-weighted sentences. If every sentence is the same length and shape, REJECT.
   - **Over-hedging / no stance.** "It can be helpful in many cases." "This might be worth considering." A real founder in their niche has an *opinion*. Hedged, both-sides, committee-safe prose reads bot-written. Flag absence of a clear point of view.
   - **Zero opinion / zero specifics.** Prose that could be about any product, sent to anyone, citing nothing concrete (no real number, no proper noun, no lived detail). Generic-to-anyone = REJECT. This is the symptom the whole skill exists to kill.
   - **Suspicious symmetry / tidiness.** Perfectly parallel clause structure, every list item the same grammatical shape, a clean intro-body-closer arc on a casual reply. Humans are messier; native posts have texture, asides, and asymmetry.
   - **Pivot-to-uplift closer.** A neat motivational/aspirational wrap-up sentence ("And that's how you turn a setback into a setup.") that a real person wouldn't tack on. Tell.
   For each tell found, emit a `hit` with `type: "structural_ai_tell"`, the offending `snippet`, and a `suggestion` that makes it read like a real person from this niche — break the rhythm, take a side, swap the em-dash for a period, add a concrete specific, cut the tidy closer. The verdict question is always: *would someone in {community} have written this, or does it read like generic AI?*

4. **Rule 9.12 — voice-match scan.** Compare draft to operator's last-5 authentic posts. Diverges = REJECT. Check: sentence length variance, capitalization, emoji frequency, parenthetical-aside frequency, first-vs-third-person, profanity tolerance.
5. **Rule 9.13 — "Excited to announce" auto-reject.** No re-read needed. Reject immediately, propose rewrite as thinking-process post (linkedin.md § 4).
6. **Read-aloud test.** Sounds like a press release = REJECT.
7. **Channel-specific bans.**
   - LinkedIn: broetry overuse, "Agree?" closers, tagged-friend humblebrag, fake humility, "founder" 3x in first paragraph, stock-photo selfies.
   - TikTok: literal "link in bio", "Hey guys" / "What's up everyone", "follow for more" in first 70%.
   - Reddit: "DM me" / PM solicitation in promo-sensitive subs, naming competitors in promo-adjacent comments, hype-jargon in title, emoji in title.
   - X: hype emoji clusters (🚀🔥), "RT for reach", "Like if you agree", "Comment YES and I'll DM you", dunk-quote-RTs.
8. **Number-presence (x.md rule 8).** X posts must contain ≥1 concrete number. No number = REJECT (or surface to operator for the number).
9. **CTA singularity.** Multiple CTAs in one post = REJECT.
10. **Operator's-instinct final filter (PLAYBOOK rule 6.1).** If uncertain, return `verdict: "borderline"` with: "read this like a stranger sent it to you — do you sound like this?"
11. **No invented voice.** Slop-critic rejects; it doesn't write the operator's voice from scratch. If voice fingerprint missing, mark `voiceMatch: "no_fingerprint_available"` and apply only banned-phrase + structure + structural-AI-tell scans.

## Output schema

```ts
interface SlopCriticVerdict {
  verdict: "approved" | "rejected" | "borderline";
  hits: Array<{
    rule: string;
    type: "banned_phrase" | "banned_structure" | "structural_ai_tell" | "voice_divergence" | "channel_ban" | "missing_number" | "multiple_ctas";
    snippet: string;
    suggestion: string;
  }>;
  voiceMatch: "match" | "diverge" | "no_fingerprint_available";
  readAloudTest: "passes" | "press_release_tone";
  rewrittenDraft?: string;
  finalAdvice: string;
}
```

## Failure modes

- **Passes all scans but feels off.** Return `verdict: "borderline"` with `finalAdvice: "Operator gut-check before posting"`.
- **Operator overrides rejection.** Document override + predict failure mode. Surface to MEMORY.md.
- **No voice fingerprint.** Apply banned-phrase + structure + structural-AI-tell + channel-ban scans only. Mark `voiceMatch: "no_fingerprint_available"`. The structural-AI-tell pass still runs — it needs no fingerprint, only the "would a real person from this community have written this?" judgment.

## Cost discipline

0 ScrapeCreators / 0 WebFetches / 1 main_maya call (low thinking — pattern matching, not synthesis). Heartbeat-safe. Timeout: 3 min.

## Anti-slop check

Self-referential: this skill IS the anti-slop check. The `suggestion` strings inside `hits[]` must themselves pass the rules — don't suggest "leverage your voice" as the rewrite for "leverage X". Suggest plain English instead.
