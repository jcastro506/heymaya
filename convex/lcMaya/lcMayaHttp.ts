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

import {
  httpAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { assertWebhookSecret } from "../lib/webhookSecret";

const PROVIDER_LITERALS = [
  "gmail",
  // `googlecalendar` (legacy alias) routes through the DIRECT Google OAuth
  // path in v0 MVP, same as `googlecalendar-direct`. See the
  // PROVIDER_TO_PLAN_FEATURES_KEY mapping below.
  "googlecalendar",
  // Sprint 6 — explicit fork between the direct OAuth path (MVP) and the
  // legacy Composio-mediated path. The direct path uses
  // `convex/creatorMayaV0/backend.ts:1703-1802` token-refresh + fetch
  // helpers; Composio Calendar is DEPRECATED and rejected at the gate.
  "googlecalendar-direct",
  "googlecalendar-composio",
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
  // Sprint 6 — both `googlecalendar` (legacy alias) and the explicit
  // `googlecalendar-direct` route through the DIRECT Google OAuth path in
  // v0 MVP. Composio Calendar is intentionally absent — see the
  // `googlecalendar-composio` rejection in `startOAuthHttp`.
  googlecalendar: "calendar",
  "googlecalendar-direct": "calendar",
  linkedin: "linkedin",
  twitter: "twitter",
  // tiktok intentionally absent — see comment above.
  // googlecalendar-composio intentionally absent — DEPRECATED, fail-closed.
};

/* -------------------------------------------------------------------------- */
/* Endpoint 1 — submit_opening_answers                                         */
/* -------------------------------------------------------------------------- */

type JobStatusLiteral =
  | "full-time-creator"
  | "transitioning-full-time"
  | "side-hustle"
  | "hobby";

type DealsInterestLiteral = "yes" | "maybe" | "no";

interface SubmitOpeningAnswersPayload {
  secret: string;
  creatorId: string;
  goal: string;
  tone: "supportive" | "strategic" | "tough-love";
  brandDealFloorUsd?: number;
  // Sprint 6 — six anchor questions. All optional so partial answers
  // never break boot. Maya POSTs whichever subset she has parsed; the
  // synth pipeline reads `openingAnswers` BEFORE the model call and
  // injects them as constraints (see `synthesizeCreatorPicture.ts`).
  locationCity?: string;
  locationState?: string;
  locationCountry?: string;
  timezone?: string;
  nicheInOwnWords?: string;
  goals3Mo?: string;
  jobStatus?: JobStatusLiteral;
  dealsInterest?: DealsInterestLiteral;
  dealsFloorUsd?: number;
  antiNiches?: string[];
}

const JOB_STATUS_LITERALS = [
  "full-time-creator",
  "transitioning-full-time",
  "side-hustle",
  "hobby",
] as const;

const DEALS_INTEREST_LITERALS = ["yes", "maybe", "no"] as const;

function isJobStatusLiteral(value: unknown): value is JobStatusLiteral {
  return (
    typeof value === "string" &&
    (JOB_STATUS_LITERALS as readonly string[]).includes(value)
  );
}

function isDealsInterestLiteral(
  value: unknown
): value is DealsInterestLiteral {
  return (
    typeof value === "string" &&
    (DEALS_INTEREST_LITERALS as readonly string[]).includes(value)
  );
}

function readOptionalString(
  obj: Record<string, unknown>,
  field: string
): string | undefined {
  if (obj[field] === undefined || obj[field] === null) return undefined;
  if (typeof obj[field] !== "string") {
    throw new Error(`${field} must be a string when provided.`);
  }
  return obj[field] as string;
}

function readOptionalStringArray(
  obj: Record<string, unknown>,
  field: string
): string[] | undefined {
  if (obj[field] === undefined || obj[field] === null) return undefined;
  if (!Array.isArray(obj[field])) {
    throw new Error(`${field} must be an array of strings when provided.`);
  }
  const arr = obj[field] as unknown[];
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] !== "string") {
      throw new Error(`${field}[${i}] must be a string.`);
    }
  }
  return arr as string[];
}

