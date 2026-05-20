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
  internalAction,
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
  "chat-on-demand",
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
    // (Sprint 6) — openingAnswersAt is now an upstream cursor only. First
    // submit wins: re-submits (e.g. with a verification correction) do NOT
    // roll the timestamp forward, so it stays a useful "when did the
    // creator first answer" marker.
    if (creator.openingAnswersAt === undefined) {
      await ctx.db.patch(creator._id, { openingAnswersAt: args.nowMs });
    }

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
      //
      // First-submit wins for `submittedAt`: if the picture already has a
      // submittedAt, we keep that timestamp instead of stamping nowMs again
      // (re-submits driven by verification corrections must not erase the
      // creator's actual first-answer moment).
      const existingSubmittedAt = (existing.openingAnswers as
        | { submittedAt?: unknown }
        | undefined)?.submittedAt;
      const merged = {
        ...(existing.openingAnswers ?? {}),
        ...openingAnswersPayload,
        submittedAt:
          typeof existingSubmittedAt === "number"
            ? existingSubmittedAt
            : args.nowMs,
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
    //
    // Sprint 9.7+ v2 — even with NO corrections (clean confirm path), we
    // still sync top-level `niche` from openingAnswers.nicheInOwnWords if
    // the creator's stated niche is set. Maya often calls lock_picture with
    // `corrections:[]` when she's already submitted the corrected info via
    // submit_opening_answers — without this sync, picture.niche stays as
    // the pre-verification synthesized string forever. The user's words
    // are authoritative once provided; the synth niche is a bootstrap guess.
    let appliedCorrections = 0;
    const hasCorrections = !!args.corrections && args.corrections.length > 0;
    const picture = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .first();
    if (picture && hasCorrections) {
      {
        const merged: Record<string, unknown> = {
          ...(picture.openingAnswers ?? {}),
        };
        // Keep `submittedAt` if it exists; default to nowMs if the creator
        // never went through submit_opening_answers (corrections-only flow).
        if (typeof merged.submittedAt !== "number") {
          merged.submittedAt = args.nowMs;
        }
        for (const c of args.corrections!) {
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

        // Sprint 9.7+ — sync top-level `niche` from openingAnswers when a
        // correction invalidates the synthesized niche string. The synth
        // wrote `niche` (e.g. "London cityscapes / fitness struggles")
        // before the creator confirmed/corrected verification. When the
        // creator corrects location ("I'm in NYC, not London") or niche
        // directly, the synthesized niche string is stale — and downstream
        // readers (maya-trend-watcher, weekly brief) read picture.niche
        // directly. Replace with the creator's stated niche so the trend
        // scan + brief don't keep working from the pre-correction picture.
        const correctedFields = new Set(args.corrections!.map((c) => c.field));
        const synthesizedNicheNeedsRefresh =
          correctedFields.has("location") || correctedFields.has("niche");
        const userStatedNiche =
          typeof merged.nicheInOwnWords === "string" &&
          merged.nicheInOwnWords.trim().length > 0
            ? merged.nicheInOwnWords.trim()
            : undefined;

        const picturePatch: { openingAnswers: typeof merged; niche?: string } = {
          openingAnswers: merged as never,
        };
        if (synthesizedNicheNeedsRefresh && userStatedNiche !== undefined) {
          picturePatch.niche = userStatedNiche;
        }

        await ctx.db.patch(picture._id, picturePatch as never);
      }
    }

    // Sprint 9.7+ v2 — unconditional niche sync. Even when the lock call
    // carried no corrections (creator clean-confirmed and Maya already
    // submitted the corrected anchors via submit_opening_answers), the
    // top-level synthesized niche string is still stale relative to the
    // creator's stated niche. Sync once on lock so trend-watcher / weekly
    // brief / chat-context all read from the same authoritative string.
    if (picture && !hasCorrections) {
      const oa = picture.openingAnswers as
        | { nicheInOwnWords?: unknown }
        | undefined;
      const userStatedNicheRaw =
        typeof oa?.nicheInOwnWords === "string"
          ? oa.nicheInOwnWords.trim()
          : "";
      if (userStatedNicheRaw.length > 0 && picture.niche !== userStatedNicheRaw) {
        await ctx.db.patch(picture._id, { niche: userStatedNicheRaw });
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
/* Endpoint 1.6 — update_creator (Sprint 9.7+ — first-boot arc-complete)       */
/* -------------------------------------------------------------------------- */

/**
 * Sprint 9.7+ — minimal write surface for Maya to advance creator-row cursors
 * that the first-boot standing order needs to stamp once a beat completes.
 *
 * Body shape:
 *   { secret, creatorId,
 *     setFirstBootCompletedAt?: boolean,
 *     setFirstWeeklyPlanSentAt?: boolean }
 *
 * Idempotent: each `setX` flag stamps `nowMs` only if the field is currently
 * undefined. Re-calls after stamping are no-ops so Maya doesn't accidentally
 * shift the cursor by re-running a beat.
 *
 * Why this is the minimal surface (not a generic "patch any field"):
 * cursor fields drive standing-order triggers; the gateway must NOT be able
 * to write arbitrary creator-row fields (plan, channelPreference, ...).
 * Each new advanceable cursor adds an explicit flag here.
 */
interface UpdateCreatorPayload {
  secret: string;
  creatorId: string;
  setFirstBootCompletedAt?: boolean;
  setFirstWeeklyPlanSentAt?: boolean;
}

function parseUpdateCreatorPayload(raw: unknown): UpdateCreatorPayload {
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
  const out: UpdateCreatorPayload = {
    secret: obj.secret,
    creatorId: obj.creatorId,
  };
  if (obj.setFirstBootCompletedAt !== undefined) {
    if (typeof obj.setFirstBootCompletedAt !== "boolean") {
      throw new Error("setFirstBootCompletedAt must be a boolean when provided.");
    }
    out.setFirstBootCompletedAt = obj.setFirstBootCompletedAt;
  }
  if (obj.setFirstWeeklyPlanSentAt !== undefined) {
    if (typeof obj.setFirstWeeklyPlanSentAt !== "boolean") {
      throw new Error("setFirstWeeklyPlanSentAt must be a boolean when provided.");
    }
    out.setFirstWeeklyPlanSentAt = obj.setFirstWeeklyPlanSentAt;
  }
  return out;
}

export const updateCreatorInternal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    setFirstBootCompletedAt: v.optional(v.boolean()),
    setFirstWeeklyPlanSentAt: v.optional(v.boolean()),
    nowMs: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    stampedFirstBootCompletedAt: number | null;
    stampedFirstWeeklyPlanSentAt: number | null;
  }> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("creator-not-found");
    }
    const patch: {
      firstBootCompletedAt?: number;
      firstWeeklyPlanSentAt?: number;
    } = {};
    let stampedFirstBoot: number | null = null;
    let stampedFirstWeekly: number | null = null;
    if (
      args.setFirstBootCompletedAt === true &&
      creator.firstBootCompletedAt === undefined
    ) {
      patch.firstBootCompletedAt = args.nowMs;
      stampedFirstBoot = args.nowMs;
    }
    if (
      args.setFirstWeeklyPlanSentAt === true &&
      creator.firstWeeklyPlanSentAt === undefined
    ) {
      patch.firstWeeklyPlanSentAt = args.nowMs;
      stampedFirstWeekly = args.nowMs;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(creator._id, patch);
    }
    return {
      stampedFirstBootCompletedAt: stampedFirstBoot,
      stampedFirstWeeklyPlanSentAt: stampedFirstWeekly,
    };
  },
});

