/**
 * wikiInitialPages — synthesize the initial vault contents from a freshly
 * generated `BusinessPicture`.
 *
 * Per `docs/SPRINT_PLAN_SERVICE_V0.md` § 9.5 ("Onboarding step 8 ALSO writes
 * initial wiki pages alongside `businessPicture` row"), this module renders
 * one structured-claim-with-provenance page per wiki section so the per-
 * business vault is meaningfully populated the moment Maya boots. Every
 * future skill that calls `wiki_get(...)` finds real evidence chains
 * instead of empty pages.
 *
 * Five sections per § 9.5:
 *   - `entities/` — per-named-competitor + per-named-neighborhood +
 *     per-customer-archetype
 *   - `concepts/` — service-type taxonomy + recurring local hooks
 *   - `syntheses/` — initial business-thesis from `localChoiceThesis`
 *   - `sources/` — pointers to GBP profile + last 30 reviews + last 30 posts
 *   - `reports/` — empty seed (dreaming will populate)
 *
 * Routing per § 9.5 + § 7: this is rendering downstream of the HIGH-thinking
 * `generateBusinessPicture` call. Tagged MEDIUM — we synthesize wording from
 * already-grounded inputs, not new facts.
 *
 * Cross-tenant: every page carries `businessId`; the rendered claims only
 * cite material from the SAME business's onboarding artifacts.
 *
 * Hallucination firewall: pages emitted here only restate provenance the
 * caller already grounded in `generateBusinessPicture`'s output. A competitor
 * page with no name OR no operator/review evidence is dropped (defensive —
 * generateBusinessPicture's firewall should have already cut these).
 */