function readOptionalNonNegFiniteNumber(
  obj: Record<string, unknown>,
  field: string
): number | undefined {
  if (obj[field] === undefined || obj[field] === null) return undefined;
  if (
    typeof obj[field] !== "number" ||
    !Number.isFinite(obj[field] as number) ||
    (obj[field] as number) < 0
  ) {
    throw new Error(
      `${field} must be a non-negative finite number when provided.`
    );
  }
  return obj[field] as number;
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
  const brandDealFloorUsd = readOptionalNonNegFiniteNumber(
    obj,
    "brandDealFloorUsd"
  );
  // Sprint 6 — six anchor questions. Each is optional so partial answers
  // never block boot. We validate each shape if present and pass through.
  let jobStatus: JobStatusLiteral | undefined;
  if (obj.jobStatus !== undefined && obj.jobStatus !== null) {
    if (!isJobStatusLiteral(obj.jobStatus)) {
      throw new Error(
        `jobStatus must be one of ${JOB_STATUS_LITERALS.join(" | ")} when provided.`
      );
    }
    jobStatus = obj.jobStatus;
  }
  let dealsInterest: DealsInterestLiteral | undefined;
  if (obj.dealsInterest !== undefined && obj.dealsInterest !== null) {
    if (!isDealsInterestLiteral(obj.dealsInterest)) {
      throw new Error(
        `dealsInterest must be one of ${DEALS_INTEREST_LITERALS.join(" | ")} when provided.`
      );
    }
    dealsInterest = obj.dealsInterest;
  }
  return {
    secret: obj.secret,
    creatorId: obj.creatorId,
    goal: obj.goal,
    tone: obj.tone,
    brandDealFloorUsd,
    locationCity: readOptionalString(obj, "locationCity"),
    locationState: readOptionalString(obj, "locationState"),
    locationCountry: readOptionalString(obj, "locationCountry"),
    timezone: readOptionalString(obj, "timezone"),
    nicheInOwnWords: readOptionalString(obj, "nicheInOwnWords"),
    goals3Mo: readOptionalString(obj, "goals3Mo"),
    jobStatus,
    dealsInterest,
    dealsFloorUsd: readOptionalNonNegFiniteNumber(obj, "dealsFloorUsd"),
    antiNiches: readOptionalStringArray(obj, "antiNiches"),
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
    // Sprint 6 — six anchor questions. All optional so partial answers
    // never block boot. The synth pipeline reads these BEFORE the model
    // call and injects them as constraints.
    locationCity: v.optional(v.string()),
    locationState: v.optional(v.string()),
    locationCountry: v.optional(v.string()),
    timezone: v.optional(v.string()),
    nicheInOwnWords: v.optional(v.string()),
    goals3Mo: v.optional(v.string()),
    jobStatus: v.optional(
      v.union(
        v.literal("full-time-creator"),
        v.literal("transitioning-full-time"),
        v.literal("side-hustle"),
        v.literal("hobby")
      )
    ),
    dealsInterest: v.optional(
      v.union(v.literal("yes"), v.literal("maybe"), v.literal("no"))
    ),
    dealsFloorUsd: v.optional(v.number()),
    antiNiches: v.optional(v.array(v.string())),
    nowMs: v.number(),
  },
  handler: async (ctx, args): Promise<{ pictureId: Id<"creatorPicture"> }> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("creator-not-found");
    }

    // Stamp the canonical "Maya has the basics" timestamp on the creators
    // row. The `first_weekly_plan` standing order keys off pictureLockedAt
    // (Sprint 6) — openingAnswersAt is now an upstream cursor only.
    await ctx.db.patch(creator._id, { openingAnswersAt: args.nowMs });

    // Build the openingAnswers payload — only set keys whose value is
    // defined. The schema treats every Sprint 6 field as optional, so
    // omitting them is the canonical "creator hasn't answered yet" state.
    const openingAnswersPayload: Record<string, unknown> = {
      goal: args.goal,
      tone: args.tone,
      submittedAt: args.nowMs,
    };
    if (args.brandDealFloorUsd !== undefined) {
      openingAnswersPayload.brandDealFloorUsd = args.brandDealFloorUsd;
    }
    if (args.locationCity !== undefined)
      openingAnswersPayload.locationCity = args.locationCity;
    if (args.locationState !== undefined)
      openingAnswersPayload.locationState = args.locationState;
    if (args.locationCountry !== undefined)
      openingAnswersPayload.locationCountry = args.locationCountry;
    if (args.timezone !== undefined) openingAnswersPayload.timezone = args.timezone;
    if (args.nicheInOwnWords !== undefined)
      openingAnswersPayload.nicheInOwnWords = args.nicheInOwnWords;
    if (args.goals3Mo !== undefined) openingAnswersPayload.goals3Mo = args.goals3Mo;
    if (args.jobStatus !== undefined) openingAnswersPayload.jobStatus = args.jobStatus;
    if (args.dealsInterest !== undefined)
      openingAnswersPayload.dealsInterest = args.dealsInterest;
    if (args.dealsFloorUsd !== undefined)
      openingAnswersPayload.dealsFloorUsd = args.dealsFloorUsd;
    if (args.antiNiches !== undefined)
      openingAnswersPayload.antiNiches = args.antiNiches;

    const existing = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .first();

    if (existing) {
      // Merge into any existing openingAnswers so partial answer rounds
      // accumulate (Maya may post 3 of 6 anchor questions, then 3 more in a
      // later round). We preserve already-known anchors when the new
      // payload omits them.
      const merged = {
        ...(existing.openingAnswers ?? {}),
        ...openingAnswersPayload,
      } as typeof existing.openingAnswers;
      await ctx.db.patch(existing._id, {
        openingAnswers: merged,
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
      openingAnswers: openingAnswersPayload as never,
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
        // Sprint 6 — six anchor questions, all optional.
        locationCity: payload.locationCity,
        locationState: payload.locationState,
        locationCountry: payload.locationCountry,
        timezone: payload.timezone,
        nicheInOwnWords: payload.nicheInOwnWords,
        goals3Mo: payload.goals3Mo,
        jobStatus: payload.jobStatus,
        dealsInterest: payload.dealsInterest,
        dealsFloorUsd: payload.dealsFloorUsd,
        antiNiches: payload.antiNiches,
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
/* Endpoint 1.5 — lock_picture (Sprint 6 — onboarding flow redesign)           */
/* -------------------------------------------------------------------------- */

/**
 * Sprint 6 — Maya commits the synthesized creator picture after the
 * post-synth verify round-trip. Body shape:
 *
 *   { secret, creatorId, corrections?: Array<{ field, correctedValue }> }
 *
 * `corrections` lets the creator amend any `needsVerification[]` field
 * before the lock — e.g. London-bug location: synth flagged
 * `field: "location"`, creator confirms NYC, Maya posts
 * `corrections: [{ field: "location", correctedValue: { city: "Brooklyn", state: "NY", country: "US" } }]`.
 *
 * The lock stamps `creators.pictureLockedAt`. Standing-order
 * `first_weekly_plan` triggers off this — NOT `openingAnswersAt` — so the
 * plan never reads unverified picture data.
 *
 * Idempotency: re-locking is allowed (re-stamps `pictureLockedAt` to the
 * latest call). Maya can re-collect corrections in a follow-up round if
 * the creator changes their mind; the lock is the cursor that unblocks
 * downstream programs, not a one-shot fuse.
 */
interface LockPictureCorrection {
  field: string;
  correctedValue: unknown;
}

interface LockPicturePayload {
  secret: string;
  creatorId: string;
  corrections?: LockPictureCorrection[];
}

function parseLockPicturePayload(raw: unknown): LockPicturePayload {
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
  let corrections: LockPictureCorrection[] | undefined;
  if (obj.corrections !== undefined && obj.corrections !== null) {
    if (!Array.isArray(obj.corrections)) {
      throw new Error("corrections must be an array when provided.");
    }
    corrections = obj.corrections.map((entry, i) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`corrections[${i}] must be an object.`);
      }
      const e = entry as Record<string, unknown>;
      if (typeof e.field !== "string" || e.field.length === 0) {
        throw new Error(
          `corrections[${i}].field must be a non-empty string.`
        );
      }
      // `correctedValue` is intentionally `unknown` — different fields take
      // different shapes (location is an object; niche is a string; etc.).
      return { field: e.field, correctedValue: e.correctedValue };
    });
  }
  return {
    secret: obj.secret,
    creatorId: obj.creatorId,
    corrections,
  };
}

