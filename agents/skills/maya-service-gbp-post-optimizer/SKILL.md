---
name: maya-service-gbp-post-optimizer
version: 0.1.0-sprint3
description: Compose a Google Business Profile local post — text + CTA + image hint. Every output MUST include at least one local hook from `localPositioning`. Generic "in your area" is rejected by the citation firewall.
when-to-use: Fired by `gbp_cadence_watch` (every 3 days at 10am if last post > 5 days), `weather_triggered_promo` (event), and operator-initiated chat ("draft a GBP post for the Hendersen install").
plan-tier: pro+ (Pro and Studio).
model-routing: Gemini 3 Flash, MEDIUM thinking. Per § 3 routing matrix — Google moderation bar; reasoning quality matters.
---

# maya-service-gbp-post-optimizer

## Purpose

GBP local posts drive local-pack ranking + a free permanent ad surface on Maps. They have weird constraints: 1500-char caption, fixed CTA buttons (CALL / BOOK / ORDER / LEARN_MORE), images render as a scrollable carousel natively. Most operators post once a quarter and wonder why their ranking slipped. The cadence sweet spot is 2-3× per week.

This skill drafts the post.

## LOCAL-HOOK HARD RULE (verbatim from § 7)

**Every post MUST include at least one local hook — neighborhood/zip mention, named local landmark, weather reference, local event, or community reference — pulled from `businessPicture.localPositioning`. If `localPositioning` is empty, fall back to served zips from Q2 + GBP city. Generic "we serve [region]" is rejected by the citation firewall.**

The output's `localHookUsed` field names which hook was woven in, for audit + the citation firewall's local-hook-presence assertion. If the skill cannot find a usable local hook, it returns `localHookUsed: null` and the orchestrating Convex action MUST refuse to promote the draft to `gbpPosts`.

## Inputs

```ts
{
  seedTopic?: string;                    // free-form seed, e.g. "AC tune-up special"
  jobPhotos?: Array<{                    // operator-supplied photos, alternative seed
    assetId: string;
    catalog: { primarySubject: string; serviceCategory: string; suggestedUses: string[] };
  }>;
  serviceArea: string;                   // e.g. "25-mile radius around Lincoln, NE"
  brandVoice: string;                    // businessPicture.brandVoice
  postType: "STANDARD" | "EVENT" | "OFFER";
  localPositioning: {                    // load-bearing for the local-hook rule
    servedZips: string[];
    servedNeighborhoods: string[];
    namedCompetitors: Array<{ name: string; reputationalNote?: string }>;
    recurringLocalHooks: Array<{
      kind: "weather" | "event" | "landmark" | "sport" | "season" | "community";
      text: string;
    }>;
    localChoiceThesis: string;
  };
  ctaIntent?: "CALL" | "BOOK" | "ORDER" | "LEARN_MORE";  // operator preference
}
```

Either `seedTopic` or `jobPhotos` must be present.

## Outputs

```ts
{
  text: string;                          // ≤1500 chars; first 80 chars carry mobile preview
  cta: {
    button: "CALL" | "BOOK" | "ORDER" | "LEARN_MORE";
    targetUrl?: string;                  // for ORDER + LEARN_MORE; phone-number for CALL
  };
  recommendedImageAssetIds?: string[];   // when `jobPhotos` present, ranked subset for the post
  localHookUsed: {
    kind: "neighborhood" | "zip" | "landmark" | "competitor-contrast" | "weather" | "event" | "season" | "community";
    text: string;                        // the literal phrase woven into the post
    sourcedFrom: string;                 // "localPositioning.servedNeighborhoods[2]" etc.
  } | null;                              // null = caller must reject draft
  citationContext: {
    grounded: boolean;
    sources: string[];
  };
}
```

## Memory-wiki integration (§ 9.5)

- **Pre-draft hook grounding**: before composing, call `wiki_get("concepts/local-positioning")` for the operator's compiled positioning page AND `wiki_get("entities/neighborhoods/<served-zip-or-slug>")` for any specific neighborhood the seedTopic / jobPhotos imply. The returned claim + evidence array is what `localHookUsed.sourcedFrom` should reference (e.g. `wiki:concepts/local-positioning#claim-3`). Pages without evidence are skipped — never use them as the local hook source.
- **Recurring-hook lookup**: optionally call `wiki_get("concepts/recurring-local-hooks")` for the operator's volunteered seasonal/community hooks. The hook woven into the post must trace to either a `localPositioning` entry or a `recurring-local-hooks` claim — both wiki-verified.
- The citation-firewall step that always runs after this skill uses `wiki_get` to verify `localHookUsed.sourcedFrom` resolves; if the wiki page disappears between draft and verify, the firewall fails the post.
- Tool calls inherit MEDIUM-thinking routing for the LLM draft; `wiki_get` is a direct plugin call (no thinking budget consumed).

## Drafting rules

- **Hook in first 80 chars.** Mobile preview cutoff. Lead with the local hook + service.
- **Caption length 80-400 chars** for STANDARD (longer for EVENT/OFFER). The 1500-char cap is a soft ceiling, not a target.
- **CTA inferred from intent.** Operator-supplied `ctaIntent` wins; otherwise infer from `postType` (OFFER → BOOK; EVENT → LEARN_MORE; STANDARD → CALL or BOOK).
- **Images.** When `jobPhotos` present, rank them by `catalog.suggestedUses.includes("gbp-post")` then by `catalog.visualQuality`. Return up to 5 (GBP scrollable cap).
- **Local hook integration.** Weave the hook into the text body, not as a postscript. "Just wrapped a 14-SEER install on Oak Street in Lincoln Park" beats "We serve Lincoln Park. Recently completed a 14-SEER install."
- **Brand voice.** Mirror the operator's stylometry from `brandVoice`.
- **No price quotes.** Even if `seedTopic` mentions a price, the draft replaces with "starting at" or "competitive rates" — operator owns pricing.

## Plan-tier

Pro and Studio. Starter does not get this skill (Starter tier publishes manually outside Maya).

## Model routing

Gemini 3 Flash, MEDIUM thinking. Reasoning quality matters: the local-hook integration + voice mirroring + CTA inference all benefit from the medium budget.

## Test categories

1. **Cross-tenant** — Business A's `localPositioning` never leaks into Business B's draft.
2. **Plan-tier** — Starter blocked at the entry-point Convex action; this skill only runs on Pro+.
3. **Citations** — every output's `localHookUsed.sourcedFrom` resolves to a real entry in the input `localPositioning`.
4. **Local-hook-presence** (THE test, § 7 hard rule) — every output contains at least one hyperlocal reference; outputs with `localHookUsed: null` AND text containing "in your area" or "in our community" generic phrasing FAIL.
5. **Adversarial** — empty `localPositioning` (fallback to servedZips); hook-injection in seedTopic ignored; price-injection in seedTopic stripped.

## Sibling files

- Standing orders: `gbp_cadence_watch` (cron every 3 days), `weather_triggered_promo` (event-driven).
- Calls: `maya-service-citation-firewall`, `maya-service-brand-voice-applier`.
- Convex tables: writes `gbpPosts` (status='pending_approval'); reads `businessPicture.localPositioning` + `mediaAssets`.
