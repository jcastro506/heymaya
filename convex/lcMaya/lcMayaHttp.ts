/**
 * `lc_maya.*` HTTP endpoints — Maya's first-boot iMessage flow.
 *
 * Maya the agent runs in OpenClaw (separate runtime from Convex). She talks
 * to Convex via webhook-secret-gated `lc_maya.*` HTTP endpoints. This file
 * implements the two endpoints needed for the first-boot iMessage flow to
 * work end-to-end:
 *
 *  1. `POST /lc_maya/submit_opening_answers`
 *     Maya sends her 3 opening Q's (goal / tone / brand-deal floor) over
 *     iMessage, the creator replies, Maya parses the reply, and POSTs the
 *     structured answers here. We persist them onto `creatorPicture` and
 *     stamp `creators.openingAnswersAt`. The `first_weekly_plan` standing
 *     order keys off that timestamp.
 *
 *  2. `POST /lc_maya/start_oauth`
 *     Maya needs an OAuth deep-link for Gmail / GoogleCalendar / TikTok /
 *     LinkedIn / X. She POSTs here, we call Composio's
 *     `/api/v3/connectedAccounts/initiate` (via the shared
 *     `internal.integrations.composio.oauth.initiateOAuthForCreator`
 *     internal action — same logic as `convex/integrations/composio/oauth.ts:startOAuth`),
 *     and return the hosted Composio connect URL. Maya texts the URL via
 *     iMessage. Creator taps, OAuth completes on Composio's hosted page,
 *     connected account stored under `entityId = creatorId`.
 *
 * Auth: both endpoints validate `WEBHOOK_INTERNAL_SECRET` via
 * `assertWebhookSecret(body.secret)` (constant-time compare, fail-closed —
 * see `convex/lib/webhookSecret.ts`). The secret MUST be set in BOTH the
 * Next.js env and the Convex env; missing/mismatched → 401.
 *
 * Failure modes (both endpoints):
 *   - Missing/invalid secret  → 401
 *   - Body parse fail         → 400
 *   - Creator not found       → 404
 *   - Plan-tier gate fail     → 403  (only meaningful for start_oauth)
 *   - Internal mutation throw → 500  (Maya retries)
 *
 * Cross-tenant safety: both endpoints take `creatorId` from the request
 * body. The body is signed by the shared secret (so only callers who hold
 * the secret can write any creator), and we look up the row by exact id —
 * we never patch a different creator. The `start_oauth` endpoint passes
 * `entityId = creatorId` to Composio so per-creator scoping is preserved
 * end-to-end on the OAuth side too.
 */

import { httpAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { assertWebhookSecret } from "../lib/webhookSecret";

const PROVIDER_LITERALS = [
  "gmail",
  "googlecalendar",
  "tiktok",
  "linkedin",
  "twitter",
] as const;

type LcMayaProvider = (typeof PROVIDER_LITERALS)[number];

const TREND_SOURCE_LITERALS = [
  "niche-scan",
  "platform-wide",
  "industry-intel",
  "competitor-watch",
] as const;

const TREND_EVIDENCE_KIND_LITERALS = [
  "post",
  "hashtag",
  "sound",
  "article",
  "metric",
] as const;

type TrendSource = (typeof TREND_SOURCE_LITERALS)[number];
type TrendEvidenceKind = (typeof TREND_EVIDENCE_KIND_LITERALS)[number];

/**
 * Composio internally distinguishes "calendar" (Google Calendar) from any
 * other calendar variant. The `lc_maya.*` surface uses the more explicit
 * `googlecalendar` slug because Maya's playbook references multiple
 * possible OAuth providers; map to the underlying composio slug here.
 *
 * Creator TikTok is intentionally not a Composio OAuth provider; it uses
 * ScrapeCreators public data. Builder LinkedIn and X/Twitter do use
 * Composio OAuth.
 */
const PROVIDER_TO_PLAN_FEATURES_KEY: Partial<
  Record<LcMayaProvider, "gmail" | "calendar" | "linkedin" | "twitter">
> = {
  gmail: "gmail",
  googlecalendar: "calendar",
  linkedin: "linkedin",
  twitter: "twitter",
  // tiktok intentionally absent — see comment above.
};

/* -------------------------------------------------------------------------- */
/* Endpoint 1 — submit_opening_answers                                         */
/* -------------------------------------------------------------------------- */

interface SubmitOpeningAnswersPayload {
  secret: string;
  creatorId: string;
  goal: string;
  tone: "supportive" | "strategic" | "tough-love";
  brandDealFloorUsd?: number;
}

function isToneLiteral(
  value: unknown
): value is SubmitOpeningAnswersPayload["tone"] {
  return (
    value === "supportive" || value === "strategic" || value === "tough-love"
  );
}

function parseSubmitOpeningAnswersPayload(
  raw: unknown
): SubmitOpeningAnswersPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Body must be a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  // `secret` field shape only — value validation runs in `assertWebhookSecret`
  // so missing/empty/wrong secrets all surface as 401, not 400.
  if (typeof obj.secret !== "string") {
    throw new Error("secret must be a string.");
  }
  if (typeof obj.creatorId !== "string" || obj.creatorId.length === 0) {
    throw new Error("creatorId is required.");
  }
  if (typeof obj.goal !== "string" || obj.goal.trim().length === 0) {
    throw new Error("goal must be a non-empty string.");
  }
  if (!isToneLiteral(obj.tone)) {
    throw new Error("tone must be one of supportive | strategic | tough-love.");
  }
  let brandDealFloorUsd: number | undefined;
  if (obj.brandDealFloorUsd !== undefined && obj.brandDealFloorUsd !== null) {
    if (
      typeof obj.brandDealFloorUsd !== "number" ||
      !Number.isFinite(obj.brandDealFloorUsd) ||
      obj.brandDealFloorUsd < 0
    ) {
      throw new Error(
        "brandDealFloorUsd must be a non-negative finite number when provided."
      );
    }
    brandDealFloorUsd = obj.brandDealFloorUsd;
  }
  return {
    secret: obj.secret,
    creatorId: obj.creatorId,
    goal: obj.goal,
    tone: obj.tone,
    brandDealFloorUsd,
  };
}

/**
 * Internal mutation that persists the parsed opening answers. Split from
 * the httpAction so the unit tests can call it directly via `t.mutation`
 * (without spinning the full HTTP surface) AND so the httpAction stays a
 * thin wrapper that just owns request parsing + auth.
 */
export const submitOpeningAnswersInternal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    goal: v.string(),
    tone: v.union(
      v.literal("supportive"),
      v.literal("strategic"),
      v.literal("tough-love")
    ),
    brandDealFloorUsd: v.optional(v.number()),
    nowMs: v.number(),
  },
  handler: async (ctx, args): Promise<{ pictureId: Id<"creatorPicture"> }> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("creator-not-found");
    }

    // Stamp the canonical "Maya has the basics" timestamp on the creators
    // row. The `first_weekly_plan` standing order keys off this.
    await ctx.db.patch(creator._id, { openingAnswersAt: args.nowMs });

    const openingAnswersPayload: {
      goal: string;
      tone: SubmitOpeningAnswersPayload["tone"];
      brandDealFloorUsd?: number;
      submittedAt: number;
    } = {
      goal: args.goal,
      tone: args.tone,
      submittedAt: args.nowMs,
    };
    if (args.brandDealFloorUsd !== undefined) {
      openingAnswersPayload.brandDealFloorUsd = args.brandDealFloorUsd;
    }

    const existing = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        openingAnswers: openingAnswersPayload,
      });
      return { pictureId: existing._id };
    }

    // No picture row yet — the multimodal synthesis hasn't run. Insert a
    // placeholder row marked `awaiting-synthesis` so synthesis can patch
    // when it lands. This mirrors the pattern in
    // `convex/creators.ts:submitOnboardingAnswers`.
    const pictureId = await ctx.db.insert("creatorPicture", {
      creatorId: creator._id,
      niche: "",
      audience: { ageRanges: [], topGeos: [], interestTags: [] },
      voiceFingerprint: "",
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      generatedAt: args.nowMs,
      model: "awaiting-synthesis",
      sourceCitations: [],
      openingAnswers: openingAnswersPayload,
    });
    return { pictureId };
  },
});