export const lockPictureInternal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    corrections: v.optional(
      v.array(
        v.object({
          field: v.string(),
          correctedValue: v.any(),
        })
      )
    ),
    nowMs: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ lockedAt: number; appliedCorrections: number }> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("creator-not-found");
    }
    // Apply corrections to the openingAnswers slot on the picture row. The
    // synth wrote what it inferred; the creator's correction is the
    // ground-truth anchor that supersedes it. Future heartbeats / standing
    // orders read `openingAnswers` first, then the synth picture.
    let appliedCorrections = 0;
    if (args.corrections && args.corrections.length > 0) {
      const picture = await ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
        .first();
      if (picture) {
        const merged: Record<string, unknown> = {
          ...(picture.openingAnswers ?? {}),
        };
        // Keep `submittedAt` if it exists; default to nowMs if the creator
        // never went through submit_opening_answers (corrections-only flow).
        if (typeof merged.submittedAt !== "number") {
          merged.submittedAt = args.nowMs;
        }
        for (const c of args.corrections) {
          if (c.field === "location") {
            const cv = c.correctedValue as
              | {
                  city?: string;
                  state?: string;
                  country?: string;
                  timezone?: string;
                }
              | null
              | undefined;
            if (cv && typeof cv === "object") {
              if (typeof cv.city === "string") merged.locationCity = cv.city;
              if (typeof cv.state === "string") merged.locationState = cv.state;
              if (typeof cv.country === "string")
                merged.locationCountry = cv.country;
              if (typeof cv.timezone === "string")
                merged.timezone = cv.timezone;
            }
            appliedCorrections++;
            continue;
          }
          if (c.field === "niche") {
            if (typeof c.correctedValue === "string") {
              merged.nicheInOwnWords = c.correctedValue;
              appliedCorrections++;
            }
            continue;
          }
          if (c.field === "goals3Mo") {
            if (typeof c.correctedValue === "string") {
              merged.goals3Mo = c.correctedValue;
              appliedCorrections++;
            }
            continue;
          }
          if (c.field === "antiNiches") {
            if (Array.isArray(c.correctedValue)) {
              merged.antiNiches = c.correctedValue.filter(
                (v): v is string => typeof v === "string"
              );
              appliedCorrections++;
            }
            continue;
          }
          // Unknown fields are stored verbatim under the field name so we
          // never silently drop a creator's correction. Callers can extend
          // by adding well-typed branches above; the catch-all keeps the
          // contract forward-compatible without requiring schema bumps.
          merged[c.field] = c.correctedValue;
          appliedCorrections++;
        }
        // Required-cast: `merged` always includes `goal`/`tone`/`submittedAt`
        // when the picture had a prior `openingAnswers`. When it didn't, we
        // still need those required fields — fall back to safe defaults so
        // the schema-required slots are filled (corrections-only callers
        // are rare; this is a defensive guard).
        if (typeof merged.goal !== "string") merged.goal = "";
        if (
          merged.tone !== "supportive" &&
          merged.tone !== "strategic" &&
          merged.tone !== "tough-love"
        ) {
          merged.tone = "strategic";
        }
        await ctx.db.patch(picture._id, {
          openingAnswers: merged as never,
        });
      }
    }
    await ctx.db.patch(creator._id, { pictureLockedAt: args.nowMs });
    return { lockedAt: args.nowMs, appliedCorrections };
  },
});

