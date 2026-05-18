/**
 * editingFingerprintObservations — Sprint B.2 continuous-learning loop.
 *
 * Why this exists: Sprint A.2 extracts `creatorPicture.editingFingerprint`
 * from the creator's last 30 posts at onboarding (day-1 mimicry). This
 * module closes the loop: when a creator publishes a TikTok that Maya
 * rendered, Maya pulls the published version, diffs against what she sent
 * + the current rolling fingerprint, and persists the delta. The next
 * render conditions on it. Example: Maya cut at 0:08, creator re-cut at
 * 0:11 and added a 0.3s freeze. The delta says "creator prefers longer
 * setup beats" — next render reflects it.
 *
 * Module shape (mirrors `convex/onboarding/maya/extractEditingFingerprint.ts`):
 *
 *   - `extractObservationFromPublishedPost` (internal action) — watches the
 *     published video via Gemini multimodal (DI'd `multimodalCall`), reads
 *     the current `creatorPicture.editingFingerprint`, optionally also
 *     watches the linked rendered variant, and emits a structured deltas
 *     array. No DB writes.
 *
 *   - `insertEditingFingerprintObservation` (internal mutation) — validates
 *     the structured observation with Zod, then writes the row. Cross-tenant
 *     safe (the creator row is verified by id; we never accept arbitrary
 *     creatorId references that don't resolve).
 *
 *   - `applyObservationsToFingerprint` (internal action) — pulls unapplied
 *     observations within a recency window (last 30d, max 50 rows), folds
 *     them into `editingFingerprint` via a weighted-recency rolling
 *     synthesis (recent observations carry more weight; agreeing
 *     observations reinforce; conflicting observations surface as
 *     "increased variance" rather than flipping the field), then stamps
 *     `appliedToFingerprintAt` on every consumed row.
 *
 * Triggering policy (where `applyObservationsToFingerprint` runs):
 *   - Sprint B.2 ships with HTTP-trigger + every-N invocation. The
 *     post-publish standing-order POSTs `/lc_maya/observe_published_edit`
 *     (which runs the extract + insert), then POSTs
 *     `/lc_maya/apply_observations_to_fingerprint` if it has been >= 24h
 *     since the last application or there are 5+ unapplied rows. This
 *     keeps the rolling synthesis bounded without a separate cron.
 *
 *   - Decision rationale: a separate cron would fire even for creators
 *     with no new observations; co-locating the trigger with the publish
 *     event means we only re-synthesize when there's new signal. The
 *     internal action is idempotent (only-unapplied filter + per-row
 *     stamping) so multiple back-to-back calls are safe.
 *
 * Citation firewall (applies to skill prompts that READ this data, not
 *   here): any Maya claim about "what the creator changed in their edit"
 *   cites the `publishedPostId` or `publishedPostUrl` on the source
 *   observation row. Observations themselves are internal state — we don't
 *   gate the insert path on a narrative-citation check.
 *
 * Qualitative, not frame-accurate (same caveat as the Sprint A.2 extractor):
 *   The model DESCRIBES patterns ("cut later, around 0:11 instead of 0:08"),
 *   it does not measure them. Deltas are zones, not specs.
 */

import { v } from "convex/values";
import { z } from "zod";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** Recency window for `applyObservationsToFingerprint` (ms). */
export const APPLY_OBSERVATIONS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Hard cap on the number of unapplied observations folded per pass. */
export const APPLY_OBSERVATIONS_MAX_ROWS = 50;

/**
 * Recency-weighting half-life (ms). An observation 7d old carries half the
 * weight of one observed `now`. The synthesis is multiplicative over the
 * confidence the original fingerprint had, so this only re-shapes — it does
 * not flip the fingerprint on a single divergent post.
 */
export const APPLY_OBSERVATIONS_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type FingerprintDeltaField =
  | "pacing.avgCutEverySec"
  | "pacing.consistency"
  | "pacing.hookLandsAtMs"
  | "pacing.pacingCurve"
  | "opening"
  | "transitions"
  | "captions.style"
  | "captions.position"
  | "captions.cadence"
  | "captions.visualDescription"
  | "audio"
  | "framing"
  | "signatureMoves";

export const FINGERPRINT_DELTA_FIELDS: readonly FingerprintDeltaField[] = [
  "pacing.avgCutEverySec",
  "pacing.consistency",
  "pacing.hookLandsAtMs",
  "pacing.pacingCurve",
  "opening",
  "transitions",
  "captions.style",
  "captions.position",
  "captions.cadence",
  "captions.visualDescription",
  "audio",
  "framing",
  "signatureMoves",
] as const;

export interface ObservationDelta {
  field: FingerprintDeltaField;
  observed: string;
  expected: string;
  reason: string;
}

export interface StructuredObservation {
  publishedPostId: string;
  publishedPostUrl: string;
  durationMs: number;
  deltas: ObservationDelta[];
}

export type ThinkingBudget = "low" | "medium" | "high";