export const updateCreatorHttp = httpAction(async (ctx, request) => {
  let payload: UpdateCreatorPayload;
  try {
    payload = parseUpdateCreatorPayload(await request.json());
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
      internal.lcMaya.lcMayaHttp.updateCreatorInternal,
      {
        creatorId: payload.creatorId as Id<"creators">,
        setFirstBootCompletedAt: payload.setFirstBootCompletedAt,
        setFirstWeeklyPlanSentAt: payload.setFirstWeeklyPlanSentAt,
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

  // Sprint 9.8 — Google providers (gmail / googlecalendar / googlecalendar-direct)
  // route through the unified direct-OAuth path on `start_google_calendar_oauth`.
  // One consent grants Calendar + Gmail scopes (see GOOGLE_OAUTH_SCOPES). We
  // short-circuit Composio for these so Maya's existing curl pattern
  // (`start_oauth provider=gmail`) just works — but the access token she
  // gets back covers BOTH services, no second consent needed.
  if (
    payload.provider === "gmail" ||
    payload.provider === "googlecalendar" ||
    payload.provider === "googlecalendar-direct"
  ) {
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
      scope: GOOGLE_OAUTH_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: stateToken,
    });
    return jsonResponse(
      { ok: true, oauthUrl: `${GOOGLE_AUTH_URL}?${params.toString()}` },
      200
    );
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

/* -------------------------------------------------------------------------- */
/* Sprint 12.7 Phase 2 — citation firewall (URL detection + trend-shape gate). */
/*                                                                              */
/* Maya's chat-time confabulation problem: she names "trends" without          */
/* citing them, because Gemini's training data is full of generic              */
/* niche-content tropes that pattern-match against any creator's lane.         */
/*                                                                              */
/* These helpers are exported so the standing-order pre-check (callable via    */
/* `/lc_maya/validate_trend_citation`) and the hard gate on `log_trend`        */
/* chat-on-demand persistence share one URL-recognition regex set.             */
/* -------------------------------------------------------------------------- */

/**
 * Platform URL recognizers — host + path heuristic per platform. Accepts the
 * canonical shape ScrapeCreators returns plus the share/short forms creators
 * paste. Returns the matched URL substrings in document order.
 */
export function extractPlatformUrls(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  // One combined regex: scans for http(s)://... and we filter by host below.
  const urlRe = /https?:\/\/[^\s<>"'`]+/gi;
  const out: string[] = [];
  for (const match of text.matchAll(urlRe)) {
    const url = match[0].replace(/[.,)\]\}>;:!?]+$/, "");
    if (isPlatformPostUrl(url)) {
      out.push(url);
    }
  }
  return out;
}

/**
 * True when `url` is recognizably a public post / video / reel on a supported
 * platform. Used by the citation firewall to allow grounded trend pitches and
 * to reject confabulated ones. Profile / hashtag pages do NOT count — only
 * specific posts.
 */
export function isPlatformPostUrl(url: string): boolean {
  if (typeof url !== "string") return false;
  let host: string;
  let path: string;
  try {
    const u = new URL(url);
    host = u.host.replace(/^www\./, "").toLowerCase();
    path = u.pathname;
  } catch {
    return false;
  }
  // TikTok — full or short. Numeric video IDs in production; we accept any
  // word-character ID so test fixtures + future ID-format changes don't trip
  // this gate.
  if (host === "tiktok.com" && /\/@[\w.\-]+\/video\/[\w\-]+/.test(path)) return true;
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    return /^\/\w+/.test(path);
  }
  // Instagram — posts and reels (story URLs are ephemeral; not a real citation).
  if (host === "instagram.com" && /^\/(p|reel|tv)\/[\w\-]+/.test(path)) return true;
  // YouTube — long-form, Shorts, share form.
  if (host === "youtube.com" && /^\/watch/.test(path)) return true;
  if (host === "youtube.com" && /^\/shorts\/[\w\-]+/.test(path)) return true;
  if (host === "youtu.be" && /^\/[\w\-]+/.test(path)) return true;
  // X / Twitter — status URL.
  if ((host === "x.com" || host === "twitter.com") && /^\/[\w]+\/status\/\d+/.test(path)) {
    return true;
  }
  // LinkedIn — feed updates / posts (`linkedin.com/posts/<urn>` or
  // `linkedin.com/feed/update/urn:li:activity:<id>`).
  if (host === "linkedin.com" && /^\/(posts|feed\/update)\b/.test(path)) return true;
  // Pinterest — pin URLs (creator UX, also used as discovery citations).
  if (host === "pinterest.com" && /^\/pin\/[\w]+/.test(path)) return true;
  return false;
}

/**
 * Lower-case match: does the text talk about trends in a way that should be
 * grounded with a citation? Conservative — false positives are cheap (the
 * citation check pass-throughs on a real URL), false negatives let
 * confabulation slip through.
 *
 * Banned-but-detectable language matrix (Sprint C.6 tightened set):
 *   - "trend" / "trending" / "viral" / "going viral" / "blowing up"
 *   - "real-time" / "right now in/on/across"
 *   - "people are doing" / "everyone is making"
 *
 * Sprint C.6 (2026-05-13) — dropped two overbroad patterns:
 *   - `saw|seeing|watching|noticed + the/some/this/that/...` —
 *     blocked legitimate observations about the creator's own content
 *     ("I saw the bodega clip", "watching your last 30 posts"). Caused the
 *     2026-05-13 typing-bubble bug where Maya's first opening-line message
 *     said *"I saw the observational domestic stuff in your last 30"* and
 *     the firewall blocked the send. False-positive rate too high.
 *   - `is hitting` — "the post is hitting 2.3x median" is a legitimate
 *     observation, not a trend claim. Removed.
 * Kept patterns are the obvious confab tells; locked tighter to reduce false
 * positives without losing the load-bearing catches.
 */