export const lockPictureHttp = httpAction(async (ctx, request) => {
  let payload: LockPicturePayload;
  try {
    payload = parseLockPicturePayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const result = await ctx.runMutation(
      internal.lcMaya.lcMayaHttp.lockPictureInternal,
      {
        creatorId: payload.creatorId as Id<"creators">,
        corrections: payload.corrections,
        nowMs: Date.now(),
      }
    );
    return jsonResponse({ ok: true, ...result }, 200);
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
/* Endpoint 4 — cron_heartbeat (Wave 0b — proves OpenClaw cron actually fires) */
/* -------------------------------------------------------------------------- */

interface CronHeartbeatPayload {
  secret: string;
  creatorId: string;
  jobName: string;
  firedAt?: number;
}

function parseCronHeartbeatPayload(raw: unknown): CronHeartbeatPayload {
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
  if (typeof obj.jobName !== "string" || obj.jobName.trim().length === 0) {
    throw new Error("jobName must be a non-empty string.");
  }
  let firedAt: number | undefined;
  if (obj.firedAt !== undefined && obj.firedAt !== null) {
    if (
      typeof obj.firedAt !== "number" ||
      !Number.isFinite(obj.firedAt) ||
      obj.firedAt < 0
    ) {
      throw new Error("firedAt must be a non-negative finite number.");
    }
    firedAt = obj.firedAt;
  }
  return {
    secret: obj.secret,
    creatorId: obj.creatorId,
    jobName: obj.jobName,
    firedAt,
  };
}

/**
 * Records that an OpenClaw cron entry fired for a creator. Append-only —
 * never patches existing rows (a re-fire IS a separate event).
 *
 * Cross-tenant safety: the row inherits creatorId from the request body,
 * which is signed by the webhook secret. We verify the creator exists; we
 * never use any other creator's id implicitly.
 */
export const recordCronHeartbeatInternal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    jobName: v.string(),
    firedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("creator-not-found");
    }
    return await ctx.db.insert("cronHeartbeat", {
      creatorId: args.creatorId,
      jobName: args.jobName,
      firedAt: args.firedAt,
    });
  },
});

