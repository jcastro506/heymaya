---
name: maya-icp-hypothesis
description: Generate 3-5 ICP hypotheses from product evidence + walkthrough — never from asking the founder, who usually doesn't know.
---

# maya-icp-hypothesis

## Purpose

Founders rarely know their real buyer when they ship. "Devs" / "creators" / "small businesses" are audiences, not ICPs. This skill turns a ProductDiagnosis + walkthrough + competitor evidence into 3-5 concrete buyer hypotheses, each scored on convertibility and channel-locatability. Channel-judge consumes these directly.

## When to invoke

- IF `productDiagnosis.status === "ok"` AND no `icpHypotheses` exist THEN run.
- IF channel-judge returned `failure_reason: "no_locatable_buyer"` THEN re-run with broader hypothesis set.
- IF results-reviewer flags `pattern: "engagement_from_other_founders_only"` (skip launch) THEN re-run — the buyer was wrong.
- NEVER prompt the operator with "who is your customer?" as the primary input. Use product evidence first; ask the operator only to disambiguate between scored candidates.

## Required reads

1. `APP.md`, `PLAYBOOK.md` § 1 (success-metric ladder), § 5 Failure Mode 2 (skip launch), § 7 (channel affinity — ICP must map to one row).
2. `MEMORY.md` for prior hypothesis attempts.

## Decision rules

1. **Rule 9.2 hard requirement.** Each hypothesis must include `buyer = "{role} at {context} who is currently {behavior}"`. "Indie devs" is not a buyer; "Indie devs building solo SaaS who have shipped but have <100 followers" is.
2. **No founder-circle hypotheses unless the product targets founders.** Otherwise it's auto-rejected as Failure Mode 2 bait. Rule 9.9.
3. **Each hypothesis must be locatable on a specific channel.** Cite the PLAYBOOK § 7 row.
4. **Minimum 3, maximum 5.** Fewer = under-explored; more = spray.
5. **Score on `painSpecificity` (0-3) + `channelLocatability` (0-3).** Drop hypotheses scoring ≤2 total to `discarded[]`.
6. **Operator-supplied buyer is one hypothesis, not the answer.** Label `source: "operator-stated"` and compare to product-evidence hypotheses. Surface divergences.
7. **Adjacent-buyer rule.** For each primary, generate one adjacent (same pain, different context).
8. **Pre-launch trap.** IF `app.stage === "pre-launch"` THEN mark all `hypothesisGrade: "speculative"`.
9. **No demographic-only ICPs.** Must include a *behavior* the buyer is doing today.
10. **One sentence of evidence per hypothesis.** Where it came from: landing copy verbatim / competitor reviews / walkthrough scene / operator transcript.

## Output schema

```ts
interface IcpHypotheses {
  hypotheses: Array<{
    id: string;
    buyer: string;
    currentPain: string;
    currentWorkaround: string;
    locatableOn: { channel: string; searchProbe: string; affinityRow: string };
    painSpecificity: 0 | 1 | 2 | 3;
    channelLocatability: 0 | 1 | 2 | 3;
    totalScore: number;
    hypothesisGrade: "speculative" | "evidence-anchored" | "validated";
    evidenceAnchor: { source: string; excerpt: string };
    source: "product-evidence" | "operator-stated" | "competitor-adjacent";
  }>;
  discarded: Array<{ candidate: string; reason: string }>;
  operatorDivergence: string | null;
  recommendedPrimary: string;
}
```

## Failure modes

- **No hypothesis scores ≥3.** Return `status: "diagnosis_too_thin"`. Request maya-app-inspector re-run with deeper walkthrough.
- **All converge on the same channel.** Surface as `convergedChannel: "X"` — channel-judge has a head start.
- **Operator-stated wildly diverges.** Return both, flag `operatorDivergence`. Don't silently override.

## Cost discipline

0-2 ScrapeCreators calls (only to validate channel-locatability). 0-2 WebFetches (competitor sites). 1 model call. No heartbeat spend.

## Anti-slop check

Invoke `maya-slop-critic` (banned-phrase scan only) on every `buyer` and `currentPain` string before returning. If "leverage" / "supercharge" / "unlock" appears, rewrite to operator's vocabulary from APP.md.