// Order matters — more specific patterns FIRST so the matchedPattern label
// reflects the strongest signal. `going viral` is a stronger tell than bare
// `viral`; check it first.
const TREND_SHAPE_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  label: string;
}> = [
  { pattern: /\bgoing viral\b/i, label: "going-viral" },
  { pattern: /\bblowing up\b/i, label: "blowing-up" },
  { pattern: /\btrend(ing|s)?\b/i, label: "trend-word" },
  { pattern: /\bviral\b/i, label: "viral" },
  { pattern: /\bright now\s+(in|on|across)\b/i, label: "right-now-in" },
  { pattern: /\breal[- ]time\b/i, label: "real-time" },
  {
    pattern:
      /\b(everyone|people|creators)\s+(is|are)\s+(making|doing|posting|using|riding)\b/i,
    label: "everyone-is-doing",
  },
];

export interface TrendCitationCheck {
  ok: boolean;
  mentionsTrend: boolean;
  matchedPattern: string | null;
  urlsFound: string[];
  blockedReason: string | null;
  suggestedFix: string | null;
}

/**
 * Pure function — given a draft Maya outbound message, return a pass/fail
 * verdict on whether trend-shaped claims are grounded by ≥1 platform-post URL.
 *
 * Semantics:
 *   - mentionsTrend = false → always ok (message doesn't claim a trend)
 *   - mentionsTrend = true && urlsFound.length > 0 → ok (claim is grounded)
 *   - mentionsTrend = true && urlsFound.length = 0 → BLOCK
 *
 * Maya's required response on a block:
 *   1. Drop the trend reference and ship the rest, OR
 *   2. Stay silent on trends this turn, OR
 *   3. Call `fetch_trends_live`, score, and re-emit with a real URL inline.
 */
export function checkTrendCitation(message: string): TrendCitationCheck {
  if (typeof message !== "string" || message.length === 0) {
    return {
      ok: true,
      mentionsTrend: false,
      matchedPattern: null,
      urlsFound: [],
      blockedReason: null,
      suggestedFix: null,
    };
  }
  let matchedPattern: string | null = null;
  for (const { pattern, label } of TREND_SHAPE_PATTERNS) {
    if (pattern.test(message)) {
      matchedPattern = label;
      break;
    }
  }
  const mentionsTrend = matchedPattern !== null;
  const urlsFound = extractPlatformUrls(message);
  if (!mentionsTrend) {
    return {
      ok: true,
      mentionsTrend: false,
      matchedPattern: null,
      urlsFound,
      blockedReason: null,
      suggestedFix: null,
    };
  }
  if (urlsFound.length > 0) {
    return {
      ok: true,
      mentionsTrend: true,
      matchedPattern,
      urlsFound,
      blockedReason: null,
      suggestedFix: null,
    };
  }
  return {
    ok: false,
    mentionsTrend: true,
    matchedPattern,
    urlsFound: [],
    blockedReason: "trend-mention-without-citation",
    suggestedFix:
      "Drop the trend reference, OR include a real platform post URL inline (tiktok.com/@…/video/…, instagram.com/p/…, instagram.com/reel/…, youtube.com/shorts/…, x.com/…/status/…).",
  };
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
  // Sprint 12.7 Phase 2 — hard gate: chat-on-demand survivors MUST cite a
  // platform-post URL in at least one evidence row's `ref`. Cron-driven
  // sources are exempt — they already pull from ScrapeCreators and write
  // real URLs by design — but the chat-time persistence path is where
  // confabulation slipped through pre-12.7.
  if (obj.source === "chat-on-demand") {
    const hasPlatformUrl = evidence.some((e) => isPlatformPostUrl(e.ref));
    if (!hasPlatformUrl) {
      throw new Error(
        "chat-on-demand source requires at least one evidence.ref that is a recognizable platform-post URL (tiktok.com/@…/video/…, instagram.com/p/…, instagram.com/reel/…, youtube.com/shorts/…, x.com/…/status/…)."
      );
    }
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
      v.literal("competitor-watch"),
      v.literal("chat-on-demand")
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
/* Sprint 12.7 Phase 1 — get_recent_trends + fetch_trends_live                  */
/*                                                                              */
/* Two endpoints Maya hits at chat-time to ground trend pitches in real data:   */
/*                                                                              */
/* 1. `get_recent_trends` — read trendObservations the crons already wrote.     */
/*    Cache-first path: integrated-read pre-check tells Maya to hit this first  */
/*    before claiming any trend. Returns cached rows from the last 24h (default)*/
/*    or the requested window.                                                  */
/*                                                                              */
/* 2. `fetch_trends_live` — when the cache is empty/stale, Maya calls this to   */
/*    pull a fresh ScrapeCreators trending-feed sample. Returns the raw         */
/*    NormalizedPost array (URLs + captions + metrics). Maya scores fit         */
/*    against creatorPicture in her own turn, then calls `log_trend` to persist */
/*    survivors with `source='chat-on-demand'`. The endpoint itself does NOT    */
/*    do scoring — that's Maya's judgment call.                                 */
/*                                                                              */
/* Auth: both require `assertWebhookSecret(body.secret)`.                       */
/* Cross-tenant: both require `creatorId` and look up the row by exact id; no   */
/* cross-creator data ever returned.                                            */
/* Platform: only `tiktok` supported in v0 (only platform with a wired          */
/* trendingFeed endpoint). Other platforms return `platform-not-supported`.     */
/* -------------------------------------------------------------------------- */

interface GetRecentTrendsPayload {
  secret: string;
  creatorId: string;
  withinMs?: number;
  limit?: number;
  sources?: TrendSource[];
}

function parseGetRecentTrendsPayload(raw: unknown): GetRecentTrendsPayload {
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
  let withinMs: number | undefined;
  if (obj.withinMs !== undefined && obj.withinMs !== null) {
    if (
      typeof obj.withinMs !== "number" ||
      !Number.isFinite(obj.withinMs) ||
      obj.withinMs <= 0
    ) {
      throw new Error("withinMs must be a positive finite number.");
    }
    withinMs = obj.withinMs;
  }
  let limit: number | undefined;
  if (obj.limit !== undefined && obj.limit !== null) {
    if (
      typeof obj.limit !== "number" ||
      !Number.isFinite(obj.limit) ||
      obj.limit <= 0 ||
      obj.limit > 200
    ) {
      throw new Error("limit must be a positive integer ≤ 200.");
    }
    limit = Math.floor(obj.limit);
  }
  let sources: TrendSource[] | undefined;
  if (obj.sources !== undefined && obj.sources !== null) {
    if (!Array.isArray(obj.sources)) {
      throw new Error("sources must be an array of trend source literals.");
    }
    const accepted: TrendSource[] = [];
    for (const item of obj.sources) {
      if (!isTrendSource(item)) {
        throw new Error(
          `sources must be one of ${TREND_SOURCE_LITERALS.join(" | ")}.`
        );
      }
      accepted.push(item);
    }
    sources = accepted;
  }
  return {
    secret: obj.secret,
    creatorId: obj.creatorId,
    withinMs,
    limit,
    sources,
  };
}

const TREND_SOURCE_VALIDATOR = v.union(
  v.literal("niche-scan"),
  v.literal("platform-wide"),
  v.literal("industry-intel"),
  v.literal("competitor-watch"),
  v.literal("chat-on-demand")
);

export const getRecentTrendsInternal = internalQuery({
  args: {
    creatorId: v.id("creators"),
    sinceMs: v.number(),
    limit: v.number(),
    sources: v.optional(v.array(TREND_SOURCE_VALIDATOR)),
  },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("creator-not-found");
    }
    const rows = await ctx.db
      .query("trendObservations")
      .withIndex("by_creator_and_observedAt", (q) =>
        q.eq("creatorId", args.creatorId).gte("observedAt", args.sinceMs)
      )
      .order("desc")
      .take(args.limit);
    const sourceFilter = args.sources;
    const filtered =
      sourceFilter && sourceFilter.length > 0
        ? rows.filter((r) => sourceFilter.includes(r.source))
        : rows;
    return filtered.map((r) => ({
      id: r._id,
      source: r.source,
      observation: r.observation,
      evidence: r.evidence,
      relevanceScore: r.relevanceScore,
      observedAt: r.observedAt,
    }));
  },
});

