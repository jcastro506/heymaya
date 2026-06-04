/**
 * Sprint 6 (top-tier) — the strategic partner. Extends honesty from "your POST
 * flopped" to "your POSITIONING / PMF / PRICING is the problem" — grounded,
 * humble, evidence-required.
 *
 * The #1 guard: a WRONG hard truth ("you don't have PMF") is worse than silence.
 * So PMF/pricing verdicts are hard-capped at "lean", always paired with "this is
 * what I can't see from outside; run X", and a hard-truth PING only fires when a
 * STRONG non-distribution verdict has PERSISTED ≥2 weeks AND we haven't pinged
 * recently. The pure logic here makes all of that testable + deterministic.
 *
 * State lives on gtmAgents.strategicDiagnosisJson (JSON-on-row — NO new table).
 */
import { v } from "convex/values";
import { httpAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { authenticate } from "./openclaw/inboundCallback";

export const DIAGNOSIS_CATEGORIES = [
  "messaging",
  "positioning",
  "pmf_suspected",
  "pricing",
  "distribution",
] as const;
export type DiagnosisCategory = (typeof DIAGNOSIS_CATEGORIES)[number];

export const DIAGNOSIS_TIERS = ["hunch", "lean", "strong"] as const;
export type DiagnosisTier = (typeof DIAGNOSIS_TIERS)[number];

/** Categories where a high-confidence external verdict is impossible — we can't
 *  see retention or willingness-to-pay from outside, so we NEVER assert "strong". */
const HARD_CAPPED_AT_LEAN: ReadonlySet<DiagnosisCategory> = new Set([
  "pmf_suspected",
  "pricing",
]);

const WEEK_MS = 7 * 86_400_000;
/** A hard-truth ping needs the verdict to have persisted at least this long. */
const PERSIST_WEEKS_FOR_PING = 2;
/** Don't ping more than once per ~3 weeks (a hard truth nagged is a hard truth ignored). */
const PING_THROTTLE_MS = 21 * 86_400_000;
/** Survey proposals are offered at most once per ~3 weeks each. */
const SURVEY_THROTTLE_MS = 21 * 86_400_000;

export interface DiagnosisVerdict {
  category: DiagnosisCategory;
  tier: DiagnosisTier;
  observedAt: number;
}

export interface DiagnosisState {
  current?: DiagnosisVerdict & { weeksPersisted: number; reason?: string };
  history: Array<{ category: DiagnosisCategory; tier: DiagnosisTier; observedAt: number }>;
  lastHardTruthPingAt?: number;
  lastPmfSurveyAt?: number;
  lastPricingTestAt?: number;
}

const tierRank = (t: DiagnosisTier): number => DIAGNOSIS_TIERS.indexOf(t);

/** Enforce the hard cap: PMF/pricing can never be asserted above "lean". */
export function capTier(category: DiagnosisCategory, tier: DiagnosisTier): DiagnosisTier {
  if (HARD_CAPPED_AT_LEAN.has(category) && tierRank(tier) > tierRank("lean")) {
    return "lean";
  }
  return tier;
}

function emptyState(): DiagnosisState {
  return { history: [] };
}

export function parseDiagnosis(json: string | undefined): DiagnosisState {
  if (!json) return emptyState();
  try {
    const parsed = JSON.parse(json) as DiagnosisState;
    return { ...parsed, history: parsed.history ?? [] };
  } catch {
    return emptyState();
  }
}

/**
 * Fold a fresh weekly verdict into prior state. Computes how many consecutive
 * weeks the SAME category has now persisted (the signal that it's real, not a
 * one-week blip), and whether a hard-truth ping is allowed RIGHT NOW.
 *
 * A ping fires only when ALL hold:
 *   - the (capped) tier is "strong",
 *   - the category is NOT "distribution" (distribution = "post more", not a hard truth),
 *   - the same category has persisted ≥ PERSIST_WEEKS_FOR_PING weeks,
 *   - we haven't pinged within PING_THROTTLE_MS.
 * Pure — no DB, no clock; `nowMs` is passed in.
 */
export function foldDiagnosis(
  prior: DiagnosisState,
  verdict: { category: DiagnosisCategory; tier: DiagnosisTier; reason?: string },
  nowMs: number
): { state: DiagnosisState; shouldPing: boolean; weeksPersisted: number } {
  const tier = capTier(verdict.category, verdict.tier);

  // Consecutive-week persistence: walk history back while the category matches
  // and each step is within ~1.5 weeks of the previous (a real weekly cadence).
  let weeksPersisted = 1;
  const priorCurrent = prior.current;
  if (priorCurrent && priorCurrent.category === verdict.category) {
    const gap = nowMs - priorCurrent.observedAt;
    if (gap <= WEEK_MS * 1.5) {
      weeksPersisted = (priorCurrent.weeksPersisted ?? 1) + 1;
    }
  }

  const isPingCandidate =
    tier === "strong" &&
    verdict.category !== "distribution" &&
    weeksPersisted >= PERSIST_WEEKS_FOR_PING;
  const throttleOk =
    prior.lastHardTruthPingAt === undefined ||
    nowMs - prior.lastHardTruthPingAt >= PING_THROTTLE_MS;
  const shouldPing = isPingCandidate && throttleOk;

  const history = [...prior.history, { category: verdict.category, tier, observedAt: nowMs }].slice(-12);
  const state: DiagnosisState = {
    ...prior,
    current: { category: verdict.category, tier, observedAt: nowMs, weeksPersisted, reason: verdict.reason },
    history,
    lastHardTruthPingAt: shouldPing ? nowMs : prior.lastHardTruthPingAt,
  };
  return { state, shouldPing, weeksPersisted };
}

/** Whether a survey may be proposed now (per-type throttle). Pure. */
export function canProposeSurvey(
  lastAt: number | undefined,
  nowMs: number
): boolean {
  return lastAt === undefined || nowMs - lastAt >= SURVEY_THROTTLE_MS;
}

/** Sean-Ellis PMF survey (the 40% test). Canonical, plain-language. */
export function seanEllisSurvey(productName: string): {
  instrument: string;
  questions: string[];
  scoring: string;
} {
  return {
    instrument: "sean-ellis-pmf",
    questions: [
      `How would you feel if you could no longer use ${productName}? (Very disappointed / Somewhat disappointed / Not disappointed)`,
      `What type of person do you think would most benefit from ${productName}?`,
      `What is the main benefit you get from ${productName}?`,
      `How can we improve ${productName} for you?`,
    ],
    scoring:
      "If ≥40% answer 'Very disappointed', that's the strongest signal of product-market fit. Below 40% means keep iterating on the core before scaling distribution.",
  };
}

/** Van Westendorp price-sensitivity (4 questions). Canonical, plain-language. */
export function vanWestendorpSurvey(productName: string): {
  instrument: string;
  questions: string[];
  scoring: string;
} {
  return {
    instrument: "van-westendorp-pricing",
    questions: [
      `At what price would ${productName} be so expensive you would not consider buying it?`,
      `At what price would ${productName} be priced so low you'd question its quality?`,
      `At what price would ${productName} start to feel expensive, but you'd still consider it?`,
      `At what price would ${productName} be a great deal — a definite buy?`,
    ],
    scoring:
      "The overlap of the 'too cheap'↔'expensive' and 'too expensive'↔'good deal' curves brackets the acceptable price range; the crossover points suggest the optimal price point.",
  };
}

// ───────────────────────── persistence + httpActions ─────────────────────────

export const readDiagnosis = internalQuery({
  args: { agentId: v.id("gtmAgents"), accountId: v.id("creators") },
  handler: async (ctx, args): Promise<DiagnosisState> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.accountId !== args.accountId) return emptyState();
    return parseDiagnosis(agent.strategicDiagnosisJson);
  },
});