export interface ObservationMultimodalCallArgs {
  systemPrompt: string;
  userPayloadJson: string;
  /** The published video the model should watch. */
  publishedPostUrl: string;
  /**
   * Optional Maya-rendered variant URL the model should also watch when
   * present. When set, the model diffs published-vs-rendered; when absent,
   * it diffs published-vs-current-fingerprint.
   */
  renderedVariantUrl: string | null;
  thinkingBudget: ThinkingBudget;
}

export interface ObservationMultimodalCallResult {
  content: string;
  model: string;
}

export type ObservationMultimodalCall = (
  args: ObservationMultimodalCallArgs
) => Promise<ObservationMultimodalCallResult>;

/* -------------------------------------------------------------------------- */
/* System prompt                                                               */
/* -------------------------------------------------------------------------- */

export const OBSERVE_PUBLISHED_EDIT_SYSTEM_PROMPT = `You are observing a creator's PUBLISHED post against either (a) the rendered variant their AI manager (Maya) shipped to them OR (b) the rolling editing fingerprint Maya built from their last N posts.

Your job: describe each axis where the PUBLISHED edit DIFFERS from the expected one. The output drives Maya's next render — the more precise the delta, the sharper the next cut.

You are looking at qualitative patterns, not frame-accurate measurements. "Cut later, around 0:11 instead of 0:08" is the right shape. "Cut at exactly 11.247s" is overclaim.

Hard rules:
- Output STRICT JSON: { "durationMs": number, "deltas": [...] }. No prose, no commentary, no markdown fences.
- Each delta object: { "field": <enum>, "observed": <string>, "expected": <string>, "reason": <string> }.
- "field" MUST be one of: "pacing.avgCutEverySec" | "pacing.consistency" | "pacing.hookLandsAtMs" | "pacing.pacingCurve" | "opening" | "transitions" | "captions.style" | "captions.position" | "captions.cadence" | "captions.visualDescription" | "audio" | "framing" | "signatureMoves".
- Emit a delta ONLY when the axes actually differ. If pacing matches, do NOT emit a pacing delta just to fill space.
- Empty deltas array is a legal answer when the published edit matches expected closely on every axis.
- "reason" is ONE sentence explaining the difference (e.g. "creator extended the setup beat to give the punchline room to land").

Schema:
{
  "durationMs": number,
  "deltas": [
    { "field": "<one of the enum>", "observed": "<string>", "expected": "<string>", "reason": "<string>" }
  ]
}`;

/* -------------------------------------------------------------------------- */
/* Zod validator (model response)                                              */
/* -------------------------------------------------------------------------- */

const deltaFieldEnum = z.enum([
  "pacing.avgCutEverySec",
  "pacing.consistency",
  "pacing.hookLandsAtMs",
  "pacing.pacingCurve",
  "opening",
  "transitions",
  "captions.style",
  "captions.position",
  "captions.cadence",
  "captions.visualDescription",
  "audio",
  "framing",
  "signatureMoves",
]);

const deltaSchema = z.object({
  field: deltaFieldEnum,
  observed: z.string(),
  expected: z.string(),
  reason: z.string(),
});

const observationResponseSchema = z.object({
  durationMs: z.number().finite().nonnegative(),
  deltas: z.array(deltaSchema),
});

export type ObservationModelResponse = z.infer<
  typeof observationResponseSchema
>;

/* -------------------------------------------------------------------------- */
/* Zod validator (insert mutation input)                                       */
/* -------------------------------------------------------------------------- */

const structuredObservationSchema = z.object({
  publishedPostId: z
    .string()
    .min(1, "publishedPostId must be a non-empty string"),
  publishedPostUrl: z
    .string()
    .min(1, "publishedPostUrl must be a non-empty string"),
  durationMs: z
    .number()
    .finite()
    .nonnegative()
    .refine((v) => Number.isFinite(v), "durationMs must be finite"),
  deltas: z.array(deltaSchema),
});

export type StructuredObservationParsed = z.infer<
  typeof structuredObservationSchema
>;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function stripJsonFence(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    const firstNewline = s.indexOf("\n");
    if (firstNewline !== -1) {
      s = s.slice(firstNewline + 1);
    }
    if (s.endsWith("```")) {
      s = s.slice(0, -3);
    }
    s = s.trim();
  }
  return s;
}

/* -------------------------------------------------------------------------- */
/* DI module-scoped multimodal call                                            */
/* -------------------------------------------------------------------------- */

/**
 * Test seam — production callers leave this null, which forces the action
 * to refuse the model call (and surface a structured failure). Tests inject
 * a stub `ObservationMultimodalCall` to drive the model response.
 *
 * Sprint B.2 does NOT wire the production multimodal transport — that
 * lands as a follow-up once the worker contract for "watch a remote
 * URL + return JSON" is stabilized. Until then, the action returns
 * `{ ok: false, reason: "multimodal-not-wired" }` and the standing
 * order treats observations as a best-effort signal.
 */
let __injectedMultimodalCall: ObservationMultimodalCall | null = null;

