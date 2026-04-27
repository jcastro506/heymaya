---
name: maya-service-citation-firewall
version: 0.1.0-sprint3
description: Pre-send hallucination gate for service-product Maya. Verifies every factual claim in a draft is grounded in cited evidence. Parallel to creator-side citation firewall.
when-to-use: Called by every other Maya skill on outputs that touch business data — `serviceJobs`, `reviews`, customer info, competitor mentions, revenue snapshots, local positioning. Returns pass/fail; on fail, the calling skill MUST rewrite or stay silent.
plan-tier: all (the firewall is integrity infrastructure — never gated, never skipped).
model-routing: Rule-based primary; Gemini 3.1 Flash Lite LOW thinking for ambiguous-atom disambiguation only. Per § 3 routing matrix.
---

# maya-service-citation-firewall

## Purpose

Mirror of `maya-citation-firewall` (creator-side) but with service-business citation kinds: `job` | `review` | `customer` | `competitor` | `gbp-post` | `inbound-lead` | `revenue-snapshot` | `localPositioning`.

Every other Maya service skill calls this one before returning. Pass=false → caller MUST handle (rewrite stricter or stay silent). Bypassing the firewall is the worst thing Maya can do.

## Inputs

```ts
{
  draft: string;
  citations: Array<{
    kind: "job" | "review" | "customer" | "competitor" | "gbp-post" | "inbound-lead" | "revenue-snapshot" | "local-positioning";
    id: string;
    fact: string;
  }>;
  // Local-first sub-rule (§ 7 hard rule for gbp-post-optimizer + content-arc-planner):
  requireLocalHook?: boolean;            // true for content-generating callers
  localPositioningSnapshot?: {           // when requireLocalHook=true, used to validate hooks
    servedNeighborhoods: string[];
    namedCompetitors: Array<{ name: string }>;
    recurringLocalHooks: Array<{ kind: string; text: string }>;
  };
}
```

## Outputs

```ts
{
  pass: boolean;
  flaggedClaims: Array<{ claim: string; suggestedSource: string }>;
  ambiguousAtoms: Array<{ atom: string; partialMatches: number }>;
  // Local-first sub-rule output:
  localHookPresent: boolean | null;      // null when requireLocalHook=false
  localHookFlags: Array<                 // when requireLocalHook=true, list of failure modes
    | "no-local-reference"
    | "generic-in-your-area"
    | "generic-in-our-community"
    | "hook-not-in-localPositioning"
  >;
}
```

## Layers

1. Rule-based atom extraction (deterministic): numeric claims, named entities (job + customer + competitor + technician names), past-tense references, time windows.
2. **Memory-wiki provenance verification (PRIMARY — replaces text-grep per § 9.5).** For every extracted atom, call `wiki_get` against the candidate vault page (`entities/<kind>/<slug>`, `concepts/<topic>`, `sources/<...>`) and verify the claim resolves to a wiki claim with non-empty `evidence[]`. The wiki is the canonical knowledge surface — pages without provenance are treated as ungrounded. This vastly strengthens the firewall over the prior text-grep-against-context-blob approach.
3. LLM disambiguation for ambiguous matches (Flash Lite LOW, optional, rate-limited) — only after wiki verification fails.
4. **Local-first sub-rule**: when `requireLocalHook=true`, scan draft for at least one match against `localPositioningSnapshot` AND verify via `wiki_get("concepts/local-positioning")` that the matched hook resolves to an evidenced wiki claim. Generic phrasing flags fail.

## Memory-wiki integration (§ 9.5)

This skill is the PRIMARY consumer of the memory-wiki tool surface. Per § 9.5 ("Citation firewall — REWRITTEN to call `wiki_get` for each factual claim in a draft. If the claim has no supporting wiki entry, fail the firewall."):

- `wiki_get(vaultPath)` — called once per extracted atom. Resolution shape: `{ claim, evidence: [{ sourceId, path, weight, ... }] }`. Empty `evidence[]` → fail the firewall.
- `wiki_search(query, corpus="all")` — fallback when the atom doesn't have a deterministic vaultPath candidate (e.g. ambiguous customer names). Bound results to top 3.
- `wiki_lint` — run on suspect drafts to surface contradictions/low-confidence claims into `reports/contradictions.md`. NOT in the inline pre-send path (latency cost too high); used for nightly QA.

Routing for `wiki_get`/`wiki_search` calls inherits this skill's own routing (rule-based primary). The wiki tools are local plugin calls on the Fly machine — no LLM thinking budget consumed.

## Plan-tier

All tiers. Never gated. The firewall is part of every Maya regardless of plan.

## Test categories

- Hallucination grounding (parallel to creator firewall).
- Local-hook-presence (every gbp-post-optimizer + content-arc-planner output passes through with `requireLocalHook=true`).
- Adversarial: prompt-injection in draft, fabricated citation IDs.
- Cross-tenant: a citation pointing to Business A's job ID never grounds a Business B draft (orchestrator validates ID belongs to caller's businessId).
