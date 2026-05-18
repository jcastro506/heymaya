/**
 * produce_edit — C1: creator sends 1+ raw clips + a brief; Maya returns a
 * real edited short.
 *
 * Architecture (grounded 2026-05-18): the video-synth-worker's `/synthesize`
 * endpoint is a GENERIC "watch these videos with this system prompt → return
 * raw model JSON" service (the prompt determines the schema; the worker does
 * not bake one in). So this reuses that proven, tested transport with ZERO
 * worker changes:
 *
 *   1. Resolve the creator's dense picture (editingFingerprint / topHooks
 *      with performance lift / voiceFingerprint / niche) as conditioning.
 *   2. ONE fused Gemini-multimodal call via `synthesizeViaWorker`: watch all
 *      clips + the brief, conditioned on the picture, return a strict EDL.
 *      Watch and decide are one call — the editor must see the footage while
 *      deciding, not edit from a transcript.
 *   3. Validate the returned JSON against `EditDecisionListSchema`.
 *
 * The EDL is the universal contract for BOTH cases — one long clip (chop:
 * repeated `clipId` across windows) and many clips (stitch: mixed clipIds).
 * Gemini decides; it never touches a frame. The caller (the
 * `maya-tiktok-director` skill) deterministically compiles the EDL into one
 * ffmpeg `filter_complex`, renders locally, uploads, and delivers. Gemini
 * NEVER emits ffmpeg syntax — bad filter syntax is the #1 ffmpeg failure
 * mode; model = decision, code = command.
 */

import { z } from "zod";
import { v } from "convex/values";
import { internalAction, httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  synthesizeViaWorker,
  type SynthesizeWorkerPost,
} from "../integrations/videoSynthWorker/client";
import { assertWebhookSecret } from "../lib/webhookSecret";

/* -------------------------------------------------------------------------- */
/* EDL — the universal edit contract                                           */
/* -------------------------------------------------------------------------- */

const EdlSegmentSchema = z.object({
  /** Which source clip this segment is cut from (matches an input clipId). */
  clipId: z.string().min(1).max(128),
  /** Start time within that source clip, in seconds. */
  inSec: z.number().min(0).max(36_000),
  /** End time within that source clip, in seconds. > inSec. */
  outSec: z.number().min(0).max(36_000),
  /** Transition INTO this segment. Hard cut by default. */
  transition: z
    .enum(["cut", "dissolve", "whip", "zoom"])
    .default("cut"),
});

export const EditDecisionListSchema = z
  .object({
    /** Total target duration of the rendered output, seconds. */
    targetDurationSec: z.number().min(2).max(180),
    /**
     * The opener — repeated as segments[0] too, but called out so the
     * compiler + the delivered one-liner can name why it leads.
     */
    opener: z.object({
      clipId: z.string().min(1).max(128),
      inSec: z.number().min(0).max(36_000),
      outSec: z.number().min(0).max(36_000),
      /** One short clause: why this is the hook (cited to the picture). */
      why: z.string().min(1).max(280),
    }),
    /** Ordered cut list. >= 1. segments[0] should equal the opener window. */
    segments: z.array(EdlSegmentSchema).min(1).max(40),
    /** Optional burned-in text overlays. */
    captions: z
      .array(
        z.object({
          text: z.string().min(1).max(120),
          atSec: z.number().min(0).max(180),
        })
      )
      .max(20)
      .default([]),
    /**
     * Per-decision rationale, each tied to a specific evidence string from
     * the creator picture (a topHook pattern, an editingFingerprint trait).
     * This is what the firewall checks and what the delivered one-liner
     * paraphrases. Empty array is invalid — every edit must be explainable.
     */
    rationale: z
      .array(
        z.object({
          choice: z.string().min(1).max(200),
          evidenceCited: z.string().min(1).max(200),
        })
      )
      .min(1)
      .max(12),
  })
  .strict();

export type EditDecisionList = z.infer<typeof EditDecisionListSchema>;

export type ProduceEditResult =
  | { ok: true; edl: EditDecisionList; model: string }
  | {
      ok: false;
      reason:
        | "no-clips"
        | "creator-not-found"
        | "no-picture"
        | "clip-not-found"
        | "worker-failed"
        | "model-malformed"
        | "edl-invalid";
      detail: string;
    };

/* -------------------------------------------------------------------------- */
/* Edit-director system prompt                                                 */
/* -------------------------------------------------------------------------- */