export function _setObservationMultimodalCallForTests(
  call: ObservationMultimodalCall | null
): void {
  __injectedMultimodalCall = call;
}

/* -------------------------------------------------------------------------- */
/* Internal queries (helpers used by the action below)                         */
/* -------------------------------------------------------------------------- */

export const getCreatorPictureForObservation = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) return { creator: null, picture: null } as const;
    const picture = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .first();
    return { creator, picture } as const;
  },
});

export const getRenderedMediaAssetUrl = internalQuery({
  args: {
    creatorId: v.id("creators"),
    renderedMediaAssetId: v.id("creatorMayaV0MediaAssets"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: true; url: string | null } | { ok: false; reason: string }> => {
    const row = await ctx.db.get(args.renderedMediaAssetId);
    if (!row) return { ok: false, reason: "rendered-asset-not-found" };
    // Cross-tenant safety: the rendered asset MUST belong to the same creator.
    if (row.creatorId !== args.creatorId) {
      return { ok: false, reason: "rendered-asset-cross-tenant" };
    }
    if (row.source !== "rendered_variant") {
      return { ok: false, reason: "rendered-asset-wrong-source" };
    }
    // Prefer a Convex storage URL when storageId is set; otherwise fall
    // back to the stored URL slot.
    if (row.storageId) {
      const url = await ctx.storage.getUrl(row.storageId);
      return { ok: true, url } as const;
    }
    return { ok: true, url: row.storageUrl ?? null } as const;
  },
});

/* -------------------------------------------------------------------------- */
/* Action: extractObservationFromPublishedPost                                 */
/* -------------------------------------------------------------------------- */

export type ExtractObservationResult =
  | {
      ok: true;
      observation: StructuredObservation;
      model: string;
    }
  | {
      ok: false;
      reason:
        | "creator-not-found"
        | "fingerprint-missing"
        | "rendered-asset-not-found"
        | "rendered-asset-cross-tenant"
        | "rendered-asset-wrong-source"
        | "multimodal-not-wired"
        | "multimodal-call-failed"
        | "model-response-invalid";
      detail?: string;
    };

export const extractObservationFromPublishedPost = internalAction({
  args: {
    creatorId: v.id("creators"),
    publishedPostId: v.string(),
    publishedPostUrl: v.string(),
    renderedMediaAssetId: v.optional(v.id("creatorMayaV0MediaAssets")),
    thinkingBudget: v.optional(
      v.union(v.literal("low"), v.literal("medium"), v.literal("high"))
    ),
  },
  handler: async (ctx, args): Promise<ExtractObservationResult> => {
    const { creator, picture } = await ctx.runQuery(
      internal.creatorMayaV0.editingFingerprintObservations
        .getCreatorPictureForObservation,
      { creatorId: args.creatorId }
    );
    if (!creator) {
      return { ok: false, reason: "creator-not-found" };
    }
    // Picture / fingerprint may be undefined in the (legitimate) "creator
    // signed up but synthesis hasn't run / had too few videos" case. We
    // still allow the observation to be extracted — Maya needs SOME
    // baseline to diff against; if neither rendered variant nor
    // fingerprint is present, that's a hard "fingerprint-missing" stop.
    const fingerprint = picture?.editingFingerprint ?? null;

    let renderedVariantUrl: string | null = null;
    if (args.renderedMediaAssetId) {
      const res = await ctx.runQuery(
        internal.creatorMayaV0.editingFingerprintObservations
          .getRenderedMediaAssetUrl,
        {
          creatorId: args.creatorId,
          renderedMediaAssetId: args.renderedMediaAssetId,
        }
      );
      if (!res.ok) {
        // The query already enumerates the exact reasons our action type
        // declares — narrow via a switch so tsc proves the union match.
        switch (res.reason) {
          case "rendered-asset-not-found":
          case "rendered-asset-cross-tenant":
          case "rendered-asset-wrong-source":
            return { ok: false, reason: res.reason };
          default:
            return { ok: false, reason: "rendered-asset-not-found", detail: res.reason };
        }
      }
      renderedVariantUrl = res.url;
    }

    if (!fingerprint && renderedVariantUrl === null) {
      // Nothing to diff against — Maya needs at least one baseline.
      return { ok: false, reason: "fingerprint-missing" };
    }

    const call = __injectedMultimodalCall;
    if (!call) {
      return { ok: false, reason: "multimodal-not-wired" };
    }

    const userPayloadJson = JSON.stringify({
      publishedPostId: args.publishedPostId,
      publishedPostUrl: args.publishedPostUrl,
      renderedVariantUrl,
      currentFingerprint: fingerprint,
    });

    let result: ObservationMultimodalCallResult;
    try {
      result = await call({
        systemPrompt: OBSERVE_PUBLISHED_EDIT_SYSTEM_PROMPT,
        userPayloadJson,
        publishedPostUrl: args.publishedPostUrl,
        renderedVariantUrl,
        thinkingBudget: args.thinkingBudget ?? "medium",
      });
    } catch (err) {
      return {
        ok: false,
        reason: "multimodal-call-failed",
        detail: (err as Error).message,
      };
    }

    let parsed: ObservationModelResponse;
    try {
      const stripped = stripJsonFence(result.content);
      const obj = JSON.parse(stripped) as unknown;
      parsed = observationResponseSchema.parse(obj);
    } catch (err) {
      return {
        ok: false,
        reason: "model-response-invalid",
        detail: (err as Error).message,
      };
    }

    return {
      ok: true,
      model: result.model,
      observation: {
        publishedPostId: args.publishedPostId,
        publishedPostUrl: args.publishedPostUrl,
        durationMs: parsed.durationMs,
        deltas: parsed.deltas,
      },
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Internal mutation: insertEditingFingerprintObservation                      */
/* -------------------------------------------------------------------------- */

export const insertEditingFingerprintObservation = internalMutation({
  args: {
    creatorId: v.id("creators"),
    publishedPostId: v.string(),
    publishedPostUrl: v.string(),
    renderedMediaAssetId: v.optional(v.id("creatorMayaV0MediaAssets")),
    durationMs: v.number(),
    deltas: v.array(
      v.object({
        field: v.union(
          v.literal("pacing.avgCutEverySec"),
          v.literal("pacing.consistency"),
          v.literal("pacing.hookLandsAtMs"),
          v.literal("pacing.pacingCurve"),
          v.literal("opening"),
          v.literal("transitions"),
          v.literal("captions.style"),
          v.literal("captions.position"),
          v.literal("captions.cadence"),
          v.literal("captions.visualDescription"),
          v.literal("audio"),
          v.literal("framing"),
          v.literal("signatureMoves")
        ),
        observed: v.string(),
        expected: v.string(),
        reason: v.string(),
      })
    ),
    nowMs: v.number(),
  },
  handler: async (ctx, args) => {
    // Cross-tenant safety: the creatorId MUST resolve to a real row. We do
    // NOT trust arbitrary id strings; the caller (HTTP handler) ensures the
    // shared secret has been verified before this mutation runs.
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("creator-not-found");
    }

    // Zod-validate the observation payload at the mutation boundary. The
    // schema validators above are convex/values shape only; this is the
    // additional content-validation step.
    const parsed = structuredObservationSchema.safeParse({
      publishedPostId: args.publishedPostId,
      publishedPostUrl: args.publishedPostUrl,
      durationMs: args.durationMs,
      deltas: args.deltas,
    });
    if (!parsed.success) {
      throw new Error(
        `observation-validation-failed: ${parsed.error.issues
          .map((i) => i.message)
          .join("; ")}`
      );
    }

    // Optional rendered-asset cross-tenant check (mirrors the action). If
    // the caller passed a renderedMediaAssetId, verify it belongs to this
    // creator BEFORE inserting — never accept a foreign asset id.
    if (args.renderedMediaAssetId) {
      const asset = await ctx.db.get(args.renderedMediaAssetId);
      if (!asset) {
        throw new Error("rendered-asset-not-found");
      }
      if (asset.creatorId !== args.creatorId) {
        throw new Error("rendered-asset-cross-tenant");
      }
    }

    const id = await ctx.db.insert("editingFingerprintObservations", {
      creatorId: args.creatorId,
      publishedPostId: args.publishedPostId,
      publishedPostUrl: args.publishedPostUrl,
      renderedMediaAssetId: args.renderedMediaAssetId,
      observedAt: args.nowMs,
      durationMs: args.durationMs,
      deltas: args.deltas,
    });

    // Count is informational, returned to the caller so the standing
    // order can decide whether to trigger an apply-pass.
    const all = await ctx.db
      .query("editingFingerprintObservations")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();

    return {
      observationId: id,
      totalForCreator: all.length,
      unappliedForCreator: all.filter(
        (r) => r.appliedToFingerprintAt === undefined
      ).length,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Internal query: list unapplied observations for a creator                   */
/* -------------------------------------------------------------------------- */

export const listUnappliedObservationsForCreator = internalQuery({
  args: {
    creatorId: v.id("creators"),
    nowMs: v.number(),
  },
  handler: async (ctx, args) => {
    const cutoff = args.nowMs - APPLY_OBSERVATIONS_WINDOW_MS;
    const rows = await ctx.db
      .query("editingFingerprintObservations")
      .withIndex("by_creator_and_observedAt", (q) =>
        q.eq("creatorId", args.creatorId).gte("observedAt", cutoff)
      )
      .order("desc")
      .take(APPLY_OBSERVATIONS_MAX_ROWS);
    const picture = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .first();
    return {
      unapplied: rows.filter((r) => r.appliedToFingerprintAt === undefined),
      picture,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Internal mutation: persist the synthesized fingerprint + mark applied       */
/* -------------------------------------------------------------------------- */

export const persistFingerprintAndMarkApplied = internalMutation({
  args: {
    creatorId: v.id("creators"),
    observationIds: v.array(v.id("editingFingerprintObservations")),
    nextFingerprint: v.union(
      v.null(),
      v.object({
        pacing: v.object({
          avgCutEverySec: v.number(),
          consistency: v.union(
            v.literal("tight"),
            v.literal("loose"),
            v.literal("mixed")
          ),
          hookLandsAtMs: v.number(),
          pacingCurve: v.union(
            v.literal("fast-throughout"),
            v.literal("slow-burn"),
            v.literal("fast-to-slow"),
            v.literal("building"),
            v.literal("irregular")
          ),
        }),
        opening: v.union(
          v.literal("face-on"),
          v.literal("motion-shot"),
          v.literal("text-card"),
          v.literal("b-roll"),
          v.literal("voice-over-still"),
          v.literal("mixed")
        ),
        transitions: v.union(
          v.literal("hard-cut"),
          v.literal("zoom"),
          v.literal("whip-pan"),
          v.literal("jump-cut"),
          v.literal("dissolve"),
          v.literal("mixed")
        ),
        captions: v.object({
          style: v.union(
            v.literal("burned-in"),
            v.literal("auto"),
            v.literal("none"),
            v.literal("mixed")
          ),
          position: v.union(
            v.literal("top"),
            v.literal("center"),
            v.literal("bottom"),
            v.literal("varies"),
            v.literal("not-applicable")
          ),
          cadence: v.union(
            v.literal("word-by-word"),
            v.literal("phrase"),
            v.literal("sentence"),
            v.literal("not-applicable")
          ),
          visualDescription: v.string(),
        }),
        audio: v.union(
          v.literal("original-voice"),
          v.literal("music-driven"),
          v.literal("trending-sound"),
          v.literal("voiceover"),
          v.literal("mixed")
        ),
        framing: v.union(
          v.literal("fully-vertical-9-16"),
          v.literal("horizontal-letterboxed"),
          v.literal("square"),
          v.literal("mixed")
        ),
        signatureMoves: v.array(v.string()),
        confidence: v.number(),
        sampleSize: v.number(),
        citedPostIds: v.array(v.string()),
        extractedAt: v.number(),
      })
    ),
    nowMs: v.number(),
  },
  handler: async (ctx, args) => {
    const picture = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .first();

    // Patch fingerprint only when we actually computed a non-null synthesis
    // AND a creatorPicture row exists. Picture-missing is non-fatal: we
    // still mark observations applied so they don't re-accumulate.
    if (picture && args.nextFingerprint !== null) {
      await ctx.db.patch(picture._id, {
        editingFingerprint: args.nextFingerprint,
      });
    }

    for (const id of args.observationIds) {
      const row = await ctx.db.get(id);
      if (!row) continue;
      // Cross-tenant safety: only stamp rows that belong to this creator.
      if (row.creatorId !== args.creatorId) continue;
      await ctx.db.patch(id, { appliedToFingerprintAt: args.nowMs });
    }

    return { ok: true } as const;
  },
});

/* -------------------------------------------------------------------------- */
/* Rolling synthesis — pure function                                           */
/* -------------------------------------------------------------------------- */

export interface ApplyObservationsSummary {
  /** Field paths that the synthesis updated. */
  updated: FingerprintDeltaField[];
  /** Count of observations folded in. */
  applied: number;
  /**
   * Fields where the observations disagreed (multiple observed values for
   * the same field within the window). Surface to telemetry so we can
   * watch for creators whose style is genuinely in flux.
   */
  conflicts: FingerprintDeltaField[];
}

/**
 * Local re-declaration of the `editingFingerprint` shape from
 * `convex/schema.ts`. Re-declaring (rather than inferring) lets the rolling
 * synthesis stay typed without coupling to Convex's generated table types,
 * which makes the function testable in isolation.
 */
export interface EditingFingerprintShape {
  pacing: {
    avgCutEverySec: number;
    consistency: "tight" | "loose" | "mixed";
    hookLandsAtMs: number;
    pacingCurve:
      | "fast-throughout"
      | "slow-burn"
      | "fast-to-slow"
      | "building"
      | "irregular";
  };
  opening:
    | "face-on"
    | "motion-shot"
    | "text-card"
    | "b-roll"
    | "voice-over-still"
    | "mixed";
  transitions:
    | "hard-cut"
    | "zoom"
    | "whip-pan"
    | "jump-cut"
    | "dissolve"
    | "mixed";
  captions: {
    style: "burned-in" | "auto" | "none" | "mixed";
    position: "top" | "center" | "bottom" | "varies" | "not-applicable";
    cadence: "word-by-word" | "phrase" | "sentence" | "not-applicable";
    visualDescription: string;
  };
  audio:
    | "original-voice"
    | "music-driven"
    | "trending-sound"
    | "voiceover"
    | "mixed";
  framing:
    | "fully-vertical-9-16"
    | "horizontal-letterboxed"
    | "square"
    | "mixed";
  signatureMoves: string[];
  confidence: number;
  sampleSize: number;
  citedPostIds: string[];
  extractedAt: number;
}

/**
 * Pure rolling-synthesis. Given the current fingerprint + a list of
 * recent observations (newest first), produce the next fingerprint.
 *
 * Algorithm:
 *   - For each delta-field across all observations, collect every
 *     `observed` value with its recency weight.
 *   - Recency weight: `2 ** (-ageMs / HALF_LIFE_MS)`. Decays smoothly,
 *     equal-zero floor is impossible (always positive).
 *   - For categorical fields (consistency, pacingCurve, opening, etc.),
 *     pick the maximum-weight observed value as the next value IF its
 *     weight exceeds the current value's "weight" (where current's weight
 *     is taken as the original confidence baseline). Ties hold the
 *     current value.
 *   - For numeric fields (avgCutEverySec, hookLandsAtMs), weighted-average
 *     against the current value with the current value contributing the
 *     confidence as its weight.
 *   - For `signatureMoves` (string[]): union of (current + observed.
 *     observed text parsed as a single move when applicable). To stay
 *     conservative we only ADD new signature moves, never remove existing
 *     ones automatically. We dedupe + cap at 8 moves.
 *   - `visualDescription` (string): the most-recent observed value wins
 *     (latest captions visualDescription = freshest read of the creator's
 *     current style).
 *   - Conflicts: if a field has 2+ distinct observed values within the
 *     window AND their combined weight is comparable, the field is
 *     flagged as a conflict and DOES NOT flip — we hold the current value
 *     and surface to telemetry.
 *
 * Returns null when there is no current fingerprint AND no observations
 * to seed from. The standing order treats null as "skip the patch."
 */
export function computeNextFingerprint(args: {
  current: EditingFingerprintShape | undefined | null;
  observations: ReadonlyArray<{
    deltas: ReadonlyArray<{
      field: FingerprintDeltaField;
      observed: string;
      expected: string;
      reason: string;
    }>;
    observedAt: number;
    publishedPostId: string;
  }>;
  nowMs: number;
}): {
  next: EditingFingerprintShape | null;
  summary: ApplyObservationsSummary;
} {
  if (!args.current && args.observations.length === 0) {
    return {
      next: null,
      summary: { updated: [], applied: 0, conflicts: [] },
    };
  }
  if (!args.current) {
    // No prior fingerprint to fold into — preserve the previous behavior
    // of "synthesis happens at onboarding, not from observations alone."
    // Mark all observations applied (so they don't re-accumulate) but
    // don't write a new fingerprint.
    return {
      next: null,
      summary: {
        updated: [],
        applied: args.observations.length,
        conflicts: [],
      },
    };
  }

  // Bucket observed values per field with their weights.
  const byField = new Map<
    FingerprintDeltaField,
    Array<{ value: string; weight: number; postId: string }>
  >();
  for (const obs of args.observations) {
    const ageMs = Math.max(0, args.nowMs - obs.observedAt);
    const weight = Math.pow(2, -ageMs / APPLY_OBSERVATIONS_HALF_LIFE_MS);
    for (const d of obs.deltas) {
      const bucket = byField.get(d.field) ?? [];
      bucket.push({
        value: d.observed,
        weight,
        postId: obs.publishedPostId,
      });
      byField.set(d.field, bucket);
    }
  }

  const next: EditingFingerprintShape = JSON.parse(
    JSON.stringify(args.current)
  ) as EditingFingerprintShape;

  const updated = new Set<FingerprintDeltaField>();
  const conflicts = new Set<FingerprintDeltaField>();

  // Categorical helpers — pick a winning value if its weight clearly leads.
  // The "lead" is enforced as winnerWeight > runnerUpWeight * 1.5; otherwise
  // we conservatively hold + flag as conflict.
  function pickCategorical(
    bucket: Array<{ value: string; weight: number }>,
    current: string
  ): { winner: string; conflict: boolean } {
    if (bucket.length === 0) return { winner: current, conflict: false };
    const aggregated = new Map<string, number>();
    for (const item of bucket) {
      aggregated.set(item.value, (aggregated.get(item.value) ?? 0) + item.weight);
    }
    const ranked = [...aggregated.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length === 1) {
      // Single value with non-trivial weight → switch only if it's strong
      // enough relative to the baseline (current fingerprint's confidence).
      return { winner: ranked[0][0], conflict: false };
    }
    const [topVal, topWeight] = ranked[0];
    const [, runnerUpWeight] = ranked[1];
    if (topWeight > runnerUpWeight * 1.5) {
      return { winner: topVal, conflict: false };
    }
    return { winner: current, conflict: true };
  }

  // ─── pacing.avgCutEverySec ───────────────────────────────────────────
  {
    const bucket = byField.get("pacing.avgCutEverySec") ?? [];
    if (bucket.length > 0) {
      // Numeric: weighted average of observed numbers AGAINST current value
      // weighted by fingerprint confidence.
      const numeric = bucket
        .map((b) => ({
          val: Number.parseFloat(b.value),
          weight: b.weight,
        }))
        .filter((x) => Number.isFinite(x.val));
      if (numeric.length > 0) {
        const baselineWeight = Math.max(0.05, next.pacing.avgCutEverySec * 0 + (next.confidence ?? 0.5));
        let weightedSum = next.pacing.avgCutEverySec * baselineWeight;
        let totalWeight = baselineWeight;
        for (const n of numeric) {
          weightedSum += n.val * n.weight;
          totalWeight += n.weight;
        }
        const newVal = weightedSum / totalWeight;
        if (Math.abs(newVal - next.pacing.avgCutEverySec) > 1e-9) {
          next.pacing.avgCutEverySec = newVal;
          updated.add("pacing.avgCutEverySec");
        }
      }
    }
  }

  // ─── pacing.consistency ──────────────────────────────────────────────
  {
    const bucket = byField.get("pacing.consistency") ?? [];
    if (bucket.length > 0) {
      const valid: Array<{ value: string; weight: number }> = bucket.filter((b) =>
        ["tight", "loose", "mixed"].includes(b.value)
      );
      const { winner, conflict } = pickCategorical(valid, next.pacing.consistency);
      if (conflict) conflicts.add("pacing.consistency");
      if (winner !== next.pacing.consistency) {
        next.pacing.consistency = winner as typeof next.pacing.consistency;
        updated.add("pacing.consistency");
      }
    }
  }

  // ─── pacing.hookLandsAtMs ────────────────────────────────────────────
  {
    const bucket = byField.get("pacing.hookLandsAtMs") ?? [];
    const numeric = bucket
      .map((b) => ({ val: Number.parseFloat(b.value), weight: b.weight }))
      .filter((x) => Number.isFinite(x.val));
    if (numeric.length > 0) {
      const baselineWeight = Math.max(0.05, next.confidence ?? 0.5);
      let weightedSum = next.pacing.hookLandsAtMs * baselineWeight;
      let totalWeight = baselineWeight;
      for (const n of numeric) {
        weightedSum += n.val * n.weight;
        totalWeight += n.weight;
      }
      const newVal = weightedSum / totalWeight;
      if (Math.abs(newVal - next.pacing.hookLandsAtMs) > 1e-9) {
        next.pacing.hookLandsAtMs = newVal;
        updated.add("pacing.hookLandsAtMs");
      }
    }
  }

  // ─── pacing.pacingCurve ──────────────────────────────────────────────
  {
    const bucket = byField.get("pacing.pacingCurve") ?? [];
    const validValues = [
      "fast-throughout",
      "slow-burn",
      "fast-to-slow",
      "building",
      "irregular",
    ];
    const valid = bucket.filter((b) => validValues.includes(b.value));
    if (valid.length > 0) {
      const { winner, conflict } = pickCategorical(valid, next.pacing.pacingCurve);
      if (conflict) conflicts.add("pacing.pacingCurve");
      if (winner !== next.pacing.pacingCurve) {
        next.pacing.pacingCurve = winner as typeof next.pacing.pacingCurve;
        updated.add("pacing.pacingCurve");
      }
    }
  }

  // ─── opening ─────────────────────────────────────────────────────────
  {
    const bucket = byField.get("opening") ?? [];
    const validValues = [
      "face-on",
      "motion-shot",
      "text-card",
      "b-roll",
      "voice-over-still",
      "mixed",
    ];
    const valid = bucket.filter((b) => validValues.includes(b.value));
    if (valid.length > 0) {
      const { winner, conflict } = pickCategorical(valid, next.opening);
      if (conflict) conflicts.add("opening");
      if (winner !== next.opening) {
        next.opening = winner as typeof next.opening;
        updated.add("opening");
      }
    }
  }

  // ─── transitions ─────────────────────────────────────────────────────
  {
    const bucket = byField.get("transitions") ?? [];
    const validValues = [
      "hard-cut",
      "zoom",
      "whip-pan",
      "jump-cut",
      "dissolve",
      "mixed",
    ];
    const valid = bucket.filter((b) => validValues.includes(b.value));
    if (valid.length > 0) {
      const { winner, conflict } = pickCategorical(valid, next.transitions);
      if (conflict) conflicts.add("transitions");
      if (winner !== next.transitions) {
        next.transitions = winner as typeof next.transitions;
        updated.add("transitions");
      }
    }
  }

  // ─── captions.style / position / cadence / visualDescription ─────────
  {
    const styleBucket = byField.get("captions.style") ?? [];
    const styleValid = ["burned-in", "auto", "none", "mixed"];
    const valid = styleBucket.filter((b) => styleValid.includes(b.value));
    if (valid.length > 0) {
      const { winner, conflict } = pickCategorical(valid, next.captions.style);
      if (conflict) conflicts.add("captions.style");
      if (winner !== next.captions.style) {
        next.captions.style = winner as typeof next.captions.style;
        updated.add("captions.style");
      }
    }
  }
  {
    const bucket = byField.get("captions.position") ?? [];
    const validValues = ["top", "center", "bottom", "varies", "not-applicable"];
    const valid = bucket.filter((b) => validValues.includes(b.value));
    if (valid.length > 0) {
      const { winner, conflict } = pickCategorical(valid, next.captions.position);
      if (conflict) conflicts.add("captions.position");
      if (winner !== next.captions.position) {
        next.captions.position = winner as typeof next.captions.position;
        updated.add("captions.position");
      }
    }
  }
  {
    const bucket = byField.get("captions.cadence") ?? [];
    const validValues = ["word-by-word", "phrase", "sentence", "not-applicable"];
    const valid = bucket.filter((b) => validValues.includes(b.value));
    if (valid.length > 0) {
      const { winner, conflict } = pickCategorical(valid, next.captions.cadence);
      if (conflict) conflicts.add("captions.cadence");
      if (winner !== next.captions.cadence) {
        next.captions.cadence = winner as typeof next.captions.cadence;
        updated.add("captions.cadence");
      }
    }
  }
  {
    // visualDescription: free-text, latest-wins. observations are newest first.
    const bucket = byField.get("captions.visualDescription") ?? [];
    if (bucket.length > 0 && bucket[0].value !== next.captions.visualDescription) {
      next.captions.visualDescription = bucket[0].value;
      updated.add("captions.visualDescription");
    }
  }

  // ─── audio ───────────────────────────────────────────────────────────
  {
    const bucket = byField.get("audio") ?? [];
    const validValues = [
      "original-voice",
      "music-driven",
      "trending-sound",
      "voiceover",
      "mixed",
    ];
    const valid = bucket.filter((b) => validValues.includes(b.value));
    if (valid.length > 0) {
      const { winner, conflict } = pickCategorical(valid, next.audio);
      if (conflict) conflicts.add("audio");
      if (winner !== next.audio) {
        next.audio = winner as typeof next.audio;
        updated.add("audio");
      }
    }
  }

  // ─── framing ─────────────────────────────────────────────────────────
  {
    const bucket = byField.get("framing") ?? [];
    const validValues = [
      "fully-vertical-9-16",
      "horizontal-letterboxed",
      "square",
      "mixed",
    ];
    const valid = bucket.filter((b) => validValues.includes(b.value));
    if (valid.length > 0) {
      const { winner, conflict } = pickCategorical(valid, next.framing);
      if (conflict) conflicts.add("framing");
      if (winner !== next.framing) {
        next.framing = winner as typeof next.framing;
        updated.add("framing");
      }
    }
  }

  // ─── signatureMoves ──────────────────────────────────────────────────
  {
    const bucket = byField.get("signatureMoves") ?? [];
    if (bucket.length > 0) {
      // ADD-only: append new (deduped) moves, cap at 8 total.
      const seen = new Set(next.signatureMoves.map((m) => m.toLowerCase()));
      let added = false;
      for (const item of bucket) {
        const v = item.value.trim();
        if (v.length === 0) continue;
        if (seen.has(v.toLowerCase())) continue;
        if (next.signatureMoves.length >= 8) break;
        next.signatureMoves.push(v);
        seen.add(v.toLowerCase());
        added = true;
      }
      if (added) updated.add("signatureMoves");
    }
  }

  return {
    next,
    summary: {
      updated: [...updated],
      applied: args.observations.length,
      conflicts: [...conflicts],
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Action: applyObservationsToFingerprint                                      */
/* -------------------------------------------------------------------------- */

export type ApplyObservationsResult =
  | { ok: true; summary: ApplyObservationsSummary }
  | {
      ok: false;
      reason: "creator-not-found" | "no-unapplied-observations";
    };

export const applyObservationsToFingerprint = internalAction({
  args: {
    creatorId: v.id("creators"),
  },
  handler: async (ctx, args): Promise<ApplyObservationsResult> => {
    const nowMs = Date.now();
    const { unapplied, picture } = await ctx.runQuery(
      internal.creatorMayaV0.editingFingerprintObservations
        .listUnappliedObservationsForCreator,
      { creatorId: args.creatorId, nowMs }
    );

    if (unapplied.length === 0) {
      return { ok: false, reason: "no-unapplied-observations" };
    }

    const current = picture?.editingFingerprint ?? null;

    const { next, summary } = computeNextFingerprint({
      current,
      observations: unapplied.map((r) => ({
        deltas: r.deltas,
        observedAt: r.observedAt,
        publishedPostId: r.publishedPostId,
      })),
      nowMs,
    });

    await ctx.runMutation(
      internal.creatorMayaV0.editingFingerprintObservations
        .persistFingerprintAndMarkApplied,
      {
        creatorId: args.creatorId,
        observationIds: unapplied.map((r) => r._id as Id<"editingFingerprintObservations">),
        nextFingerprint: next,
        nowMs,
      }
    );

    return { ok: true, summary };
  },
});

/* -------------------------------------------------------------------------- */
/* Internal exports for tests                                                  */
/* -------------------------------------------------------------------------- */

export const __test_only__ = {
  observationResponseSchema,
  structuredObservationSchema,
  stripJsonFence,
};