export const submitOpeningAnswersHttp = httpAction(async (ctx, request) => {
  let payload: SubmitOpeningAnswersPayload;
  try {
    payload = parseSubmitOpeningAnswersPayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(payload.secret);
  } catch {
    // Vague message + 401 to avoid leaking unset-vs-mismatched.
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    await ctx.runMutation(
      internal.lcMaya.lcMayaHttp.submitOpeningAnswersInternal,
      {
        creatorId: payload.creatorId as Id<"creators">,
        goal: payload.goal,
        tone: payload.tone,
        brandDealFloorUsd: payload.brandDealFloorUsd,
        nowMs: Date.now(),
      }
    );
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    const msg = (err as Error).message ?? "internal-error";
    if (msg === "creator-not-found") {
      return jsonResponse({ error: "creator-not-found" }, 404);
    }
    return jsonResponse({ error: msg }, 500);
  }
});

/* -------------------------------------------------------------------------- */
/* Endpoint 2 — start_oauth                                                    */
/* -------------------------------------------------------------------------- */

interface StartOAuthPayload {
  secret: string;
  creatorId: string;
  provider: LcMayaProvider;
  redirectUri: string;
}

function isLcMayaProvider(value: unknown): value is LcMayaProvider {
  return (
    typeof value === "string" &&
    (PROVIDER_LITERALS as readonly string[]).includes(value)
  );
}

function parseStartOAuthPayload(raw: unknown): StartOAuthPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Body must be a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  // `secret` field shape only — value validation runs in `assertWebhookSecret`
  // so missing/empty/wrong secrets all surface as 401, not 400.
  if (typeof obj.secret !== "string") {
    throw new Error("secret must be a string.");
  }
  if (typeof obj.creatorId !== "string" || obj.creatorId.length === 0) {
    throw new Error("creatorId is required.");
  }
  if (!isLcMayaProvider(obj.provider)) {
    throw new Error(
      `provider must be one of ${PROVIDER_LITERALS.join(" | ")}.`
    );
  }
  if (typeof obj.redirectUri !== "string" || obj.redirectUri.length === 0) {
    throw new Error("redirectUri is required.");
  }
  return {
    secret: obj.secret,
    creatorId: obj.creatorId,
    provider: obj.provider,
    redirectUri: obj.redirectUri,
  };
}