export const cronHeartbeatHttp = httpAction(async (ctx, request) => {
  let payload: CronHeartbeatPayload;
  try {
    payload = parseCronHeartbeatPayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }
  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  try {
    const id = await ctx.runMutation(
      internal.lcMaya.lcMayaHttp.recordCronHeartbeatInternal,
      {
        creatorId: payload.creatorId as Id<"creators">,
        jobName: payload.jobName,
        firedAt: payload.firedAt ?? Date.now(),
      }
    );
    return jsonResponse({ ok: true, id }, 200);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "creator-not-found") {
      return jsonResponse({ error: "creator-not-found" }, 404);
    }
    return jsonResponse({ error: msg }, 500);
  }
});

/* -------------------------------------------------------------------------- */
/* Endpoint 5 — start_google_calendar_oauth (Sprint 7 Slice B iMessage path)   */
/* -------------------------------------------------------------------------- */

/**
 * Sprint 7 Slice B. Maya texts the creator a Google Calendar connect
 * link. The creator taps the link on their phone — there's NO Clerk
 * session in that browser. To re-resolve which creator just authorized,
 * we generate a single-use UUID state token here and store it in
 * `oauthStateTokens` with a 15-minute TTL. The Next.js callback at
 * `app/api/google-calendar/callback-imessage/route.ts` reads the state
 * back and patches the creator's `connectedAccounts` row.
 *
 * Why a separate endpoint from `start_oauth`:
 *   - `start_oauth` returns a Composio-hosted URL; the iMessage path
 *     uses *direct* Google OAuth (no Composio for Calendar — Sprint 6
 *     decision, see `convex/creatorMayaV0/backend.ts` token helpers).
 *   - `start_oauth` assumes the creator returns to the Clerk-session
 *     web app; the iMessage path's callback has no session.
 *
 * TTL strategy: lazy. The callback enforces `Date.now() <= expiresAtMs`
 * on lookup. There's no background sweep — at the rate of human OAuth
 * taps, the table churn is tiny. If this surface ever grows hot, a
 * daily sweep mutation can be added later (deferred for v0).
 */

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface StartGoogleCalendarOAuthPayload {
  secret: string;
  creatorId: string;
}

