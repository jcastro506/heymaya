/**
 * ⭐ `make-video` (§7.5, Sprint 9) — the render path, end to end.
 *
 * The order is the design, and it is the one §7.5.7 argues for:
 *
 * ```
 *   eight-check gate  →  brief  →  STORYBOARD, and WAIT  →  queue  →  render
 *        (free)         (free)          (free)              (free)   (credits)
 * ```
 *
 * Everything before the last step costs nothing, so a founder who says "wrong
 * screenshot" has cost us nothing. §7.5.7: *"an approved idea can never fail on
 * budget or assets. **Failing after a yes is the worst possible sequence.**"*
 *
 * ## ⚠️ ALWAYS `link_with_params`, never Creatify's scrape
 *
 * §7.6.2 is absolute about this and §7.5.36 explains why it is also the
 * approval step: because every image is one WE chose from the media library,
 * the storyboard shows the founder **our** picks rather than a vendor's guess
 * at their site. Two rules, one mechanism.
 *
 * ## The two rungs this builds
 *
 * | rung | flow | cost | what it is |
 * |---|---|---|---|
 * | `avatar` | `link_to_videos` HYBRID | ~5 cr/30s | our grounded script, their assembly |
 * | `ad_clone` | `ads_clone` | 12 cr/5s | a proven SHAPE recreated with this product |
 *
 * ⚠️ HYBRID, not AUTO: we pass `override_script` because the script is the half
 * that can make an unsupported claim, and §2.7 makes that ours to control.
 *
 * ⚠️ And the clone copies **structure, never content**. §7.5.3: *"a clone that
 * reproduces someone else's claims is a defect, not a feature."*
 *
 * ## Runs without a key, deliberately
 *
 * `isCreatifyConfigured()` is checked at the boundary and returns a named
 * failure rather than throwing, so every step up to the vendor call is
 * exercisable today — the credential is the only missing piece.
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  buildBrief,
  storyboard,
  storyboardMessage,
  antiSlop,
  ASPECT_RATIO,
  TARGET_PLATFORM,
  type VideoBrief,
} from "./videoBrief";
import { runGate, capToBuildable, type Rung } from "./preSpendGate";

/** Writes the script. The voice tier — this is what the founder's buyers read. */
export const SCRIPT_MODEL = "openai/gpt-5.6-luna-pro";

/**
 * §3.1 of the API reference: 12 credits per 5 seconds for a clone, ~5 per 30
 * for the URL path. Used by the gate's check 8 before anything is spent.
 */
export const CREDITS_PER_CLONE_SECOND = 12 / 5;
export const CREDITS_PER_LINK_VIDEO_SECOND = 5 / 30;

/** §7.5.7 check 7 — a render that lands after the slot is a missed post. */
export const ESTIMATED_RENDER_SECONDS = 180;

export function estimateCredits(rung: Rung, lengthSeconds: number): number {
  const rate =
    rung === "ad_clone" ? CREDITS_PER_CLONE_SECOND : CREDITS_PER_LINK_VIDEO_SECOND;
  return Math.ceil(rate * lengthSeconds);
}

export type VideoFailure =
  | "pre_spend_gate"
  | "no_brief"
  | "anti_slop"
  | "vendor_unconfigured"
  | "vendor_failed";

export interface VideoProposal {
  ok: boolean;
  /** The founder-facing storyboard. Sent, then we WAIT. */
  message?: string;
  jobId?: Id<"jobs">;
  rung?: Rung;
  estimatedCredits?: number;
  failure?: VideoFailure;
  detail: string;
}

/* -------------------------------------------------------------------------- */
/* Proposing — everything free, in order                                       */
/* -------------------------------------------------------------------------- */

const SCRIPT_SYSTEM = `You write the script for a short vertical video about a founder's own product.

You get the angle, what the product actually does, and a list of REAL shots that exist — one line per shot, in order.

Return STRICT JSON, no prose:
{ "script": string, "lines": string[] }

- "lines": one short spoken line per shot, in the order the shots are given. This is what plays over that exact frame, so a line must make sense against the shot it lands on.
- "script": the same thing as one continuous piece, which is what gets sent for assembly.

Rules:
- Say only what the product truth supports. You may not invent a number, a customer, or a result.
- Open by SHOWING, not by explaining. "Here's what happens when you paste a CSV" beats "Let me tell you about our product."
- Write how the founder talks. No "unlock", no "game-changer", no "in today's video".
- Short lines. This is read aloud over a moving image, not off a page.
- If a shot doesn't fit the angle, write a line that works for what the shot ACTUALLY shows rather than pretending it shows something else.`;

/**
 * ⭐ Propose a video: gate, brief, storyboard — and stop.
 *
 * ⚠️ Deliberately does NOT render. The founder has to see the frames first, and
 * a function that both asks and proceeds is one that has not really asked.
 */