export const writeDiagnosis = internalMutation({
  args: { agentId: v.id("gtmAgents"), accountId: v.id("creators"), state: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.accountId !== args.accountId) return;
    await ctx.db.patch(args.agentId, { strategicDiagnosisJson: args.state });
  },
});

interface SaveDiagnosisPayload {
  category?: string;
  tier?: string;
  reason?: string;
  nowMs?: number;
}

/**
 * POST /lc_gtm/save_diagnosis — record this week's strategic verdict. Returns
 * the CAPPED verdict + whether a hard-truth ping is warranted now + how many
 * weeks it's persisted. PMF/pricing are auto-capped to "lean" server-side, so
 * Maya can't accidentally assert a verdict the data can't support.
 */
export const saveDiagnosisHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: SaveDiagnosisPayload;
  try {
    body = (await request.json()) as SaveDiagnosisPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const category = body.category as DiagnosisCategory;
  const tier = body.tier as DiagnosisTier;
  if (
    !DIAGNOSIS_CATEGORIES.includes(category) ||
    !DIAGNOSIS_TIERS.includes(tier)
  ) {
    return new Response(
      JSON.stringify({ ok: false, reason: "invalid_category_or_tier" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }
  const nowMs = typeof body.nowMs === "number" ? body.nowMs : Date.now();
  const prior = await ctx.runQuery(internal.gtmMaya.strategicDiagnosis.readDiagnosis, {
    agentId: auth.agentId,
    accountId: auth.accountId,
  });
  const { state, shouldPing, weeksPersisted } = foldDiagnosis(
    prior,
    { category, tier, reason: typeof body.reason === "string" ? body.reason : undefined },
    nowMs
  );
  await ctx.runMutation(internal.gtmMaya.strategicDiagnosis.writeDiagnosis, {
    agentId: auth.agentId,
    accountId: auth.accountId,
    state: JSON.stringify(state),
  });
  return new Response(
    JSON.stringify({
      ok: true,
      category,
      tier: capTier(category, tier), // the honest, capped tier
      cappedFrom: tier !== capTier(category, tier) ? tier : undefined,
      weeksPersisted,
      shouldHardTruthPing: shouldPing,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});

interface ProposeSurveyPayload {
  productName?: string;
  nowMs?: number;
}

/** POST /lc_gtm/propose_pmf_survey — Sean-Ellis 40% test, throttled to ≤ once/~3wk. */
export const proposePmfSurveyHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: ProposeSurveyPayload;
  try {
    body = (await request.json()) as ProposeSurveyPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const nowMs = typeof body.nowMs === "number" ? body.nowMs : Date.now();
  const productName =
    typeof body.productName === "string" && body.productName.trim()
      ? body.productName.trim()
      : "your product";
  const prior = await ctx.runQuery(internal.gtmMaya.strategicDiagnosis.readDiagnosis, {
    agentId: auth.agentId,
    accountId: auth.accountId,
  });
  if (!canProposeSurvey(prior.lastPmfSurveyAt, nowMs)) {
    return new Response(JSON.stringify({ ok: false, reason: "throttled" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  await ctx.runMutation(internal.gtmMaya.strategicDiagnosis.writeDiagnosis, {
    agentId: auth.agentId,
    accountId: auth.accountId,
    state: JSON.stringify({ ...prior, lastPmfSurveyAt: nowMs }),
  });
  return new Response(JSON.stringify({ ok: true, survey: seanEllisSurvey(productName) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/** POST /lc_gtm/propose_pricing_test — van Westendorp, throttled to ≤ once/~3wk. */
export const proposePricingTestHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: ProposeSurveyPayload;
  try {
    body = (await request.json()) as ProposeSurveyPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const nowMs = typeof body.nowMs === "number" ? body.nowMs : Date.now();
  const productName =
    typeof body.productName === "string" && body.productName.trim()
      ? body.productName.trim()
      : "your product";
  const prior = await ctx.runQuery(internal.gtmMaya.strategicDiagnosis.readDiagnosis, {
    agentId: auth.agentId,
    accountId: auth.accountId,
  });
  if (!canProposeSurvey(prior.lastPricingTestAt, nowMs)) {
    return new Response(JSON.stringify({ ok: false, reason: "throttled" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  await ctx.runMutation(internal.gtmMaya.strategicDiagnosis.writeDiagnosis, {
    agentId: auth.agentId,
    accountId: auth.accountId,
    state: JSON.stringify({ ...prior, lastPricingTestAt: nowMs }),
  });
  return new Response(JSON.stringify({ ok: true, survey: vanWestendorpSurvey(productName) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