function parseStartGoogleCalendarOAuthPayload(
  raw: unknown
): StartGoogleCalendarOAuthPayload {
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
  return { secret: obj.secret, creatorId: obj.creatorId };
}

const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export const issueGoogleCalendarStateTokenForCreator = internalMutation({
  args: {
    creatorId: v.id("creators"),
    nowMs: v.number(),
  },
  handler: async (ctx, args): Promise<{ stateToken: string }> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("creator-not-found");
    }
    // Reuse `crypto.randomUUID` — Convex runtime exposes it.
    const stateToken = crypto.randomUUID();
    await ctx.db.insert("oauthStateTokens", {
      stateToken,
      creatorId: args.creatorId,
      provider: "google_calendar",
      createdAtMs: args.nowMs,
      expiresAtMs: args.nowMs + OAUTH_STATE_TTL_MS,
    });
    return { stateToken };
  },
});

/**
 * Lookup helper used by the Next.js iMessage callback. Lazy TTL
 * enforcement: returns null if the row is gone OR expired. The callback
 * deletes the row after consuming it (single-use), and expired rows are
 * cleared inline so a stale token never hangs around long.
 */
export const consumeGoogleCalendarStateToken = internalMutation({
  args: {
    stateToken: v.string(),
    nowMs: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: true; creatorId: Id<"creators"> } | { ok: false }> => {
    const row = await ctx.db
      .query("oauthStateTokens")
      .withIndex("by_state_token", (q) => q.eq("stateToken", args.stateToken))
      .first();
    if (!row) return { ok: false };
    // Single-use: always delete the row, even if expired.
    await ctx.db.delete(row._id);
    if (row.expiresAtMs < args.nowMs) return { ok: false };
    if (row.provider !== "google_calendar") return { ok: false };
    return { ok: true, creatorId: row.creatorId };
  },
});

/**
 * Internal query for tests / observability. The httpAction does not need
 * this — it's only used to verify a state token landed in the table.
 */
export const peekStateTokenForTests = internalQuery({
  args: { stateToken: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("oauthStateTokens")
      .withIndex("by_state_token", (q) => q.eq("stateToken", args.stateToken))
      .first();
  },
});

/**
 * iMessage callback completion endpoint. The Next.js route at
 * `app/api/google-calendar/callback-imessage/route.ts` cannot call
 * internal mutations directly through `ConvexHttpClient` (Convex
 * enforces public-vs-internal at the HTTP boundary). The callback
 * POSTs the entire OAuth result here in one shot — state token + tokens
 * + lookahead events — and this endpoint atomically consumes the state
 * (single-use) and writes the connection. If consume fails (expired /
 * unknown), nothing is written.
 */
interface CompleteGoogleCalendarOAuthPayload {
  secret: string;
  stateToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
  externalAccountId?: string;
  lookaheadEvents: ReadonlyArray<{
    providerEventId: string;
    title: string;
    description?: string;
    startMs: number;
    endMs: number;
    location?: string;
    recurring?: boolean;
  }>;
  timezone?: string;
}