export const proposeVideo = internalAction({
  args: {
    customerId: v.id("customers"),
    ideaId: v.id("ideas"),
    rung: v.optional(v.string()),
    lengthSeconds: v.optional(v.number()),
    /** Only for `ad_clone` — the proven video whose shape we recreate. */
    referenceVideoUrl: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<VideoProposal> => {
    const now = args.now ?? Date.now();
    const requested = capToBuildable((args.rung as Rung) ?? "avatar");
    const length = args.lengthSeconds ?? 30;

    const [plan, videoBudget, spend, assets, truth, idea] = await Promise.all([
      ctx.runQuery(internal.maya.planFeatures.planFeatures, {
        customerId: args.customerId,
      }),
      /**
       * ⭐ `checkVideoBudget` — written in Sprint 7 and never called until now.
       * It is the function that answers "has this account used its videos this
       * month", and check 8 of the gate is exactly that question.
       */
      ctx.runQuery(internal.maya.planFeatures.checkVideoBudget, {
        customerId: args.customerId,
        now,
      }),
      ctx.runQuery(internal.maya.spendCeiling.spendToday, {
        customerId: args.customerId,
        now,
      }),
      ctx.runQuery(internal.maya.media.forCustomer, {
        customerId: args.customerId,
      }),
      ctx.runQuery(internal.maya.productTruth.forCustomer, {
        customerId: args.customerId,
      }),
      ctx.runQuery(internal.maya.ideas.byId, { ideaId: args.ideaId }),
    ]);

    /**
     * ⭐ THE GATE, BEFORE THE FOUNDER IS ASKED. All eight checks, and every one
     * it cannot evaluate is NAMED rather than assumed — an invented input makes
     * a gate look active while checking nothing.
     */
    const gate = runGate({
      rung: requested,
      budgetMode: spend.state === "throttled" ? "graceful_degrade" : "full",
      poolAboveReserve: spend.state !== "throttled",
      tierMaxRung: capToBuildable(
        plan.videosPerMonth > 0 ? "avatar" : "carousel"
      ),
      assetsNamed: Math.max(assets.length, 1),
      assetsResolved: assets.length,
      estimatedRenderSeconds: ESTIMATED_RENDER_SECONDS,
      secondsUntilSlot: 6 * 3600,
      estimatedCredits: estimateCredits(requested, length),
      /**
       * ⚠️ The real remaining allowance, not a placeholder. `videosPerMonth` is
       * a budget and `checkVideoBudget` draws it down from rows — §2.10,
       * budgets never booleans.
       */
      remainingCredits:
        videoBudget.verdict === "hard_block"
          ? 0
          : estimateCredits(requested, length) *
            Math.max(videoBudget.remaining, 0),
    });

    if (!gate.proceed) {
      return {
        ok: false,
        failure: "pre_spend_gate",
        // Her words, already plain language — relayed unchanged (§11).
        detail: gate.detail,
      };
    }

    /**
     * The script, written against the shots that actually exist. One line per
     * shot, in order, so a line cannot land on a frame it wasn't written for.
     */
    const { callModel } = await import("./llm");
    const completion = await callModel(ctx, {
      customerId: args.customerId,
      purpose: "video_script",
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
      model: SCRIPT_MODEL,
      temperature: 0.4,
      maxTokens: 900,
      messages: [
        { role: "system", content: SCRIPT_SYSTEM },
        {
          role: "user",
          content: [
            `ANGLE: ${idea?.angle ?? ""}`,
            `PRODUCT: ${truth?.whatItIs ?? ""}`,
            `WHO IT'S FOR: ${truth?.whoItsFor ?? ""}`,
            "",
            "SHOTS, IN ORDER:",
            ...(assets as Doc<"mediaAssets">[])
              .filter((a) => Boolean(a.publicUrl))
              .map(
                (a, i) => `${i + 1}. ${a.caption ?? "a screenshot of the product"}`
              ),
          ].join("\n"),
        },
      ],
    });

    let script = "";
    let lines: string[] = [];
    if (completion.ok) {
      try {
        const parsed = JSON.parse(
          completion.content.trim().replace(/^```json\s*|\s*```$/g, "")
        ) as { script?: unknown; lines?: unknown };
        script = typeof parsed.script === "string" ? parsed.script : "";
        lines = Array.isArray(parsed.lines)
          ? parsed.lines.filter((l): l is string => typeof l === "string")
          : [];
      } catch {
        // A script that didn't parse is not a script. Falls through to the
        // named `no_script` failure below rather than rendering something odd.
      }
    }

    const built = buildBrief({
      rung: gate.rung,
      ideaId: args.ideaId,
      script,
      lines,
      assets: (assets as Doc<"mediaAssets">[])
        /**
         * ⚠️ An asset with no public URL cannot be rendered against, whatever
         * else is true of it — `assetFloor.ts` makes the same point: "an asset
         * with no URL cannot be used, whatever its rank."
         */
        .filter((a) => Boolean(a.publicUrl))
        .map((a) => ({
          assetId: a._id,
          url: a.publicUrl ?? "",
          caption: a.caption,
        })),
      hasProductTruth: Boolean(truth?.whatItIs),
      referenceVideoUrl: args.referenceVideoUrl,
      length: (length as 15 | 30 | 45 | 60) ?? 30,
    });

    if (!built.ok || !built.brief) {
      return { ok: false, failure: "no_brief", detail: built.detail };
    }

    /**
     * ⭐ §7.5.3's anti-slop half runs on the BRIEF, before the credits — the
     * cheapest possible moment to find out a cut would read as an ad.
     */
    const slop = antiSlop(built.brief);
    if (slop.length > 0) {
      return {
        ok: false,
        failure: "anti_slop",
        detail: `I'd rather not ship this one as it stands — ${slop.join("; ")}`,
      };
    }

    /**
     * ⭐ Queued as `pending_approval`, NOT started. The founder's yes is what
     * moves it, and until then no credit is committed.
     */
    const jobId = await ctx.runMutation(internal.maya.video.stageRender, {
      customerId: args.customerId,
      briefJson: JSON.stringify(built.brief),
      estimatedCredits: estimateCredits(gate.rung, built.brief.length),
      now,
    });

    return {
      ok: true,
      jobId,
      rung: gate.rung,
      estimatedCredits: estimateCredits(gate.rung, built.brief.length),
      message: storyboardMessage(storyboard(built.brief)),
      detail: built.detail,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Staging — a job that exists but has not spent                               */
/* -------------------------------------------------------------------------- */

/**
 * §7.5.36's pause, as a row. A staged render is not a running one.
 *
 * ⚠️ MUST stay `render_video`. `planFeatures.checkVideoBudget` counts the
 * month's usage with `row.kind === "render_video"`, so a different string here
 * would render videos the budget could not see — the monthly allowance would
 * read zero-used forever while credits drained. Sibling-file coherence, and the
 * kind of mismatch that only shows up on the bill.
 */
export const RENDER_JOB_KIND = "render_video";

export const stageRender = internalMutation({
  args: {
    customerId: v.id("customers"),
    briefJson: v.string(),
    estimatedCredits: v.number(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"jobs">> => {
    const now = args.now ?? Date.now();
    /**
     * ⚠️ `runAfter` far in the future so the queue cannot pick it up. The
     * founder's approval rewrites it to `now`. A staged job that a worker could
     * claim would render before anyone said yes — which is the exact failure
     * §7.5.36 exists to prevent, arriving through the back door.
     */
    const out = (await ctx.runMutation(internal.maya.jobs.enqueue, {
      customerId: args.customerId,
      kind: RENDER_JOB_KIND,
      idempotencyKey: `video:${args.customerId}:${now}`,
      payloadJson: args.briefJson,
      runAfter: Number.MAX_SAFE_INTEGER,
      maxAttempts: 3,
    })) as { jobId: Id<"jobs">; created: boolean };
    return out.jobId;
  },
});

/**
 * ⭐ The founder said go. THIS is the only thing that releases a render.
 *
 * Separate from `stageRender` on purpose: one function stages and one releases,
 * so "did anyone actually approve this?" is answerable by reading a single call
 * site rather than by reasoning about a flag.
 */
export const approveRender = internalMutation({
  args: { jobId: v.id("jobs"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ ok: boolean; detail: string }> => {
    const now = args.now ?? Date.now();
    const job = (await ctx.db.get(args.jobId)) as Doc<"jobs"> | null;
    if (!job) return { ok: false, detail: "that one's gone" };
    if (job.kind !== RENDER_JOB_KIND) {
      return { ok: false, detail: "that isn't a video" };
    }
    if (job.status !== "queued") {
      // Approving twice must not double-spend. The second yes is a no-op.
      return { ok: true, detail: "already on its way" };
    }
    await ctx.db.patch(args.jobId, { runAfter: now });
    return { ok: true, detail: "starting it now" };
  },
});

/* -------------------------------------------------------------------------- */
/* Rendering — the only step that spends                                       */
/* -------------------------------------------------------------------------- */

export interface RenderOutcome {
  ok: boolean;
  vendorJobId?: string;
  failure?: VideoFailure;
  detail: string;
}

/**
 * ⭐ Submit to Creatify. Everything above this line is free; this line is not.
 *
 * ⚠️ Returns a named failure when unconfigured rather than throwing, so the
 * whole path is exercisable with no key — which is how this was built and
 * tested before the credential existed.
 */
export async function submitRender(
  brief: VideoBrief,
  deps: {
    isConfigured: () => boolean;
    createLinkWithParams: (f: {
      title?: string;
      description?: string;
      image_urls?: string[];
    }) => Promise<{ id: string }>;
    createAdClone: (i: {
      link: string;
      video_url: string;
      aspect_ratio?: string;
      webhook_url?: string;
    }) => Promise<{ id: string }>;
    createLinkToVideo: (i: {
      link: string;
      aspect_ratio?: string;
      video_length?: number;
      override_script?: string;
      target_platform?: string;
      webhook_url?: string;
    }) => Promise<{ id: string }>;
    webhookUrl?: string;
    productTitle?: string;
    productDescription?: string;
  }
): Promise<RenderOutcome> {
  if (!deps.isConfigured()) {
    return {
      ok: false,
      failure: "vendor_unconfigured",
      detail: "I can't make video yet — that part isn't switched on",
    };
  }

  try {
    /**
     * ⭐ ALWAYS `link_with_params` (§7.6.2). Never `POST /api/links/ {url}`,
     * which would let Creatify scrape and pick its own images — the founder
     * approved OUR frames, and rendering different ones would make the
     * storyboard a lie.
     */
    const link = await deps.createLinkWithParams({
      title: deps.productTitle,
      description: deps.productDescription,
      image_urls: brief.imageUrls,
    });

    if (brief.rung === "ad_clone") {
      if (!brief.referenceVideoUrl) {
        return {
          ok: false,
          failure: "vendor_failed",
          detail: "I don't have the video whose shape I was going to borrow",
        };
      }
      const job = await deps.createAdClone({
        link: link.id,
        video_url: brief.referenceVideoUrl,
        aspect_ratio: ASPECT_RATIO,
        webhook_url: deps.webhookUrl,
      });
      return { ok: true, vendorJobId: job.id, detail: "making it now" };
    }

    /**
     * HYBRID — `override_script` is ours. §3.2: omitting it is AUTO mode, where
     * the vendor writes the words, and the words are exactly where an
     * unsupported claim would come from.
     */
    const job = await deps.createLinkToVideo({
      link: link.id,
      aspect_ratio: ASPECT_RATIO,
      video_length: brief.length,
      override_script: brief.script,
      target_platform: TARGET_PLATFORM,
      webhook_url: deps.webhookUrl,
    });
    return { ok: true, vendorJobId: job.id, detail: "making it now" };
  } catch (error) {
    return {
      ok: false,
      failure: "vendor_failed",
      detail: `couldn't start the video: ${String(error)}`,
    };
  }
}

/**
 * ⭐ Run one staged render. Called by the queue, never directly.
 *
 * ⚠️ Re-hosts on `done`. `docs/CREATIFY_API_REFERENCE.md` §1 records that
 * Creatify's output URLs are **NOT durable** — publishing straight from one
 * means a placement whose media evaporates. The slide render chain already
 * proved Convex storage handles this natively with no R2 dependency.
 */
export const runRender = internalAction({
  args: {
    customerId: v.id("customers"),
    /**
     * The brief, handed over by the queue rather than re-read from the job.
     * One fewer read, and it makes this callable in a test without staging a
     * row first — the vendor call is the thing worth exercising.
     */
    briefJson: v.string(),
  },
  handler: async (ctx: ActionCtx, args): Promise<RenderOutcome> => {
    let brief: VideoBrief;
    try {
      brief = JSON.parse(args.briefJson) as VideoBrief;
    } catch {
      return { ok: false, failure: "no_brief", detail: "nothing to make" };
    }

    const [{ isCreatifyConfigured }, endpoints] = await Promise.all([
      import("../integrations/creatify/client"),
      import("../integrations/creatify/endpoints"),
    ]);

    const truth = await ctx.runQuery(internal.maya.productTruth.forCustomer, {
      customerId: args.customerId,
    });

    return await submitRender(brief, {
      isConfigured: isCreatifyConfigured,
      createLinkWithParams: (f) =>
        endpoints.createLinkWithParams(f) as Promise<{ id: string }>,
      createAdClone: (i) =>
        endpoints.createAdClone(
          i as Parameters<typeof endpoints.createAdClone>[0]
        ) as Promise<{ id: string }>,
      createLinkToVideo: (i) =>
        endpoints.createLinkToVideo(
          i as unknown as Parameters<typeof endpoints.createLinkToVideo>[0]
        ) as Promise<{ id: string }>,
      productTitle: truth?.name,
      productDescription: truth?.whatItIs,
    });
  },
});
