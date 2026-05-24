---
name: maya-slop-critic
description: The anti-slop enforcer. Apply PLAYBOOK § 6 banned-phrase list + banned-structure scan + voice match + read-aloud test. Returns "rejected with reasons" on any trip.
---

# maya-slop-critic

## Purpose

Every draft prose output in the system passes through this skill before shipping. The job is to detect AI-flavored writing and surface specific rewrites — banned phrases, banned structures, voice divergence, generic-template feel. PLAYBOOK § 6 codifies the rules; this skill enforces them.

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

3. **Rule 9.12 — voice-match scan.** Compare draft to operator's last-5 authentic posts. Diverges = REJECT. Check: sentence length variance, capitalization, emoji frequency, parenthetical-aside frequency, first-vs-third-person, profanity tolerance.
4. **Rule 9.13 — "Excited to announce" auto-reject.** No re-read needed. Reject immediately, propose rewrite as thinking-process post (linkedin.md § 4).
5. **Read-aloud test.** Sounds like a press release = REJECT.
6. **Channel-specific bans.**
   - LinkedIn: broetry overuse, "Agree?" closers, tagged-friend humblebrag, fake humility, "founder" 3x in first paragraph, stock-photo selfies.
   - TikTok: literal "link in bio", "Hey guys" / "What's up everyone", "follow for more" in first 70%.
   - Reddit: "DM me" / PM solicitation in promo-sensitive subs, naming competitors in promo-adjacent comments, hype-jargon in title, emoji in title.
   - X: hype emoji clusters (🚀🔥), "RT for reach", "Like if you agree", "Comment YES and I'll DM you", dunk-quote-RTs.
7. **Number-presence (x.md rule 8).** X posts must contain ≥1 concrete number. No number = REJECT (or surface to operator for the number).
8. **CTA singularity.** Multiple CTAs in one post = REJECT.
9. **Operator's-instinct final filter (PLAYBOOK rule 6.1).** If uncertain, return `verdict: "borderline"` with: "read this like a stranger sent it to you — do you sound like this?"
10. **No invented voice.** Slop-critic rejects; it doesn't write the operator's voice from scratch. If voice fingerprint missing, mark `voiceMatch: "no_fingerprint_available"` and apply only banned-phrase + structure scans.

## Output schema

```ts
interface SlopCriticVerdict {
  verdict: "approved" | "rejected" | "borderline";
  hits: Array<{
    rule: string;
    type: "banned_phrase" | "banned_structure" | "voice_divergence" | "channel_ban" | "missing_number" | "multiple_ctas";
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
- **No voice fingerprint.** Apply banned-phrase + structure + channel-ban scans only. Mark `voiceMatch: "no_fingerprint_available"`.

## Cost discipline

0 ScrapeCreators / 0 WebFetches / 1 main_maya call (low thinking — pattern matching, not synthesis). Heartbeat-safe. Timeout: 3 min.

## Anti-slop check

Self-referential: this skill IS the anti-slop check. The `suggestion` strings inside `hits[]` must themselves pass the rules — don't suggest "leverage your voice" as the rewrite for "leverage X". Suggest plain English instead.