export const startOAuthHttp = httpAction(async (ctx, request) => {
  let payload: StartOAuthPayload;
  try {
    payload = parseStartOAuthPayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  // Resolve which `Provider` (per `convex/lib/planFeatures.ts`) this maps
  // to. Providers without a mapping are not yet wired on the read/write
  // side, so we reject them at the gate with a stable error code Maya can
  // recognize and text the creator about.
  const planProvider = PROVIDER_TO_PLAN_FEATURES_KEY[payload.provider];
  if (!planProvider) {
    return jsonResponse(
      {
        error: "provider-not-supported",
        provider: payload.provider,
      },
      403
    );
  }

  // Look up the creator FIRST so we can return 404 cleanly. The shared
  // core also looks the row up, but we want a clean status separation
  // between "creator missing" (404) and "plan tier blocks this" (403).
  const creator = await ctx.runQuery(
    internal.integrations.composio.oauth.getCreatorByIdForOAuth,
    { creatorId: payload.creatorId as Id<"creators"> }
  );
  if (!creator) {
    return jsonResponse({ error: "creator-not-found" }, 404);
  }

  try {
    const result = await ctx.runAction(
      internal.integrations.composio.oauth.initiateOAuthForCreator,
      {
        creatorId: payload.creatorId as Id<"creators">,
        provider: planProvider,
        redirectUri: payload.redirectUri,
      }
    );
    return jsonResponse(result, 200);
  } catch (err) {
    const msg = (err as Error).message ?? "internal-error";
    // PlanGateError doesn't survive `runAction` boundary as a class — Convex
    // serializes errors by message. Match the message shape from
    // `PlanGateError.constructor` (see `convex/lib/planFeatures.ts`).
    // Format: `Plan '<plan>' cannot access '<feature>'. Requires '<required>' or higher.`
    if (/^Plan '.*' cannot access '.*'\. Requires '.*' or higher\.$/.test(msg)) {
      return jsonResponse(
        {
          error: "plan-tier-gate",
          message: msg,
        },
        403
      );
    }
    return jsonResponse({ error: msg }, 500);
  }
});

/* -------------------------------------------------------------------------- */
/* Endpoint 3 — log_trend                                                      */
/* -------------------------------------------------------------------------- */

interface LogTrendPayload {
  secret: string;
  creatorId: string;
  source: TrendSource;
  observation: string;
  evidence: Array<{
    kind: TrendEvidenceKind;
    ref: string;
    fact: string;
  }>;
  relevanceScore: number;
}

function isTrendSource(value: unknown): value is TrendSource {
  return (
    typeof value === "string" &&
    (TREND_SOURCE_LITERALS as readonly string[]).includes(value)
  );
}

function isTrendEvidenceKind(value: unknown): value is TrendEvidenceKind {
  return (
    typeof value === "string" &&
    (TREND_EVIDENCE_KIND_LITERALS as readonly string[]).includes(value)
  );
}

function parseLogTrendPayload(raw: unknown): LogTrendPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Body must be a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.secret !== "string") {
    throw new Error("secret must be a string.");
  }
  if (typeof obj.creatorId !== "string" || obj.creatorId.length === 0) {
    throw new Error("creatorId is required.");
  }
  if (!isTrendSource(obj.source)) {
    throw new Error(
      `source must be one of ${TREND_SOURCE_LITERALS.join(" | ")}.`
    );
  }
  if (typeof obj.observation !== "string" || obj.observation.trim().length === 0) {
    throw new Error("observation must be a non-empty string.");
  }
  if (!Array.isArray(obj.evidence)) {
    throw new Error("evidence must be an array.");
  }
  const evidence = obj.evidence.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`evidence[${index}] must be an object.`);
    }
    const evidenceItem = item as Record<string, unknown>;
    if (!isTrendEvidenceKind(evidenceItem.kind)) {
      throw new Error(
        `evidence[${index}].kind must be one of ${TREND_EVIDENCE_KIND_LITERALS.join(" | ")}.`
      );
    }
    if (typeof evidenceItem.ref !== "string" || evidenceItem.ref.trim().length === 0) {
      throw new Error(`evidence[${index}].ref must be a non-empty string.`);
    }
    if (
      typeof evidenceItem.fact !== "string" ||
      evidenceItem.fact.trim().length === 0
    ) {
      throw new Error(`evidence[${index}].fact must be a non-empty string.`);
    }
    return {
      kind: evidenceItem.kind,
      ref: evidenceItem.ref,
      fact: evidenceItem.fact,
    };
  });
  if (
    typeof obj.relevanceScore !== "number" ||
    !Number.isFinite(obj.relevanceScore) ||
    obj.relevanceScore < 0 ||
    obj.relevanceScore > 1
  ) {
    throw new Error("relevanceScore must be in [0, 1].");
  }
  return {
    secret: obj.secret,
    creatorId: obj.creatorId,
    source: obj.source,
    observation: obj.observation,
    evidence,
    relevanceScore: obj.relevanceScore,
  };
}

export const logTrendInternal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    source: v.union(
      v.literal("niche-scan"),
      v.literal("platform-wide"),
      v.literal("industry-intel"),
      v.literal("competitor-watch")
    ),
    observation: v.string(),
    evidence: v.array(
      v.object({
        kind: v.union(
          v.literal("post"),
          v.literal("hashtag"),
          v.literal("sound"),
          v.literal("article"),
          v.literal("metric")
        ),
        ref: v.string(),
        fact: v.string(),
      })
    ),
    relevanceScore: v.number(),
    observedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("creator-not-found");
    }
    return await ctx.db.insert("trendObservations", {
      creatorId: args.creatorId,
      source: args.source,
      observation: args.observation,
      evidence: args.evidence,
      relevanceScore: args.relevanceScore,
      observedAt: args.observedAt,
    });
  },
});

export const logTrendHttp = httpAction(async (ctx, request) => {
  let payload: LogTrendPayload;
  try {
    payload = parseLogTrendPayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const trendObservationId = await ctx.runMutation(
      internal.lcMaya.lcMayaHttp.logTrendInternal,
      {
        creatorId: payload.creatorId as Id<"creators">,
        source: payload.source,
        observation: payload.observation,
        evidence: payload.evidence,
        relevanceScore: payload.relevanceScore,
        observedAt: Date.now(),
      }
    );
    return jsonResponse({ ok: true, trendObservationId }, 200);
  } catch (err) {
    const msg = (err as Error).message ?? "internal-error";
    if (msg === "creator-not-found") {
      return jsonResponse({ error: "creator-not-found" }, 404);
    }
    return jsonResponse({ error: msg }, 500);
  }
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
