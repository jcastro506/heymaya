/**
 * generateBusinessPicture — service-product per-business synthesis.
 *
 * Sprint 2 implementation. Per § 5 step 8 + § 3 routing matrix:
 *   - Inputs: bulk-pull artifact (GBP photos + last 50 reviews + brand-voice
 *     samples = past review replies + GBP captions) + onboarding Q9-Q11
 *     (named local competitors, neighborhood emphasis, recurring local hooks).
 *   - Model: Gemini 3 Flash @ HIGH thinking budget. One-time onboarding cost
 *     absorbed at every tier (the alternative — Starter gets a low-thinking
 *     picture — would mean Starter Maya feels generic).
 *   - Multimodal: vision on photo URLs + text on review/caption corpus.
 *   - Output: `BusinessPictureLite` shape (per `./types.ts`) with the
 *     full `localPositioning` block (load-bearing per § 2 principle 3).
 *
 * Hallucination gate (§ 2 principle 4 + R1 grounding):
 *   - Defensive name-grounding pass: every name in `localPositioning.namedCompetitors`
 *     must either match an entry in `onboardingLocalAnswers.namedCompetitors`
 *     OR appear verbatim in the source review/caption corpus. Phantom names
 *     are a 0% target.
 *   - Defensive hook-grounding pass: every `recurringLocalHooks[].text` must
 *     match a substring of an operator-volunteered hook OR appear in the
 *     review/caption corpus. (Substring match because reviews mention
 *     neighborhoods/seasons by phrase, not exact-name.)
 *   - Failures collected into `__hallucinationFlags` and surfaced via the
 *     return type's diagnostic field for caller-side telemetry. The pipeline
 *     drops phantom rows but never silently keeps them.
 *
 * Why bypass `callMaya`:
 *   - `callMaya` enforces creator-product plan-tier thinking-budget clamps;
 *     the service product has its own routing matrix per § 3 (HIGH for
 *     synthesis at every tier). We call `callOpenRouter` directly, mirroring
 *     `synthesizeCreatorPicture`'s approach.
 */

import {
  callOpenRouter,
  OpenRouterError,
  type ChatMessage,
} from "../../modelRouter/openRouterClient";
import {
  computeCostUsd,
  GEMINI_3_FLASH_INPUT_PRICE_PER_MTOK as _PRICE_INPUT,
  GEMINI_3_FLASH_OUTPUT_PRICE_PER_MTOK as _PRICE_OUTPUT,
} from "../../modelRouter/maya";
import type {
  BusinessPictureLite,
  LocalPositioning,
  NamedCompetitor,
  RecurringLocalHook,
  ServiceWorkspaceInputs,
} from "./types";

void _PRICE_INPUT;
void _PRICE_OUTPUT;

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export interface BusinessPictureInputs {
  business: ServiceWorkspaceInputs["business"];
  /** Onboarding bulk-pull artifact: GBP profile + reviews + posts + photos + social posts. */
  bulkPullArtifact: {
    gbp: {
      reviews: ReadonlyArray<{
        body: string;
        starRating: number;
        reviewerName: string;
      }>;
      posts: ReadonlyArray<{
        body: string;
        ctaKind?: string;
        engagement?: number;
      }>;
      profile: { primaryCategory: string; address: string; city: string };
      /** Photo URLs the cataloger or bulk pull surfaced. Empty for skip. */
      photoUrls?: ReadonlyArray<string>;
      /** Past review replies — load-bearing brand-voice samples. */
      pastReviewReplies?: ReadonlyArray<string>;
    };
    socialPosts: ReadonlyArray<{
      platform: "facebook" | "instagram" | "tiktok" | "linkedin" | "x";
      caption: string;
      engagement?: number;
    }>;
  };
  /** Onboarding Q9-Q11 answers. */
  onboardingLocalAnswers: {
    namedCompetitors: ReadonlyArray<string>;
    neighborhoodEmphasis: ReadonlyArray<string>;
    operatorVolunteeredHooks: ReadonlyArray<string>;
  };
  /** OpenRouter API key. Required (caller resolves from env). */
  apiKey: string;
  /** Optional model override. Defaults to Gemini 3 Flash via OpenRouter. */
  model?: string;
  /** Test seam — defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Test seam — pinned timestamp for determinism. */
  now?: number;
}