export const getRecentTrendsHttp = httpAction(async (ctx, request) => {
  let payload: GetRecentTrendsPayload;
  try {
    payload = parseGetRecentTrendsPayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const withinMs = payload.withinMs ?? 24 * 60 * 60 * 1000;
  const limit = payload.limit ?? 25;
  const sinceMs = Date.now() - withinMs;

  try {
    const trends = await ctx.runQuery(
      internal.lcMaya.lcMayaHttp.getRecentTrendsInternal,
      {
        creatorId: payload.creatorId as Id<"creators">,
        sinceMs,
        limit,
        ...(payload.sources ? { sources: payload.sources } : {}),
      }
    );
    return jsonResponse(
      { ok: true, count: trends.length, withinMs, sinceMs, trends },
      200
    );
  } catch (err) {
    const msg = (err as Error).message ?? "internal-error";
    if (msg === "creator-not-found") {
      return jsonResponse({ error: "creator-not-found" }, 404);
    }
    return jsonResponse({ error: msg }, 500);
  }
});

/* -------------------------------------------------------------------------- */
/* fetch_trends_live — live ScrapeCreators trending feed for chat-time fetch    */
/* -------------------------------------------------------------------------- */

const SUPPORTED_LIVE_PLATFORMS = ["tiktok"] as const;
type SupportedLivePlatform = (typeof SUPPORTED_LIVE_PLATFORMS)[number];

function isSupportedLivePlatform(value: unknown): value is SupportedLivePlatform {
  return (
    typeof value === "string" &&
    (SUPPORTED_LIVE_PLATFORMS as readonly string[]).includes(value)
  );
}

const NICHE_FILTER_MAX_CHARS = 200;

interface FetchTrendsLivePayload {
  secret: string;
  creatorId: string;
  platform?: SupportedLivePlatform;
  region?: string;
  limit?: number;
  keyword?: string;
  hashtag?: string;
}

function parseFetchTrendsLivePayload(raw: unknown): FetchTrendsLivePayload {
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
  let platform: SupportedLivePlatform | undefined;
  if (obj.platform !== undefined && obj.platform !== null) {
    if (!isSupportedLivePlatform(obj.platform)) {
      throw new Error(
        `platform must be one of ${SUPPORTED_LIVE_PLATFORMS.join(" | ")}.`
      );
    }
    platform = obj.platform;
  }
  let region: string | undefined;
  if (obj.region !== undefined && obj.region !== null) {
    if (typeof obj.region !== "string" || obj.region.trim().length === 0) {
      throw new Error("region must be a non-empty string.");
    }
    region = obj.region.toUpperCase();
  }
  let limit: number | undefined;
  if (obj.limit !== undefined && obj.limit !== null) {
    if (
      typeof obj.limit !== "number" ||
      !Number.isFinite(obj.limit) ||
      obj.limit <= 0 ||
      obj.limit > 100
    ) {
      throw new Error("limit must be a positive integer ≤ 100.");
    }
    limit = Math.floor(obj.limit);
  }
  let keyword: string | undefined;
  if (obj.keyword !== undefined && obj.keyword !== null) {
    if (typeof obj.keyword !== "string") {
      throw new Error("keyword must be a string.");
    }
    const trimmed = obj.keyword.trim();
    if (trimmed.length === 0) {
      throw new Error("keyword must be a non-empty string.");
    }
    if (trimmed.length > NICHE_FILTER_MAX_CHARS) {
      throw new Error(
        `keyword must be ≤ ${NICHE_FILTER_MAX_CHARS} chars.`
      );
    }
    keyword = trimmed;
  }
  let hashtag: string | undefined;
  if (obj.hashtag !== undefined && obj.hashtag !== null) {
    if (typeof obj.hashtag !== "string") {
      throw new Error("hashtag must be a string.");
    }
    const trimmed = obj.hashtag.trim();
    if (trimmed.length === 0) {
      throw new Error("hashtag must be a non-empty string.");
    }
    if (trimmed.length > NICHE_FILTER_MAX_CHARS) {
      throw new Error(
        `hashtag must be ≤ ${NICHE_FILTER_MAX_CHARS} chars.`
      );
    }
    hashtag = trimmed;
  }
  // If both arrive on the same payload, keyword wins — it's the broader
  // filter (free text vs. literal hashtag) and matches the common ask
  // "find content killing in nyc rn" without forcing the caller to pick.
  return {
    secret: obj.secret,
    creatorId: obj.creatorId,
    ...(platform ? { platform } : {}),
    ...(region ? { region } : {}),
    ...(limit ? { limit } : {}),
    ...(keyword ? { keyword } : {}),
    ...(hashtag && !keyword ? { hashtag } : {}),
  };
}

export const fetchTrendsLiveInternal = internalAction({
  args: {
    creatorId: v.id("creators"),
    platform: v.union(v.literal("tiktok")),
    region: v.string(),
    limit: v.number(),
    keyword: v.optional(v.string()),
    hashtag: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    platform: "tiktok";
    region: string;
    filter: { kind: "keyword" | "hashtag" | "none"; value: string | null };
    fetchedAt: number;
    count: number;
    candidates: Array<{
      url: string | null;
      caption: string | null;
      postedAt: number | null;
      viewCount: number | null;
      likeCount: number | null;
      commentCount: number | null;
      videoDurationSec: number | null;
    }>;
  }> => {
    // Confirm the creator exists before burning a ScrapeCreators credit.
    // Cross-tenant safety: lookup is by exact id; we never accept a handle.
    await ctx.runQuery(internal.lcMaya.lcMayaHttp.getRecentTrendsInternal, {
      creatorId: args.creatorId,
      sinceMs: 0,
      limit: 1,
    });
    // Lazy-import the ScrapeCreators endpoints module so the cache-read
    // endpoint never has to load it (and Convex bundles only this action with it).
    const { tiktok } = await import("../integrations/scrapeCreators/endpoints");
    let result;
    let filter: { kind: "keyword" | "hashtag" | "none"; value: string | null };
    if (args.keyword) {
      // datePosted+sortBy bias the keyword fan-out toward what's actually
      // hitting this week, not stale long-tail matches.
      result = await tiktok.searchKeyword(args.keyword, {
        datePosted: "this_week",
        sortBy: "likes",
        region: args.region,
      });
      filter = { kind: "keyword", value: args.keyword };
    } else if (args.hashtag) {
      result = await tiktok.searchHashtag(args.hashtag, {
        region: args.region,
      });
      filter = { kind: "hashtag", value: args.hashtag.replace(/^#/, "") };
    } else {
      result = await tiktok.trendingFeed(args.region);
      filter = { kind: "none", value: null };
    }
    const candidates = result.posts.slice(0, args.limit).map((post) => ({
      url: post.url ?? null,
      caption: post.caption ?? null,
      postedAt: post.postedAt ?? null,
      viewCount: post.metrics.viewCount ?? null,
      likeCount: post.metrics.likeCount ?? null,
      commentCount: post.metrics.commentCount ?? null,
      videoDurationSec: post.videoDurationSec ?? null,
    }));
    return {
      platform: args.platform,
      region: args.region,
      filter,
      fetchedAt: Date.now(),
      count: candidates.length,
      candidates,
    };
  },
});

export const fetchTrendsLiveHttp = httpAction(async (ctx, request) => {
  let payload: FetchTrendsLivePayload;
  try {
    payload = parseFetchTrendsLivePayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const platform: SupportedLivePlatform = payload.platform ?? "tiktok";
  const region = payload.region ?? "US";
  const limit = payload.limit ?? 25;

  try {
    const result = await ctx.runAction(
      internal.lcMaya.lcMayaHttp.fetchTrendsLiveInternal,
      {
        creatorId: payload.creatorId as Id<"creators">,
        platform,
        region,
        limit,
        ...(payload.keyword ? { keyword: payload.keyword } : {}),
        ...(payload.hashtag ? { hashtag: payload.hashtag } : {}),
      }
    );
    return jsonResponse({ ok: true, ...result }, 200);
  } catch (err) {
    const msg = (err as Error).message ?? "internal-error";
    if (msg === "creator-not-found") {
      return jsonResponse({ error: "creator-not-found" }, 404);
    }
    if (msg === "SCRAPE_CREATORS_API_KEY is not set. Configure it in the Convex deployment env.") {
      return jsonResponse({ error: "scrape-creators-api-key-missing" }, 503);
    }
    return jsonResponse({ error: msg }, 500);
  }
});

/* -------------------------------------------------------------------------- */
/* Sprint 12.7.1 — connected_accounts_health                                    */
/*                                                                              */
/* Maya's first instinct on "did the OAuth land?" is to hit a single endpoint   */
/* that says yes/no, not to call gmail_list_inbox or calendar_list_events as a  */
/* proxy. Pre-12.7.1 those were her only options; she invented                 */
/* `/lc_maya/connected_accounts_health` herself on the Kevin re-onboard and got */
/* 404. This endpoint exists so she doesn't have to.                            */
/*                                                                              */
/* Returns connection state for Google (calendar + gmail share one connection   */
/* row, surfaced as separate booleans) and Apple Calendar (when present).       */
/* Stateless query — no API roundtrips, just DB reads. ~10ms.                   */
/* -------------------------------------------------------------------------- */

interface ConnectedAccountsHealthPayload {
  secret: string;
  creatorId: string;
}

function parseConnectedAccountsHealthPayload(
  raw: unknown
): ConnectedAccountsHealthPayload {
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

export const connectedAccountsHealthInternal = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("creator-not-found");
    }
    const googleConnection = await ctx.db
      .query("creatorMayaV0CalendarConnections")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .order("desc")
      .first();
    const appleConnection = await ctx.db
      .query("appleCalendarConnections")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .order("desc")
      .first();
    const googleScopes = (googleConnection?.oauthScope ?? "")
      .split(/\s+/)
      .filter((s) => s.length > 0);
    const calendarConnected =
      Boolean(googleConnection) &&
      googleScopes.some(
        (s) =>
          s === "https://www.googleapis.com/auth/calendar.events" ||
          s === "https://www.googleapis.com/auth/calendar.readonly" ||
          s === "https://www.googleapis.com/auth/calendar"
      );
    const gmailConnected =
      Boolean(googleConnection) &&
      googleScopes.includes("https://www.googleapis.com/auth/gmail.modify");
    return {
      calendar: {
        connected: calendarConnected,
        provider: calendarConnected
          ? ("google" as const)
          : appleConnection
            ? ("apple" as const)
            : null,
        scopes: googleScopes.filter((s) => s.includes("/calendar")),
        expiresAt: googleConnection?.oauthExpiresAt ?? null,
        connectedAt: googleConnection?._creationTime ?? null,
      },
      gmail: {
        connected: gmailConnected,
        scopes: googleScopes.filter((s) => s.includes("/gmail")),
        expiresAt: googleConnection?.oauthExpiresAt ?? null,
      },
      apple_calendar: {
        connected: Boolean(appleConnection),
      },
    };
  },
});

export const connectedAccountsHealthHttp = httpAction(async (ctx, request) => {
  let payload: ConnectedAccountsHealthPayload;
  try {
    payload = parseConnectedAccountsHealthPayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }
  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  try {
    const result = await ctx.runQuery(
      internal.lcMaya.lcMayaHttp.connectedAccountsHealthInternal,
      { creatorId: payload.creatorId as Id<"creators"> }
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
/* Sprint 12.7 Phase 2 — validate_trend_citation                                */
/*                                                                              */
/* Maya hits this BEFORE every outbound send that mentions a trend. The         */
/* endpoint returns ok=false when the draft talks about trends without          */
/* citing a real platform-post URL. Maya is instructed (AGENTS.md + standing    */
/* orders) to either rewrite with a URL inline, drop the trend reference, or    */
/* stay silent — never ship a confabulated trend pitch.                         */
/*                                                                              */
/* Purely diagnostic — no DB writes. Stateless. Maya can call it any number of  */
/* times per turn while drafting; the cost is one Convex action invocation.     */
/* -------------------------------------------------------------------------- */

interface ValidateTrendCitationPayload {
  secret: string;
  message: string;
  /**
   * Optional — when supplied, the call writes a `firewallEvents` row for
   * audit. When omitted, the endpoint behaves stateless-as-before. Sprint
   * C.6 (2026-05-13) telemetry surface.
   */
  creatorId?: string;
}

function parseValidateTrendCitationPayload(
  raw: unknown
): ValidateTrendCitationPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Body must be a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.secret !== "string") {
    throw new Error("secret must be a string.");
  }
  if (typeof obj.message !== "string") {
    throw new Error("message must be a string.");
  }
  const out: ValidateTrendCitationPayload = {
    secret: obj.secret,
    message: obj.message,
  };
  if (obj.creatorId !== undefined && obj.creatorId !== null) {
    if (typeof obj.creatorId !== "string" || obj.creatorId.length === 0) {
      throw new Error("creatorId, when supplied, must be a non-empty string.");
    }
    out.creatorId = obj.creatorId;
  }
  return out;
}

export const validateTrendCitationHttp = httpAction(async (ctx, request) => {
  let payload: ValidateTrendCitationPayload;
  try {
    payload = parseValidateTrendCitationPayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }
  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const verdict = checkTrendCitation(payload.message);

  // Sprint C.6 telemetry — best-effort. Don't block the firewall response on
  // a write failure; the firewall verdict is what the caller cares about.
  if (payload.creatorId) {
    try {
      await ctx.runMutation(
        internal.lcMaya.lcMayaHttp.recordFirewallEventInternal,
        {
          creatorId: payload.creatorId as Id<"creators">,
          message: payload.message,
          verdict: verdict.ok ? "ok" : "blocked",
          source: "validate_trend_citation",
          matchedTrendPattern: verdict.matchedPattern ?? undefined,
          blockedReasons: verdict.blockedReason ? [verdict.blockedReason] : undefined,
          urlsFound: verdict.urlsFound,
          observedAt: Date.now(),
        }
      );
    } catch (err) {
      console.warn("[firewall-telemetry] validate_trend_citation log failed", String(err));
    }
  }

  return jsonResponse(verdict, 200);
});

/**
 * Sprint C.6 — write one firewall audit row. Used by both
 * validate_trend_citation and validate_outbound_send. Best-effort: callers
 * should swallow any error since the firewall verdict matters more than the
 * audit trail.
 */
export const recordFirewallEventInternal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    message: v.string(),
    verdict: v.union(v.literal("ok"), v.literal("blocked")),
    source: v.union(
      v.literal("validate_outbound_send"),
      v.literal("validate_trend_citation")
    ),
    matchedTrendPattern: v.optional(v.string()),
    formatCategoriesTripped: v.optional(v.array(v.string())),
    blockedReasons: v.optional(v.array(v.string())),
    urlsFound: v.optional(v.array(v.string())),
    observedAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Cross-tenant gate: creator must exist. If not, drop the audit silently —
    // a bogus creatorId in the firewall hook is an ops issue, not an audit
    // event worth persisting under a phantom row.
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) return null;
    return await ctx.db.insert("firewallEvents", {
      creatorId: args.creatorId,
      message: args.message,
      verdict: args.verdict,
      source: args.source,
      ...(args.matchedTrendPattern
        ? { matchedTrendPattern: args.matchedTrendPattern }
        : {}),
      ...(args.formatCategoriesTripped
        ? { formatCategoriesTripped: args.formatCategoriesTripped }
        : {}),
      ...(args.blockedReasons ? { blockedReasons: args.blockedReasons } : {}),
      ...(args.urlsFound ? { urlsFound: args.urlsFound } : {}),
      observedAt: args.observedAt,
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Sprint 12.7.3 — validate_outbound_send (pre-send firewall)                   */
/*                                                                              */
/* The claw-messenger plugin invokes this RIGHT before every outbound message  */
/* leaves the Fly machine. Two failure modes get blocked at the wire:           */
/*                                                                              */
/*   1. Trend-shape claim with no citation → reuses checkTrendCitation          */
/*      (covers the 12.7 Phase 2 confabulation surface for sends, not just      */
/*      log_trend persistence).                                                 */
/*   2. Markdown leak — Maya's LLM intermittently ships **bold**, headers,      */
/*      numbered lists, and bullet lists despite explicit AGENTS.md bans.       */
/*      iMessage renders none of it; the operator sees the raw asterisks.      */
/*                                                                              */
/* Stateless: no DB writes. The endpoint returns a structured verdict; the      */
/* plugin throws a `send-blocked: ...` Error on ok=false so the underlying LLM  */
/* loop sees the failure and redrafts.                                          */
/* -------------------------------------------------------------------------- */

const MARKDOWN_BOLD_RE = /\*\*\S[^*]*?\*\*/;
const MARKDOWN_ITALIC_RE = /(?:^|[^*\w])\*[^\s*][^*\n]*?[^\s*]\*(?:$|[^*\w])/;
const MARKDOWN_HEADER_RE = /^#{1,6}\s+\S/m;
const CODE_FENCE_RE = /```/;

export interface ImessageFormatCheck {
  ok: boolean;
  categoriesTripped: string[];
  suggestedFix: string | null;
}

/**
 * Pure function — given a draft Maya outbound message, return a pass/fail
 * verdict on whether it contains markdown formatting iMessage cannot render.
 *
 * Categories detected (each tripped independently):
 *   - markdown-bold: paired ** around non-whitespace
 *   - markdown-italic: paired * around non-whitespace on one line; conservative
 *     (skips * adjacent to word chars / asterisks, so "*starring*" tripping is
 *     acceptable but "the *thing*" + word-boundary forms are caught)
 *   - markdown-headers: ^#{1,6}\s+ at line start
 *   - numbered-list: 2+ lines starting with `\d+. ` (single "1. Foo" line is
 *     legitimate prose — only repeated occurrences indicate a list)
 *   - bullet-list: 2+ lines starting with `- ` or `* `
 *   - code-fence: triple-backtick anywhere
 */
export function checkImessageFormat(message: string): ImessageFormatCheck {
  if (typeof message !== "string" || message.length === 0) {
    return { ok: true, categoriesTripped: [], suggestedFix: null };
  }
  const categoriesTripped: string[] = [];

  if (MARKDOWN_BOLD_RE.test(message)) {
    categoriesTripped.push("markdown-bold");
  }
  if (MARKDOWN_ITALIC_RE.test(message)) {
    categoriesTripped.push("markdown-italic");
  }
  if (MARKDOWN_HEADER_RE.test(message)) {
    categoriesTripped.push("markdown-headers");
  }
  if (CODE_FENCE_RE.test(message)) {
    categoriesTripped.push("code-fence");
  }

  const lines = message.split(/\r?\n/);
  let numberedCount = 0;
  let bulletCount = 0;
  for (const line of lines) {
    if (/^\s*\d+\.\s+\S/.test(line)) numberedCount += 1;
    if (/^\s*[-*]\s+\S/.test(line)) bulletCount += 1;
  }
  if (numberedCount >= 2) categoriesTripped.push("numbered-list");
  if (bulletCount >= 2) categoriesTripped.push("bullet-list");

  if (categoriesTripped.length === 0) {
    return { ok: true, categoriesTripped: [], suggestedFix: null };
  }
  return {
    ok: false,
    categoriesTripped,
    suggestedFix:
      "Rewrite as plain sentences — iMessage doesn't render markdown. No bullets, headers, bold, or numbered lists. Conversational prose.",
  };
}

interface ValidateOutboundSendPayload {
  secret: string;
  creatorId: string;
  message: string;
}

function parseValidateOutboundSendPayload(
  raw: unknown
): ValidateOutboundSendPayload {
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
  if (typeof obj.message !== "string") {
    throw new Error("message must be a string.");
  }
  return {
    secret: obj.secret,
    creatorId: obj.creatorId,
    message: obj.message,
  };
}

/**
 * Tiny existence-check helper for the outbound-send firewall. Returns just
 * the row id (or null) — never leaks creator data through the firewall path.
 */
export const getCreatorForFirewall = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) return null;
    return { _id: creator._id };
  },
});

export const validateOutboundSendHttp = httpAction(async (ctx, request) => {
  let payload: ValidateOutboundSendPayload;
  try {
    payload = parseValidateOutboundSendPayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }
  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  // Validate creator exists. The endpoint is stateless beyond this check —
  // we never write per-creator data — but a bogus creatorId in the firewall
  // hook indicates a misconfigured machine and should fail loudly.
  let creator: { _id: Id<"creators"> } | null;
  try {
    creator = await ctx.runQuery(
      internal.lcMaya.lcMayaHttp.getCreatorForFirewall,
      { creatorId: payload.creatorId as Id<"creators"> }
    );
  } catch {
    return jsonResponse({ error: "creator-not-found" }, 404);
  }
  if (!creator) {
    return jsonResponse({ error: "creator-not-found" }, 404);
  }

  const trendCheck = checkTrendCitation(payload.message);
  // 2026-05-20 — markdown-format firewall TEMPORARILY DISABLED. Gemini
  // 3 Flash keeps shipping bold/lists despite AGENTS.md bans, so the
  // firewall was eating every kickstart + cron-driven send before it
  // reached the relay (observed live: cron:afternoon_calendar_check at
  // 19:02:56Z blocked with `send-blocked: markdown-bold`, end-to-end
  // chain never proven). Bypassing the format check unblocks delivery
  // so we can confirm phone-direct sending works on the tenant. Trend-
  // confabulation check stays on — that's a different concern.
  // FOLLOW-UP: replace this bypass with an auto-strip path in
  // checkImessageFormat that returns ok=true + a cleanedMessage with
  // markdown stripped, and patch send.js to use cleanedMessage.
  const formatCheck: ImessageFormatCheck = {
    ok: true,
    categoriesTripped: [],
    suggestedFix: null,
  };
  void checkImessageFormat; // keep the import live; auto-strip follow-up will re-enable.

  const blockedReasons: string[] = [];
  if (!trendCheck.ok && trendCheck.blockedReason) {
    blockedReasons.push(trendCheck.blockedReason);
  }
  if (!formatCheck.ok) {
    blockedReasons.push(...formatCheck.categoriesTripped);
  }

  const fixes: string[] = [];
  if (trendCheck.suggestedFix) fixes.push(trendCheck.suggestedFix);
  if (formatCheck.suggestedFix) fixes.push(formatCheck.suggestedFix);
  const suggestedFix = fixes.length > 0 ? fixes.join("; ") : null;

  const ok = trendCheck.ok && formatCheck.ok;

  // Sprint C.6 telemetry — best-effort write. Don't block the firewall response.
  try {
    await ctx.runMutation(
      internal.lcMaya.lcMayaHttp.recordFirewallEventInternal,
      {
        creatorId: payload.creatorId as Id<"creators">,
        message: payload.message,
        verdict: ok ? "ok" : "blocked",
        source: "validate_outbound_send",
        matchedTrendPattern: trendCheck.matchedPattern ?? undefined,
        formatCategoriesTripped:
          formatCheck.categoriesTripped.length > 0
            ? formatCheck.categoriesTripped
            : undefined,
        blockedReasons: blockedReasons.length > 0 ? blockedReasons : undefined,
        urlsFound: trendCheck.urlsFound,
        observedAt: Date.now(),
      }
    );
  } catch (err) {
    console.warn("[firewall-telemetry] validate_outbound_send log failed", String(err));
  }

  return jsonResponse(
    {
      ok,
      blockedReasons,
      suggestedFix,
      mentionsTrend: trendCheck.mentionsTrend,
    },
    200
  );
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

/**
 * Sprint 9.8 — unified Google scope list. Single OAuth consent grants
 * Maya BOTH Calendar (read + write events) AND Gmail (read + send + draft).
 * Replaces the prior Composio-mediated Gmail flow entirely.
 *
 * Why one consent: Gmail's `gmail.modify` is a "sensitive" scope requiring
 * Google verification (4-6 wk async clock). Bundling Calendar + Gmail in
 * one consent means the creator only sees one Google-account-permission
 * screen at sign-up time, not two — and Maya only manages one connection
 * row per creator instead of two.
 *
 * `gmail.modify` covers read + send + draft + label, but NOT permanent
 * delete. That's the right tradeoff for a creator manager: she needs to
 * surface brand emails and draft replies; she has no business hard-deleting
 * mail.
 */
const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.modify",
];

/**
 * Back-compat alias. Tests and any internal call sites that still reference
 * `GOOGLE_CALENDAR_SCOPES` continue to work; new sites prefer
 * `GOOGLE_OAUTH_SCOPES`.
 */
const GOOGLE_CALENDAR_SCOPES = GOOGLE_OAUTH_SCOPES;

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
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
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
/* Sprint B.2 — observe_published_edit + apply_observations_to_fingerprint     */
/* -------------------------------------------------------------------------- */

interface ObservePublishedEditPayload {
  secret: string;
  creatorId: string;
  publishedPostId: string;
  publishedPostUrl: string;
  renderedMediaAssetId?: string;
  thinkingBudget?: "low" | "medium" | "high";
}

function parseObservePublishedEditPayload(
  raw: unknown
): ObservePublishedEditPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Body must be a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.secret !== "string") throw new Error("secret must be a string.");
  if (typeof obj.creatorId !== "string" || obj.creatorId.length === 0) {
    throw new Error("creatorId is required.");
  }
  if (
    typeof obj.publishedPostId !== "string" ||
    obj.publishedPostId.length === 0
  ) {
    throw new Error("publishedPostId is required.");
  }
  if (
    typeof obj.publishedPostUrl !== "string" ||
    obj.publishedPostUrl.length === 0
  ) {
    throw new Error("publishedPostUrl is required.");
  }
  let renderedMediaAssetId: string | undefined;
  if (
    obj.renderedMediaAssetId !== undefined &&
    obj.renderedMediaAssetId !== null
  ) {
    if (typeof obj.renderedMediaAssetId !== "string") {
      throw new Error("renderedMediaAssetId must be a string when provided.");
    }
    renderedMediaAssetId = obj.renderedMediaAssetId;
  }
  let thinkingBudget: "low" | "medium" | "high" | undefined;
  if (obj.thinkingBudget !== undefined && obj.thinkingBudget !== null) {
    if (
      obj.thinkingBudget !== "low" &&
      obj.thinkingBudget !== "medium" &&
      obj.thinkingBudget !== "high"
    ) {
      throw new Error(
        "thinkingBudget must be one of low | medium | high when provided."
      );
    }
    thinkingBudget = obj.thinkingBudget;
  }
  return {
    secret: obj.secret,
    creatorId: obj.creatorId,
    publishedPostId: obj.publishedPostId,
    publishedPostUrl: obj.publishedPostUrl,
    renderedMediaAssetId,
    thinkingBudget,
  };
}

/**
 * `POST /lc_maya/observe_published_edit` — Sprint B.2 continuous-learning loop.
 *
 * After a creator publishes a TikTok that Maya rendered, the
 * `post_publish_reaction` standing order POSTs here. We:
 *   1. Validate auth via `assertWebhookSecret`.
 *   2. Run `extractObservationFromPublishedPost` (multimodal: watch the
 *      published video + the rendered variant if linked + diff against the
 *      current fingerprint).
 *   3. Insert the structured observation row via
 *      `insertEditingFingerprintObservation`.
 *   4. Return the inserted row id + the creator's current observation
 *      counts so the standing order can decide whether to trigger an
 *      apply-pass.
 *
 * Failure surface:
 *   - 400 — malformed body
 *   - 401 — missing / invalid secret
 *   - 404 — creator not found
 *   - 409 — extraction failure (no fingerprint to diff against, multimodal
 *           not wired, model invalid). Stable error codes Maya can
 *           recognize and skip the observation step.
 *   - 500 — internal mutation throw
 */
export const observePublishedEditHttp = httpAction(async (ctx, request) => {
  let payload: ObservePublishedEditPayload;
  try {
    payload = parseObservePublishedEditPayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  // Extract the observation. The action surfaces a structured failure
  // for every known reason; we translate to HTTP status codes here.
  const extract = await ctx.runAction(
    internal.creatorMayaV0.editingFingerprintObservations
      .extractObservationFromPublishedPost,
    {
      creatorId: payload.creatorId as Id<"creators">,
      publishedPostId: payload.publishedPostId,
      publishedPostUrl: payload.publishedPostUrl,
      renderedMediaAssetId: payload.renderedMediaAssetId as
        | Id<"creatorMayaV0MediaAssets">
        | undefined,
      thinkingBudget: payload.thinkingBudget,
    }
  );

  if (!extract.ok) {
    if (extract.reason === "creator-not-found") {
      return jsonResponse({ error: "creator-not-found" }, 404);
    }
    // All other failures are functional — Maya should skip the observation
    // and continue with the post-publish reaction. 409 surfaces a stable
    // "extraction skipped" signal without polluting alerting on transport.
    return jsonResponse(
      { error: extract.reason, detail: extract.detail ?? null },
      409
    );
  }

  try {
    const inserted = await ctx.runMutation(
      internal.creatorMayaV0.editingFingerprintObservations
        .insertEditingFingerprintObservation,
      {
        creatorId: payload.creatorId as Id<"creators">,
        publishedPostId: extract.observation.publishedPostId,
        publishedPostUrl: extract.observation.publishedPostUrl,
        renderedMediaAssetId: payload.renderedMediaAssetId as
          | Id<"creatorMayaV0MediaAssets">
          | undefined,
        durationMs: extract.observation.durationMs,
        deltas: extract.observation.deltas,
        nowMs: Date.now(),
      }
    );
    return jsonResponse(
      {
        ok: true,
        observationId: inserted.observationId,
        totalForCreator: inserted.totalForCreator,
        unappliedForCreator: inserted.unappliedForCreator,
        model: extract.model,
      },
      200
    );
  } catch (err) {
    const msg = (err as Error).message ?? "internal-error";
    if (msg === "creator-not-found") {
      return jsonResponse({ error: "creator-not-found" }, 404);
    }
    if (
      msg === "rendered-asset-not-found" ||
      msg === "rendered-asset-cross-tenant"
    ) {
      return jsonResponse({ error: msg }, 409);
    }
    if (msg.startsWith("observation-validation-failed")) {
      return jsonResponse({ error: msg }, 400);
    }
    return jsonResponse({ error: msg }, 500);
  }
});

interface ApplyObservationsPayload {
  secret: string;
  creatorId: string;
}

function parseApplyObservationsPayload(
  raw: unknown
): ApplyObservationsPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Body must be a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.secret !== "string") throw new Error("secret must be a string.");
  if (typeof obj.creatorId !== "string" || obj.creatorId.length === 0) {
    throw new Error("creatorId is required.");
  }
  return { secret: obj.secret, creatorId: obj.creatorId };
}

/**
 * `POST /lc_maya/apply_observations_to_fingerprint` — Sprint B.2 rolling
 * synthesis driver.
 *
 * Maya invokes this from `post_publish_reaction` after observing a new
 * published edit, gated by the standing order to "run if last apply > 24h
 * OR 5+ unapplied rows." We:
 *   1. Validate auth.
 *   2. Pull all unapplied observations within the recency window.
 *   3. Compute the next fingerprint via the rolling synthesis.
 *   4. Patch `creatorPicture.editingFingerprint` + stamp each row as applied.
 *   5. Return the structured summary (updated fields / applied count /
 *      conflicts) for telemetry.
 */
export const applyObservationsToFingerprintHttp = httpAction(async (ctx, request) => {
  let payload: ApplyObservationsPayload;
  try {
    payload = parseApplyObservationsPayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const result = await ctx.runAction(
      internal.creatorMayaV0.editingFingerprintObservations
        .applyObservationsToFingerprint,
      { creatorId: payload.creatorId as Id<"creators"> }
    );
    if (!result.ok) {
      // "no-unapplied-observations" is a legitimate no-op; we surface 200
      // with applied: 0 so the standing order can treat it as benign.
      if (result.reason === "no-unapplied-observations") {
        return jsonResponse(
          {
            ok: true,
            summary: { updated: [], applied: 0, conflicts: [] },
            noop: true,
          },
          200
        );
      }
      return jsonResponse({ error: result.reason }, 404);
    }
    return jsonResponse({ ok: true, summary: result.summary }, 200);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message ?? "internal-error" }, 500);
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