import type {
  BusinessPictureLite,
  LocalPositioning,
  ServiceType,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type WikiPageKind =
  | "entity"
  | "concept"
  | "synthesis"
  | "source"
  | "report";

export interface WikiPageProvenance {
  /** Stable ID of the source artifact (e.g. "review:abc-123", "operator:Q9"). */
  sourceId: string;
  /** Path within the source artifact, e.g. "$.body" or "$.namedCompetitors[2]". */
  path: string;
  /** Optional line range when the source is text. */
  lines?: string;
  /**
   * Provenance weight in [0..1]. Operator-direct answers carry the highest
   * weight; review text carries medium; inferred patterns carry lower.
   */
  weight?: number;
  /** Optional short note explaining the link. */
  note?: string;
}

export interface WikiInitialPage {
  /** Vault path with no leading slash — the wiki normalizes paths. */
  vaultPath: string;
  kind: WikiPageKind;
  /** The compiled claim text the wiki materializes. */
  claim: string;
  provenance: ReadonlyArray<WikiPageProvenance>;
  /** 0..1 — confidence band per § 9.5 structured-claim format. */
  confidence: number;
}

export interface WikiInitialPagesInputs {
  businessName: string;
  serviceTypes: ReadonlyArray<ServiceType>;
  picture: BusinessPictureLite;
  /** The onboarding Q9-Q11 answers — load-bearing for provenance. */
  onboardingLocalAnswers: {
    namedCompetitors: ReadonlyArray<string>;
    neighborhoodEmphasis: ReadonlyArray<string>;
    operatorVolunteeredHooks: ReadonlyArray<string>;
  };
  /** Source-pointer counts so we can cite review/post indexes accurately. */
  sourceCounts: {
    reviews: number;
    posts: number;
    /** Whether onboarding pulled a GBP profile at all. */
    hasGbpProfile: boolean;
  };
  /** Test seam — pinned for determinism. */
  now?: number;
}

export interface WikiInitialPagesOutput {
  pages: ReadonlyArray<WikiInitialPage>;
  /**
   * Diagnostic — names that came in via the picture but had no provenance
   * trail (operator-not-named AND not in onboarding answers). The pipeline
   * should never see this — `generateBusinessPicture`'s firewall already
   * drops phantoms — but we re-check here as belt-and-suspenders.
   */
  droppedPhantomNames: ReadonlyArray<{ field: string; raw: string }>;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

const COMPETITOR_OPERATOR_WEIGHT = 0.95;
const COMPETITOR_REVIEW_WEIGHT = 0.6;
const NEIGHBORHOOD_OPERATOR_WEIGHT = 0.95;
const NEIGHBORHOOD_REVIEW_WEIGHT = 0.6;
const HOOK_OPERATOR_WEIGHT = 0.95;
const HOOK_REVIEW_WEIGHT = 0.6;
const SERVICE_TYPE_WEIGHT = 0.9;
const THESIS_WEIGHT = 0.85;
const SOURCE_POINTER_WEIGHT = 1.0;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function renderCompetitorPages(
  inputs: WikiInitialPagesInputs
): { kept: WikiInitialPage[]; dropped: Array<{ field: string; raw: string }> } {
  const kept: WikiInitialPage[] = [];
  const dropped: Array<{ field: string; raw: string }> = [];
  const operatorSet = new Set(
    inputs.onboardingLocalAnswers.namedCompetitors.map((n) => n.toLowerCase())
  );
  for (const c of inputs.picture.localPositioning.namedCompetitors) {
    if (!c.name || c.name.trim().length === 0) continue;
    const lname = c.name.toLowerCase();
    const operatorNamed = operatorSet.has(lname);
    if (!operatorNamed) {
      // `generateBusinessPicture` should have already gated this; we drop
      // again here in case downstream consumers feed in a malformed picture.
      dropped.push({
        field: "entities/competitors",
        raw: c.name,
      });
      continue;
    }
    const slug = slugify(c.name);
    const claimParts = [`${c.name.trim()} is a named local competitor.`];
    if (c.reputationalNote) {
      claimParts.push(`Operator reputational note: ${c.reputationalNote}.`);
    }
    if (typeof c.gbpRating === "number") {
      claimParts.push(`GBP rating at synthesis: ${c.gbpRating.toFixed(1)}.`);
    }
    kept.push({
      vaultPath: `entities/competitors/${slug}`,
      kind: "entity",
      claim: claimParts.join(" "),
      provenance: [
        {
          sourceId: "operator-onboarding:Q9",
          path: "$.namedCompetitors",
          weight: COMPETITOR_OPERATOR_WEIGHT,
          note: "Operator named this competitor in onboarding question 9.",
        },
      ],
      confidence: COMPETITOR_OPERATOR_WEIGHT,
    });
    void COMPETITOR_REVIEW_WEIGHT;
  }
  return { kept, dropped };
}

function renderNeighborhoodPages(
  inputs: WikiInitialPagesInputs
): WikiInitialPage[] {
  const out: WikiInitialPage[] = [];
  const operatorSet = new Set(
    inputs.onboardingLocalAnswers.neighborhoodEmphasis.map((n) =>
      n.toLowerCase()
    )
  );
  // Union: operator-named + synth-emitted (synth output is itself grounded
  // in operator answers OR review text).
  const seen = new Set<string>();
  const all = [
    ...inputs.onboardingLocalAnswers.neighborhoodEmphasis,
    ...inputs.picture.localPositioning.servedNeighborhoods,
  ];
  for (const n of all) {
    if (!n || n.trim().length === 0) continue;
    const slug = slugify(n);
    if (seen.has(slug)) continue;
    seen.add(slug);
    const operatorNamed = operatorSet.has(n.toLowerCase());
    out.push({
      vaultPath: `entities/neighborhoods/${slug}`,
      kind: "entity",
      claim: `${n.trim()} is a served neighborhood for ${inputs.businessName}.`,
      provenance: [
        operatorNamed
          ? {
              sourceId: "operator-onboarding:Q10",
              path: "$.neighborhoodEmphasis",
              weight: NEIGHBORHOOD_OPERATOR_WEIGHT,
              note: "Operator named this neighborhood in onboarding question 10.",
            }
          : {
              sourceId: "businessPicture:localPositioning.servedNeighborhoods",
              path: `$.servedNeighborhoods[${n}]`,
              weight: NEIGHBORHOOD_REVIEW_WEIGHT,
              note: "Inferred from review or post text during synthesis.",
            },
      ],
      confidence: operatorNamed
        ? NEIGHBORHOOD_OPERATOR_WEIGHT
        : NEIGHBORHOOD_REVIEW_WEIGHT,
    });
  }
  return out;
}

function renderCustomerTypePages(
  inputs: WikiInitialPagesInputs
): WikiInitialPage[] {
  // Coarse archetype derived from the customerSentiment summary. v0 emits a
  // single placeholder — `entities/customers/<lastname>.md` pages land in
  // Sprint 4 once CRM customer records are available.
  const sentiment = inputs.picture.customerSentiment?.trim();
  if (!sentiment) return [];
  return [
    {
      vaultPath: "entities/customer-archetypes/primary",
      kind: "entity",
      claim: `Primary customer archetype profile (synthesized at onboarding): ${sentiment}`,
      provenance: [
        {
          sourceId: "businessPicture:customerSentiment",
          path: "$.customerSentiment",
          weight: 0.7,
          note: "Synthesized from review corpus + operator answers at onboarding.",
        },
      ],
      confidence: 0.7,
    },
  ];
}

function renderServiceTypeConcept(
  inputs: WikiInitialPagesInputs
): WikiInitialPage {
  return {
    vaultPath: "concepts/service-type-taxonomy",
    kind: "concept",
    claim: `${inputs.businessName} services: ${inputs.serviceTypes.join(", ")}.`,
    provenance: [
      {
        sourceId: "operator-onboarding:Q1",
        path: "$.serviceTypes",
        weight: SERVICE_TYPE_WEIGHT,
        note: "Operator-selected service types during onboarding.",
      },
    ],
    confidence: SERVICE_TYPE_WEIGHT,
  };
}

function renderRecurringLocalHooksConcept(
  inputs: WikiInitialPagesInputs
): WikiInitialPage | null {
  const hooks = inputs.picture.localPositioning.recurringLocalHooks;
  if (hooks.length === 0) return null;
  // Determine grounding for the page-level confidence: if every hook traces
  // back to an operator answer, score high; otherwise medium.
  const operatorSet = new Set(
    inputs.onboardingLocalAnswers.operatorVolunteeredHooks.map((h) =>
      h.toLowerCase()
    )
  );
  const allOperatorBacked = hooks.every((h) =>
    Array.from(operatorSet).some(
      (o) => h.text.toLowerCase().includes(o) || o.includes(h.text.toLowerCase())
    )
  );
  const claim = [
    `Recurring local hooks Maya can weave into posts:`,
    ...hooks.map(
      (h, i) => `[${i}] ${h.kind}: "${h.text}"`
    ),
  ].join("\n");
  return {
    vaultPath: "concepts/recurring-local-hooks",
    kind: "concept",
    claim,
    provenance: hooks.map((h, idx) => ({
      sourceId: allOperatorBacked
        ? "operator-onboarding:Q11"
        : "businessPicture:localPositioning.recurringLocalHooks",
      path: `$.recurringLocalHooks[${idx}]`,
      weight: allOperatorBacked ? HOOK_OPERATOR_WEIGHT : HOOK_REVIEW_WEIGHT,
      note: `${h.kind}: ${h.text}`,
    })),
    confidence: allOperatorBacked ? HOOK_OPERATOR_WEIGHT : HOOK_REVIEW_WEIGHT,
  };
}

function renderLocalPositioningConcept(
  inputs: WikiInitialPagesInputs
): WikiInitialPage {
  const lp: LocalPositioning = inputs.picture.localPositioning;
  return {
    vaultPath: "concepts/local-positioning",
    kind: "concept",
    claim: [
      `Served zips: ${lp.servedZips.join(", ") || "(none recorded)"}`,
      `Served neighborhoods: ${lp.servedNeighborhoods.join(", ") || "(none)"}`,
      `Named competitors: ${lp.namedCompetitors.map((c) => c.name).join(", ") || "(none)"}`,
      `Local choice thesis: ${lp.localChoiceThesis || "(synthesis pending)"}`,
    ].join("\n"),
    provenance: [
      {
        sourceId: "businessPicture:localPositioning",
        path: "$.localPositioning",
        weight: 0.9,
        note: "Compiled at onboarding from operator answers + GBP corpus.",
      },
    ],
    confidence: 0.9,
  };
}

function renderBusinessThesisSynthesis(
  inputs: WikiInitialPagesInputs
): WikiInitialPage {
  const thesis =
    inputs.picture.localPositioning.localChoiceThesis?.trim() ||
    `${inputs.businessName} serves the local market with focus on operator-verified service types: ${inputs.serviceTypes.join(", ")}.`;
  const dateSlug = new Date(inputs.now ?? Date.now()).toISOString().slice(0, 10);
  return {
    vaultPath: `syntheses/business-picture-${dateSlug}`,
    kind: "synthesis",
    claim: thesis,
    provenance: [
      {
        sourceId: "businessPicture:localPositioning.localChoiceThesis",
        path: "$.localChoiceThesis",
        weight: THESIS_WEIGHT,
        note: "Generated by businessPicture HIGH-thinking synthesis at onboarding.",
      },
    ],
    confidence: THESIS_WEIGHT,
  };
}

function renderSourcePointers(
  inputs: WikiInitialPagesInputs
): WikiInitialPage[] {
  const out: WikiInitialPage[] = [];
  if (inputs.sourceCounts.hasGbpProfile) {
    out.push({
      vaultPath: "sources/onboarding/gbp-profile",
      kind: "source",
      claim: `Source pointer: Google Business Profile pulled at onboarding.`,
      provenance: [
        {
          sourceId: "zernio:gbp-profile",
          path: "$.gbp.profile",
          weight: SOURCE_POINTER_WEIGHT,
          note: "Onboarding bulk-pull artifact.",
        },
      ],
      confidence: SOURCE_POINTER_WEIGHT,
    });
  }
  if (inputs.sourceCounts.reviews > 0) {
    out.push({
      vaultPath: "sources/onboarding/reviews",
      kind: "source",
      claim: `Source pointer: ${inputs.sourceCounts.reviews} review(s) pulled at onboarding.`,
      provenance: [
        {
          sourceId: "zernio:gbp-reviews",
          path: "$.gbp.reviews",
          weight: SOURCE_POINTER_WEIGHT,
          note: "Onboarding bulk-pull artifact.",
        },
      ],
      confidence: SOURCE_POINTER_WEIGHT,
    });
  }
  if (inputs.sourceCounts.posts > 0) {
    out.push({
      vaultPath: "sources/onboarding/posts",
      kind: "source",
      claim: `Source pointer: ${inputs.sourceCounts.posts} post(s) pulled at onboarding.`,
      provenance: [
        {
          sourceId: "zernio:gbp-posts",
          path: "$.gbp.posts",
          weight: SOURCE_POINTER_WEIGHT,
          note: "Onboarding bulk-pull artifact.",
        },
      ],
      confidence: SOURCE_POINTER_WEIGHT,
    });
  }
  return out;
}

function renderReportSeeds(
  _inputs: WikiInitialPagesInputs
): WikiInitialPage[] {
  // The plugin auto-materializes report dashboards (open-questions /
  // contradictions / low-confidence / claim-health / stale-pages) once
  // dreaming runs. We seed a single empty placeholder so HQ's Studio
  // Reports surface has a row to subscribe to from day 1.
  return [
    {
      vaultPath: "reports/seed",
      kind: "report",
      claim:
        "Report seeds initialized at onboarding. Dreaming will populate open-questions / contradictions / low-confidence / claim-health / stale-pages from session activity.",
      provenance: [
        {
          sourceId: "deploy:onboarding",
          path: "$.deploy",
          weight: 1.0,
          note: "Initial seed page; replaced by plugin dashboards on first compile.",
        },
      ],
      confidence: 1.0,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Render the initial vault pages from a freshly synthesized BusinessPicture.
 *
 * Pure function — no I/O. Caller persists via `convex/wikiProjections.ts`
 * and the deploy bundler ships the pages into the per-business vault on the
 * Fly machine.
 */
export function generateWikiInitialPages(
  inputs: WikiInitialPagesInputs
): WikiInitialPagesOutput {
  const { kept: competitorPages, dropped } = renderCompetitorPages(inputs);
  const neighborhoodPages = renderNeighborhoodPages(inputs);
  const customerArchetypePages = renderCustomerTypePages(inputs);

  const conceptPages: WikiInitialPage[] = [renderServiceTypeConcept(inputs)];
  const hooksConcept = renderRecurringLocalHooksConcept(inputs);
  if (hooksConcept) conceptPages.push(hooksConcept);
  conceptPages.push(renderLocalPositioningConcept(inputs));

  const synthesisPage = renderBusinessThesisSynthesis(inputs);
  const sourcePages = renderSourcePointers(inputs);
  const reportPages = renderReportSeeds(inputs);

  const pages: WikiInitialPage[] = [
    ...competitorPages,
    ...neighborhoodPages,
    ...customerArchetypePages,
    ...conceptPages,
    synthesisPage,
    ...sourcePages,
    ...reportPages,
  ];

  return {
    pages,
    droppedPhantomNames: dropped,
  };
}