export const EDIT_DIRECTOR_SYSTEM_PROMPT = `You are this creator's video editor. You will WATCH every source clip provided, then DECIDE the edit. You do not write ffmpeg and you do not touch frames — you output ONLY a JSON Edit Decision List (EDL) that downstream code compiles into the actual cut.

INPUTS (in the user payload):
- "brief": what the creator asked for (the post they want).
- "picture": this specific creator's dense profile. Condition EVERY choice on it:
  - "editingFingerprint": how THEY cut — shot length, cut rhythm, opener pattern (cold-open vs build), signature closer, pacing curve, caption style. The output must look like THEM, not a generic editor.
  - "topHooks": their openers that ACTUALLY performed, with lift. The opener you pick MUST match their highest-lift hook shape unless the footage makes it impossible — then say so in rationale.
  - "voiceFingerprint" + "niche": drive caption tone and what the cut is "about".
- The attached videos are the source clips. Each is identified by "clipId" (given in the payload's "clips" list, in order).

TASK:
- ONE long clip (creator said "chop this" / "cut this down"): find the punchy beats inside it, drop dead air, pick the hook moment, order for energy. The EDL's segments all reference that one clipId with different in/out windows.
- MANY clips (creator said "make a TikTok from these" / "stitch these"): pick the 3-6 that tell a coherent beat, the strongest 2-3s window from each, order into a hook→build→payoff→closer arc that serves the brief. Segments reference multiple clipIds.

HARD RULES:
- Output STRICT JSON only. No prose, no markdown, no code fences. Just the EDL object.
- Timestamps are seconds within each source clip; outSec > inSec; windows must be real moments you actually saw in that clip.
- segments[0] MUST be the same window as "opener".
- targetDurationSec <= 60 unless the brief explicitly asks for the 90s lane (never > 90).
- Every entry in "rationale" cites a SPECIFIC string from the picture (a topHook pattern, an editingFingerprint trait) — not vibes. If you cannot ground a choice in their picture, do not make that claim.
- If you genuinely could not see a clip (corrupt/blank), do NOT invent beats for it — exclude it and note it in rationale. Never fabricate footage you didn't watch.

Return the EDL matching exactly this shape:
{"targetDurationSec":number,"opener":{"clipId":string,"inSec":number,"outSec":number,"why":string},"segments":[{"clipId":string,"inSec":number,"outSec":number,"transition":"cut"|"dissolve"|"whip"|"zoom"}],"captions":[{"text":string,"atSec":number}],"rationale":[{"choice":string,"evidenceCited":string}]}`;

/* -------------------------------------------------------------------------- */
/* Picture conditioning                                                        */
/* -------------------------------------------------------------------------- */

interface PictureConditioning {
  niche: string;
  voiceFingerprint: string;
  topHooks: unknown;
  editingFingerprint: unknown;
}