function parseCompleteGoogleCalendarOAuthPayload(
  raw: unknown
): CompleteGoogleCalendarOAuthPayload {
  if (!raw || typeof raw !== "object") throw new Error("Body must be a JSON object.");
  const obj = raw as Record<string, unknown>;
  if (typeof obj.secret !== "string") throw new Error("secret must be a string.");
  if (typeof obj.stateToken !== "string" || obj.stateToken.length === 0) {
    throw new Error("stateToken is required.");
  }
  if (typeof obj.accessToken !== "string" || obj.accessToken.length === 0) {
    throw new Error("accessToken is required.");
  }
  if (!Array.isArray(obj.lookaheadEvents)) {
    throw new Error("lookaheadEvents must be an array.");
  }
  return {
    secret: obj.secret,
    stateToken: obj.stateToken,
    accessToken: obj.accessToken,
    refreshToken: typeof obj.refreshToken === "string" ? obj.refreshToken : undefined,
    expiresAt: typeof obj.expiresAt === "number" ? obj.expiresAt : undefined,
    tokenType: typeof obj.tokenType === "string" ? obj.tokenType : undefined,
    scope: typeof obj.scope === "string" ? obj.scope : undefined,
    externalAccountId:
      typeof obj.externalAccountId === "string" ? obj.externalAccountId : undefined,
    timezone: typeof obj.timezone === "string" ? obj.timezone : undefined,
    lookaheadEvents: obj.lookaheadEvents as CompleteGoogleCalendarOAuthPayload["lookaheadEvents"],
  };
}

export const completeGoogleCalendarOAuthHttp = httpAction(async (ctx, request) => {
  let payload: CompleteGoogleCalendarOAuthPayload;
  try {
    payload = parseCompleteGoogleCalendarOAuthPayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  // Resolve state → creatorId (single-use, lazy TTL).
  const consumed = await ctx.runMutation(
    internal.lcMaya.lcMayaHttp.consumeGoogleCalendarStateToken,
    { stateToken: payload.stateToken, nowMs: Date.now() }
  );
  if (!consumed.ok) {
    return jsonResponse({ error: "state-token-expired-or-unknown" }, 410);
  }

  try {
    await ctx.runMutation(
      internal.creatorMayaV0.backend.storeGoogleCalendarOAuthConnectionForCreator,
      {
        creatorId: consumed.creatorId,
        timezone: payload.timezone ?? "UTC",
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        expiresAt: payload.expiresAt,
        tokenType: payload.tokenType,
        scope: payload.scope,
        externalAccountId: payload.externalAccountId,
        lookaheadEvents: payload.lookaheadEvents.map((e) => ({
          providerEventId: e.providerEventId,
          title: e.title,
          description: e.description,
          startMs: e.startMs,
          endMs: e.endMs,
          location: e.location,
          recurring: e.recurring ?? false,
        })),
      }
    );
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message ?? "internal-error" }, 500);
  }
});

export const startGoogleCalendarOAuthHttp = httpAction(async (ctx, request) => {
  let payload: StartGoogleCalendarOAuthPayload;
  try {
    payload = parseStartGoogleCalendarOAuthPayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_CALENDAR_IMESSAGE_REDIRECT_URI;
  if (!clientId) {
    return jsonResponse({ error: "missing-google-client-id" }, 500);
  }
  if (!redirectUri) {
    return jsonResponse({ error: "missing-redirect-uri" }, 500);
  }

  let stateToken: string;
  try {
    const result = await ctx.runMutation(
      internal.lcMaya.lcMayaHttp.issueGoogleCalendarStateTokenForCreator,
      {
        creatorId: payload.creatorId as Id<"creators">,
        nowMs: Date.now(),
      }
    );
    stateToken = result.stateToken;
  } catch (err) {
    const msg = (err as Error).message ?? "internal-error";
    if (msg === "creator-not-found") {
      return jsonResponse({ error: "creator-not-found" }, 404);
    }
    return jsonResponse({ error: msg }, 500);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: stateToken,
  });

  return jsonResponse(
    { ok: true, oauthUrl: `${GOOGLE_AUTH_URL}?${params.toString()}` },
    200
  );
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