export interface BusinessPictureSynthResult {
  picture: BusinessPictureLite & {
    generatedAt: number;
    model: string;
    thinkingBudget: "high";
    sourceCitations: ReadonlyArray<{
      kind: "review" | "post" | "operator-answer";
      externalRef: string;
      usedFor: string;
    }>;
  };
  cost: {
    usd: number;
    latencyMs: number;
  };
  /**
   * Diagnostic — hallucination-firewall flagged content. Empty array on a
   * clean run (target: 0% phantom names per § 2 principle 4). Surfaced for
   * caller-side telemetry; the picture itself drops phantom entries before
   * return.
   */
  hallucinationFlags: ReadonlyArray<{
    field: string;
    raw: string;
    reason: string;
  }>;
}

const SYNTH_MODEL_DEFAULT = "google/gemini-3-flash";

/* -------------------------------------------------------------------------- */
/* Synthesis prompt construction                                              */
/* -------------------------------------------------------------------------- */

interface PromptPayload {
  business: {
    name: string;
    serviceTypes: ReadonlyArray<string>;
    serviceArea: string;
    primaryCategory: string;
    city: string;
    address: string;
  };
  reviewSummaries: Array<{
    starRating: number;
    body: string;
    reviewerName: string;
  }>;
  postSummaries: Array<{ platform: string; body: string }>;
  brandVoiceSamples: {
    pastReviewReplies: ReadonlyArray<string>;
    gbpCaptions: ReadonlyArray<string>;
    fbIgCaptions: ReadonlyArray<string>;
  };
  operatorAnswers: BusinessPictureInputs["onboardingLocalAnswers"];
  photoUrls: ReadonlyArray<string>;
}

/** Bound the per-prompt corpus so a verbose operator doesn't blow the window. */
const REVIEW_LIMIT = 50;
const POST_LIMIT = 30;
const PHOTO_LIMIT = 8;
const SOCIAL_POST_LIMIT = 20;

function buildPromptPayload(inputs: BusinessPictureInputs): PromptPayload {
  const { business, bulkPullArtifact, onboardingLocalAnswers } = inputs;
  return {
    business: {
      name: business.name,
      serviceTypes: business.serviceTypes,
      serviceArea: business.serviceArea,
      primaryCategory: bulkPullArtifact.gbp.profile.primaryCategory,
      city: bulkPullArtifact.gbp.profile.city,
      address: bulkPullArtifact.gbp.profile.address,
    },
    reviewSummaries: bulkPullArtifact.gbp.reviews
      .slice(0, REVIEW_LIMIT)
      .map((r) => ({
        starRating: r.starRating,
        body: r.body,
        reviewerName: r.reviewerName,
      })),
    postSummaries: [
      ...bulkPullArtifact.gbp.posts.slice(0, POST_LIMIT).map((p) => ({
        platform: "gbp",
        body: p.body,
      })),
      ...bulkPullArtifact.socialPosts
        .slice(0, SOCIAL_POST_LIMIT)
        .map((p) => ({ platform: p.platform, body: p.caption })),
    ],
    brandVoiceSamples: {
      pastReviewReplies: bulkPullArtifact.gbp.pastReviewReplies ?? [],
      gbpCaptions: bulkPullArtifact.gbp.posts
        .slice(0, POST_LIMIT)
        .map((p) => p.body),
      fbIgCaptions: bulkPullArtifact.socialPosts
        .filter((p) => p.platform === "facebook" || p.platform === "instagram")
        .slice(0, SOCIAL_POST_LIMIT)
        .map((p) => p.caption),
    },
    operatorAnswers: onboardingLocalAnswers,
    photoUrls: (bulkPullArtifact.gbp.photoUrls ?? []).slice(0, PHOTO_LIMIT),
  };
}

/**
 * The system + user messages. We push the photo URLs in as `image_url` content
 * blocks if the OpenRouter model supports the multimodal block format; v0
 * uses plain text URLs in the user message which Gemini 3 Flash treats as
 * fetched references. The structured-output discipline lives in the prompt.
 */
