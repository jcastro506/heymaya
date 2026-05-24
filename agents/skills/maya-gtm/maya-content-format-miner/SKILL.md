---
name: maya-content-format-miner
description: Extract reusable hook patterns, proof beats, CTA patterns from real competitor / niche content. Output is a remix kit for drafts.
---

# maya-content-format-miner

## Purpose

Don't write content from scratch. Mine what's already winning in the niche, extract the format skeleton, remix the operator's product into it (tiktok.md § 7 "format remix doctrine"). Emits hook templates + proof-beat structures + CTA patterns that downstream draft skills consume. NEVER ships final copy — that's the operator + slop-critic loop.

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

1. **5-example floor per pattern.** A pattern enters the library only if ≥5 real examples confirm it.
2. **Verbatim hook capture.** Hooks recorded verbatim with source URL. No paraphrase, no "improved" version.
3. **Anti-slop on extraction.** Reject candidates that depend on banned phrases (PLAYBOOK § 6) or anti-pattern structures.
4. **Pattern-mode tagging.** Tag each: BUILD (post-shaped) / ENGAGE (reply-shaped) / OFFER (CTA-shaped).
5. **Channel-specific hook taxonomy.** Use the channel's own catalog (x.md § 5 1-15, tiktok.md § 2 a-j, reddit.md § 3, linkedin.md § 3).
6. **Proof beats separately from hooks.** A proof beat is a specific concrete claim ("$10K MRR in 3 weeks") — extract as substitution-slots.
7. **CTA taxonomy.** Catalog: search-by-name / pinned-URL-comment / DM-keyword / soft-DM / link-in-first-comment. Tag channel compatibility.
8. **Voice-fingerprint extraction.** Capture 1-2 sentence-length and rhythm characteristics per example.
9. **Mimicry risk flagging.** If >40% of niche winners from a single account, `mimicryRisk: "high"`.
10. **No final-copy generation.** Patterns + slots + examples, never final drafts.

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
    realExamples: Array<{ url: string; verbatim: string; metrics: { likes?: number; views?: number } }>;
    voiceFingerprint: string;
  }>;
  proofBeats: Array<{ beatId: string; template: string; slots: string[]; realExamples: Array<{ url: string; verbatim: string }> }>;
  ctaPatterns: Array<{
    ctaId: string;
    template: string;
    channelCompatibility: { x: boolean; reddit: boolean; tiktok: boolean; linkedin: boolean; instagram: boolean };
    bannedOn?: string[];
  }>;
  mimicryRisk: "low" | "medium" | "high";
  rulesCited: string[];
}
```

## Failure modes

- **Fewer than 5 examples per pattern.** Drop. If <2 patterns reach the floor, `confidence: "library_underweight"` + request more pulls.
- **All examples from one creator.** `mimicryRisk: "high"`. Recommend operator build authority from scratch or pick a niche where format ownership is distributed.
- **Slop pattern detected.** Reject explicitly. Document in `rejectedPatterns[]`.

## Cost discipline

0 new ScrapeCreators (consumes upstream researcher outputs). 0 WebFetches. 1 main_maya synthesis. Timeout 10 min.

## Anti-slop check

Each `template` must pass `maya-slop-critic` on the template-skeleton itself. Real verbatim examples with banned phrases stay in `realExamples` (as evidence of what won) but DO NOT promote into templates.