function pictureConditioning(
  picture: Doc<"creatorPicture"> | null
): PictureConditioning | null {
  if (!picture) return null;
  return {
    niche: picture.niche,
    voiceFingerprint: picture.voiceFingerprint,
    topHooks: picture.topHooks ?? [],
    editingFingerprint:
      (picture as { editingFingerprint?: unknown }).editingFingerprint ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Internal action (testable directly; httpAction is a thin wrapper)           */
/* -------------------------------------------------------------------------- */

export const produceEditInternal = internalAction({
  args: {
    creatorId: v.id("creators"),
    brief: v.string(),
    clips: v.array(
      v.object({
        clipId: v.string(),
        mediaAssetId: v.id("creatorMayaV0MediaAssets"),
      })
    ),
  },
  handler: async (ctx, args): Promise<ProduceEditResult> => {
    if (args.clips.length === 0) {
      return { ok: false, reason: "no-clips", detail: "no clips supplied" };
    }
    const loaded = await ctx.runQuery(
      internal.lcMaya.produceEdit.loadEditInputs,
      { creatorId: args.creatorId }
    );
    if (!loaded.creator) {
      return {
        ok: false,
        reason: "creator-not-found",
        detail: `creator ${args.creatorId} not found`,
      };
    }
    const cond = pictureConditioning(loaded.picture);
    if (!cond) {
      return {
        ok: false,
        reason: "no-picture",
        detail:
          "no creatorPicture — onboarding synth must run before edits can be conditioned",
      };
    }

    // Server-side resolve mediaAssetId → fetchable URL, with the
    // creator-ownership check baked in (`getCreatorMediaAssetInternal` →
    // `requireOwnedAsset` throws on missing OR cross-tenant). The skill
    // never handles raw URLs; cross-tenant isolation is enforced here.
    const workerPosts: SynthesizeWorkerPost[] = [];
    for (const c of args.clips) {
      let storageUrl: string;
      try {
        const asset = await ctx.runQuery(
          internal.creatorMayaV0.mediaAssets.getCreatorMediaAssetInternal,
          { creatorId: args.creatorId, assetId: c.mediaAssetId }
        );
        storageUrl = asset.storageUrl;
      } catch (err) {
        return {
          ok: false,
          reason: "clip-not-found",
          detail: `clip '${c.clipId}' (${c.mediaAssetId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
      if (!storageUrl) {
        return {
          ok: false,
          reason: "clip-not-found",
          detail: `clip '${c.clipId}' has no resolvable storage URL`,
        };
      }
      workerPosts.push({
        postId: c.clipId,
        platform: "inbound",
        videoUrl: storageUrl,
        kind: "video",
      });
    }

    const userPayloadJson = JSON.stringify({
      brief: args.brief.slice(0, 4_000),
      clips: args.clips.map((c) => ({ clipId: c.clipId })),
      picture: cond,
    });

    let content: string;
    let model: string;
    try {
      const resp = await synthesizeViaWorker({
        creatorId: args.creatorId,
        systemPrompt: EDIT_DIRECTOR_SYSTEM_PROMPT,
        userPayloadJson,
        posts: workerPosts,
        thinkingBudget: "high",
      });
      content = resp.content;
      model = resp.model;
    } catch (err) {
      return {
        ok: false,
        reason: "worker-failed",
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(stripFences(content));
    } catch {
      return {
        ok: false,
        reason: "model-malformed",
        detail: "edit-director returned non-JSON content",
      };
    }

    const parsed = EditDecisionListSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        reason: "edl-invalid",
        detail: parsed.error.issues
          .slice(0, 6)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      };
    }

    // Cross-check: every EDL clipId must be one we actually sent. The model
    // must not invent a clip it didn't watch.
    const known = new Set(args.clips.map((c) => c.clipId));
    const edl = parsed.data;
    const allIds = [
      edl.opener.clipId,
      ...edl.segments.map((s) => s.clipId),
    ];
    const unknownId = allIds.find((id) => !known.has(id));
    if (unknownId) {
      return {
        ok: false,
        reason: "edl-invalid",
        detail: `EDL references clipId '${unknownId}' that was not in the input`,
      };
    }
    for (const s of [edl.opener, ...edl.segments]) {
      if (s.outSec <= s.inSec) {
        return {
          ok: false,
          reason: "edl-invalid",
          detail: `segment outSec (${s.outSec}) must exceed inSec (${s.inSec})`,
        };
      }
    }

    return { ok: true, edl, model };
  },
});

/* Internal query — load creator + their picture for conditioning. */
import { internalQuery } from "../_generated/server";

export const loadEditInputs = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (
    ctx,
    args
  ): Promise<{
    creator: Doc<"creators"> | null;
    picture: Doc<"creatorPicture"> | null;
  }> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) return { creator: null, picture: null };
    const pics = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    const picture =
      pics.length === 0
        ? null
        : pics.reduce((latest, p) =>
            p.generatedAt > latest.generatedAt ? p : latest
          );
    return { creator, picture };
  },
});

/* -------------------------------------------------------------------------- */
/* HTTP wrapper                                                                */
/* -------------------------------------------------------------------------- */

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stripFences(s: string): string {
  const t = s.trim();
  if (t.startsWith("```")) {
    return t
      .replace(/^```[a-zA-Z]*\n?/, "")
      .replace(/```$/, "")
      .trim();
  }
  return t;
}

interface ProduceEditPayload {
  secret: string;
  creatorId: string;
  brief: string;
  clips: Array<{ clipId: string; mediaAssetId: string }>;
}

function parsePayload(raw: unknown): ProduceEditPayload {
  if (!raw || typeof raw !== "object") throw new Error("Body must be JSON.");
  const o = raw as Record<string, unknown>;
  if (typeof o.secret !== "string") throw new Error("secret must be a string.");
  if (typeof o.creatorId !== "string" || o.creatorId.length === 0)
    throw new Error("creatorId is required.");
  if (typeof o.brief !== "string" || o.brief.length === 0)
    throw new Error("brief is required.");
  if (!Array.isArray(o.clips) || o.clips.length === 0)
    throw new Error("clips[] is required (at least one).");
  const clips = o.clips.map((c, i) => {
    if (!c || typeof c !== "object")
      throw new Error(`clips[${i}] must be an object.`);
    const cc = c as Record<string, unknown>;
    if (typeof cc.clipId !== "string" || cc.clipId.length === 0)
      throw new Error(`clips[${i}].clipId is required.`);
    if (typeof cc.mediaAssetId !== "string" || cc.mediaAssetId.length === 0)
      throw new Error(`clips[${i}].mediaAssetId is required.`);
    return { clipId: cc.clipId, mediaAssetId: cc.mediaAssetId };
  });
  return {
    secret: o.secret,
    creatorId: o.creatorId,
    brief: o.brief,
    clips,
  };
}

export const produceEditHttp = httpAction(async (ctx, request) => {
  let payload: ProduceEditPayload;
  try {
    payload = parsePayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }
  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const result: ProduceEditResult = await ctx.runAction(
    internal.lcMaya.produceEdit.produceEditInternal,
    {
      creatorId: payload.creatorId as Id<"creators">,
      brief: payload.brief,
      clips: payload.clips.map((c) => ({
        clipId: c.clipId,
        mediaAssetId: c.mediaAssetId as Id<"creatorMayaV0MediaAssets">,
      })),
    }
  );
  if (result.ok) {
    return jsonResponse({ ok: true, edl: result.edl, model: result.model }, 200);
  }
  const status =
    result.reason === "creator-not-found"
      ? 404
      : result.reason === "no-clips"
        ? 400
        : 502;
  return jsonResponse(
    { ok: false, reason: result.reason, detail: result.detail },
    status
  );
});