function buildMessages(payload: PromptPayload): ChatMessage[] {
  const system = [
    "You are the synthesis engine for HeyMaya — an AI manager for service businesses.",
    "You are reading the operator's Google Business Profile reviews + posts + recent social posts + operator-supplied local context to produce a single grounded BusinessPicture JSON object.",
    "RULES:",
    "1. GROUND every claim. Every recurringServicePattern, customerSentiment phrase, and named competitor MUST cite either an operator answer OR a review/post by index.",
    "2. NEVER invent named competitors. Only include competitors the operator named in operatorAnswers.namedCompetitors OR that appear by exact name in a review/post.",
    "3. NEVER invent neighborhoods, hooks, or landmarks. localPositioning.servedNeighborhoods is the union of operatorAnswers.neighborhoodEmphasis + neighborhoods explicitly named in reviews.",
    "4. recurringLocalHooks[].text MUST be drawn from operatorAnswers.operatorVolunteeredHooks OR a review/post that mentions a local pattern.",
    "5. brandVoice is a stylometric description — sentence length, word choice, formality, common phrases. Quote 2-3 short verbatim phrases the operator uses.",
    "6. Output ONLY valid JSON conforming to the schema below. No prose before/after.",
    "",
    "OUTPUT SCHEMA (JSON):",
    "{",
    '  "brandVoice": "string — stylometric description of how the operator writes",',
    '  "brandVoiceSamples": [{ "source": "review-reply"|"gbp-post"|"fb-post"|"operator-quote", "text": "string" }],',
    '  "customerSentiment": "string — what customers consistently praise/complain about",',
    '  "recurringServicePatterns": ["string", ...],',
    '  "localPositioning": {',
    '    "servedZips": ["string", ...],',
    '    "servedNeighborhoods": ["string", ...],',
    '    "namedCompetitors": [{"name": "string", "reputationalNote": "string?", "gbpRating": number?}],',
    '    "recurringLocalHooks": [{"kind": "weather"|"event"|"landmark"|"sport"|"season"|"community", "text": "string"}],',
    '    "localChoiceThesis": "string — why locals choose this operator over alternatives, 1-2 sentences"',
    "  },",
    '  "sourceCitations": [{"kind":"review"|"post"|"operator-answer", "externalRef":"string", "usedFor":"string"}]',
    "}",
  ].join("\n");

  const user = [
    "BUSINESS:",
    JSON.stringify(payload.business, null, 2),
    "",
    `REVIEWS (${payload.reviewSummaries.length}):`,
    payload.reviewSummaries
      .map(
        (r, idx) =>
          `[review#${idx}] ${r.starRating}★ — ${r.reviewerName} — ${r.body}`
      )
      .join("\n"),
    "",
    `POSTS (${payload.postSummaries.length}):`,
    payload.postSummaries
      .map((p, idx) => `[post#${idx}] (${p.platform}) ${p.body}`)
      .join("\n"),
    "",
    "BRAND VOICE SAMPLES:",
    "- Past review replies (operator's actual voice):",
    payload.brandVoiceSamples.pastReviewReplies
      .slice(0, 10)
      .map((s, i) => `  [reply#${i}] ${s}`)
      .join("\n"),
    "- GBP post captions (operator's actual voice):",
    payload.brandVoiceSamples.gbpCaptions
      .slice(0, 10)
      .map((s, i) => `  [gbp#${i}] ${s}`)
      .join("\n"),
    "- FB/IG captions:",
    payload.brandVoiceSamples.fbIgCaptions
      .slice(0, 10)
      .map((s, i) => `  [social#${i}] ${s}`)
      .join("\n"),
    "",
    "OPERATOR ANSWERS (Q9 named competitors / Q10 neighborhoods / Q11 local hooks):",
    JSON.stringify(payload.operatorAnswers, null, 2),
    "",
    `PHOTO URLS (${payload.photoUrls.length}, multimodal):`,
    payload.photoUrls.map((u) => `- ${u}`).join("\n"),
    "",
    "Synthesize. Return only the JSON object.",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/* -------------------------------------------------------------------------- */
/* JSON parse + hallucination firewall                                         */
/* -------------------------------------------------------------------------- */

interface RawSynthOutput {
  brandVoice?: string;
  brandVoiceSamples?: Array<{ source?: string; text?: string }>;
  customerSentiment?: string;
  recurringServicePatterns?: string[];
  localPositioning?: {
    servedZips?: string[];
    servedNeighborhoods?: string[];
    namedCompetitors?: Array<{
      name?: string;
      reputationalNote?: string;
      gbpRating?: number;
    }>;
    recurringLocalHooks?: Array<{ kind?: string; text?: string }>;
    localChoiceThesis?: string;
  };
  sourceCitations?: Array<{
    kind?: string;
    externalRef?: string;
    usedFor?: string;
  }>;
}

const HOOK_KINDS = new Set([
  "weather",
  "event",
  "landmark",
  "sport",
  "season",
  "community",
]);

const SAMPLE_SOURCES = new Set([
  "review-reply",
  "gbp-post",
  "fb-post",
  "operator-quote",
]);

function tryParseJson(content: string): RawSynthOutput {
  // Models occasionally wrap output in ```json fences despite the rules.
  const stripped = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  return JSON.parse(stripped) as RawSynthOutput;
}

interface FirewallSourceBag {
  reviewBodies: string[];
  postBodies: string[];
  operatorCompetitors: ReadonlyArray<string>;
  operatorNeighborhoods: ReadonlyArray<string>;
  operatorHooks: ReadonlyArray<string>;
}

function lc(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Defensive name-grounding pass. Returns the filtered competitor list + a
 * list of phantom-name flags. Any competitor name that doesn't match an
 * operator answer or appear verbatim (case-insensitive) in a review or post
 * is dropped + flagged.
 */
function filterCompetitors(
  raw: NonNullable<RawSynthOutput["localPositioning"]>["namedCompetitors"],
  bag: FirewallSourceBag
): {
  kept: NamedCompetitor[];
  flags: Array<{ field: string; raw: string; reason: string }>;
} {
  const flags: Array<{ field: string; raw: string; reason: string }> = [];
  const kept: NamedCompetitor[] = [];
  if (!raw) return { kept, flags };
  const operatorSet = new Set(bag.operatorCompetitors.map(lc));
  for (const c of raw) {
    if (!c?.name || c.name.trim().length === 0) continue;
    const lname = lc(c.name);
    if (operatorSet.has(lname)) {
      kept.push({
        name: c.name.trim(),
        reputationalNote: c.reputationalNote?.trim(),
        gbpRating:
          typeof c.gbpRating === "number" ? c.gbpRating : undefined,
      });
      continue;
    }
    const inReviews = bag.reviewBodies.some((b) =>
      b.toLowerCase().includes(lname)
    );
    const inPosts = bag.postBodies.some((b) =>
      b.toLowerCase().includes(lname)
    );
    if (inReviews || inPosts) {
      kept.push({
        name: c.name.trim(),
        reputationalNote: c.reputationalNote?.trim(),
        gbpRating:
          typeof c.gbpRating === "number" ? c.gbpRating : undefined,
      });
    } else {
      flags.push({
        field: "localPositioning.namedCompetitors",
        raw: c.name,
        reason:
          "phantom-name: not in operator answers and not present in any review or post",
      });
    }
  }
  return { kept, flags };
}

function filterHooks(
  raw: NonNullable<RawSynthOutput["localPositioning"]>["recurringLocalHooks"],
  bag: FirewallSourceBag
): {
  kept: RecurringLocalHook[];
  flags: Array<{ field: string; raw: string; reason: string }>;
} {
  const flags: Array<{ field: string; raw: string; reason: string }> = [];
  const kept: RecurringLocalHook[] = [];
  if (!raw) return { kept, flags };
  const operatorHookText = bag.operatorHooks.map(lc);
  for (const h of raw) {
    if (!h?.text || h.text.trim().length === 0) continue;
    if (!h.kind || !HOOK_KINDS.has(h.kind)) {
      flags.push({
        field: "localPositioning.recurringLocalHooks.kind",
        raw: String(h.kind),
        reason: `unknown hook kind; expected one of ${[...HOOK_KINDS].join("/")}`,
      });
      continue;
    }
    const ltxt = lc(h.text);
    const matchesOperator = operatorHookText.some(
      (o) => ltxt.includes(o) || o.includes(ltxt)
    );
    const matchesReview = bag.reviewBodies.some((b) =>
      b.toLowerCase().includes(ltxt)
    );
    const matchesPost = bag.postBodies.some((b) =>
      b.toLowerCase().includes(ltxt)
    );
    if (matchesOperator || matchesReview || matchesPost) {
      kept.push({
        kind: h.kind as RecurringLocalHook["kind"],
        text: h.text.trim(),
      });
    } else {
      flags.push({
        field: "localPositioning.recurringLocalHooks",
        raw: h.text,
        reason:
          "phantom-hook: not in operator answers and not substring-present in any review or post",
      });
    }
  }
  return { kept, flags };
}

/* -------------------------------------------------------------------------- */
/* Main entry — replaces the Wave A shell                                      */
/* -------------------------------------------------------------------------- */

export async function generateBusinessPicture(
  inputs: BusinessPictureInputs
): Promise<BusinessPictureSynthResult> {
  if (!inputs.apiKey) {
    throw new Error(
      "generateBusinessPicture: openrouter apiKey is required (caller resolves from env)."
    );
  }
  const payload = buildPromptPayload(inputs);
  const messages = buildMessages(payload);
  const model = inputs.model ?? SYNTH_MODEL_DEFAULT;
  const start = Date.now();

  let result;
  try {
    result = await callOpenRouter({
      model,
      messages,
      thinkingBudget: "high",
      apiKey: inputs.apiKey,
      fetchImpl: inputs.fetchImpl,
    });
  } catch (err) {
    if (err instanceof OpenRouterError) {
      throw err;
    }
    throw new Error(
      `generateBusinessPicture: OpenRouter call failed: ${(err as Error).message}`
    );
  }
  const latencyMs = Date.now() - start;

  let parsed: RawSynthOutput;
  try {
    parsed = tryParseJson(result.content);
  } catch (err) {
    throw new Error(
      `generateBusinessPicture: model output was not valid JSON: ${(err as Error).message}. Output head: ${result.content.slice(0, 200)}`
    );
  }

  // Hallucination firewall.
  const bag: FirewallSourceBag = {
    reviewBodies: payload.reviewSummaries.map((r) => r.body),
    postBodies: payload.postSummaries.map((p) => p.body),
    operatorCompetitors: inputs.onboardingLocalAnswers.namedCompetitors,
    operatorNeighborhoods: inputs.onboardingLocalAnswers.neighborhoodEmphasis,
    operatorHooks: inputs.onboardingLocalAnswers.operatorVolunteeredHooks,
  };
  const { kept: keptCompetitors, flags: competitorFlags } = filterCompetitors(
    parsed.localPositioning?.namedCompetitors,
    bag
  );
  const { kept: keptHooks, flags: hookFlags } = filterHooks(
    parsed.localPositioning?.recurringLocalHooks,
    bag
  );

  // Built-in defensive defaults: union operator-supplied neighborhoods with
  // synth-emitted ones. The synth shouldn't drop operator answers; if it
  // does, this restoration ensures Q10 is honored.
  const neighborhoods = uniq([
    ...inputs.onboardingLocalAnswers.neighborhoodEmphasis,
    ...(parsed.localPositioning?.servedNeighborhoods ?? []),
  ]).map((s) => s.trim()).filter((s) => s.length > 0);

  const localPositioning: LocalPositioning = {
    servedZips: (parsed.localPositioning?.servedZips ?? []).filter(
      (z) => /^\d{5}$/.test(z.trim())
    ),
    servedNeighborhoods: neighborhoods,
    namedCompetitors: keptCompetitors,
    recurringLocalHooks: keptHooks,
    localChoiceThesis:
      parsed.localPositioning?.localChoiceThesis?.trim() ?? "",
  };

  const samples = (parsed.brandVoiceSamples ?? [])
    .filter(
      (s): s is { source: string; text: string } =>
        typeof s?.source === "string" &&
        typeof s?.text === "string" &&
        SAMPLE_SOURCES.has(s.source)
    )
    .map((s) => ({
      source: s.source as
        | "review-reply"
        | "gbp-post"
        | "fb-post"
        | "operator-quote",
      text: s.text.trim(),
    }));

  const sourceCitations = (parsed.sourceCitations ?? [])
    .filter(
      (c): c is { kind: string; externalRef: string; usedFor: string } =>
        typeof c?.kind === "string" &&
        typeof c?.externalRef === "string" &&
        typeof c?.usedFor === "string"
    )
    .map((c) => ({
      kind: (c.kind === "review" || c.kind === "post" || c.kind === "operator-answer"
        ? c.kind
        : "operator-answer") as "review" | "post" | "operator-answer",
      externalRef: c.externalRef,
      usedFor: c.usedFor,
    }));

  const picture: BusinessPictureSynthResult["picture"] = {
    brandVoice: parsed.brandVoice?.trim() ?? "",
    brandVoiceSamples: samples,
    customerSentiment: parsed.customerSentiment?.trim(),
    recurringServicePatterns: (parsed.recurringServicePatterns ?? []).map(
      (s) => s.trim()
    ).filter((s) => s.length > 0),
    localPositioning,
    generatedAt: inputs.now ?? Date.now(),
    model: result.model,
    thinkingBudget: "high" as const,
    sourceCitations,
  };

  const usage = result.usage;
  const costUsd = computeCostUsd(usage);

  return {
    picture,
    cost: { usd: costUsd, latencyMs },
    hallucinationFlags: [...competitorFlags, ...hookFlags],
  };
}

function uniq(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = v.trim().toLowerCase();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v.trim());
  }
  return out;
}
