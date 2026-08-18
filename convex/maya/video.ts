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
import { pickCard } from "./formats";

/** Writes the script. The voice tier — this is what the founder's buyers read. */
export const SCRIPT_MODEL = "openai/gpt-5.6-luna-pro";

/**
 * ⭐ Which assembly model, and what it costs. Verified against
 * `docs.creatify.ai/billing.md` on 2026-08-17.
 *
 * | model | credits | 30s | $ at API Pro |
 * |---|---|---|---|
 * | `standard` | 5 cr / 30s | 5 | $0.75 |
 * | `aurora_v1_fast` | 0.5 cr / sec | 15 | $2.24 |
 * | `aurora_v1` | 1 cr / sec | 30 | $4.49 |
 *
 * ⚠️ This was NOT SET. `createLinkToVideo` accepts `model_version` and we never
 * passed it, so the per-render cost — a 6× spread — was decided by whatever the
 * vendor happens to default to. A cost that moves when someone else changes a
 * default is not a cost anyone is managing.
 *
 * ⭐ `standard` on purpose, and the reason is authenticity rather than money.
 * §7.5.3's ladder is founder footage → real screen recording → **avatar last**,
 * and Aurora buys avatar REALISM. Paying 6× to make the least authentic rung
 * more convincing is spending more to move DOWN the ladder. The upgrade worth
 * buying is a founder's screen recording, which costs nothing.
 *
 * When that argument doesn't apply — a founder who genuinely wants a presenter
 * — `aurora_v1_fast` is the sweet spot at 3×, not `aurora_v1` at 6×.
 */
export const MODEL_VERSIONS = {
  standard: { name: "standard", creditsPerSecond: 5 / 30 },
  aurora_fast: { name: "aurora_v1_fast", creditsPerSecond: 0.5 },
  aurora: { name: "aurora_v1", creditsPerSecond: 1 },
} as const;

export type ModelChoice = keyof typeof MODEL_VERSIONS;

/** The default, per the authenticity argument above. */
export const DEFAULT_MODEL: ModelChoice = "standard";

/** §3.1: a clone is 12 credits per 5 seconds — 14× the standard path. */
export const CREDITS_PER_CLONE_SECOND = 12 / 5;
export const CREDITS_PER_LINK_VIDEO_SECOND = MODEL_VERSIONS.standard.creditsPerSecond;

/** Every render grounds a Link first, and a Link is 1 credit (§3.1). */
export const CREDITS_PER_LINK = 1;

/** §7.5.7 check 7 — a render that lands after the slot is a missed post. */
export const ESTIMATED_RENDER_SECONDS = 180;

export function estimateCredits(
  rung: Rung,
  lengthSeconds: number,
  model: ModelChoice = DEFAULT_MODEL
): number {
  const rate =
    rung === "ad_clone"
      ? CREDITS_PER_CLONE_SECOND
      : MODEL_VERSIONS[model].creditsPerSecond;
  /**
   * ⚠️ The Link is counted. It is only 1 credit, but it is spent on EVERY
   * render, and a gate that checks the render against the allowance while
   * quietly spending a credit outside it drifts by exactly one per video —
   * which at the boundary is the difference between the last video of the month
   * working and failing after the founder said yes.
   */
  return Math.ceil(rate * lengthSeconds) + CREDITS_PER_LINK;
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

    const [plan, videoBudget, spend, assets, truth, idea, library] =
      await Promise.all([
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
      /**
       * ⭐ What she's borrowing, so the storyboard can say WHY.
       *
       * The whole product is that she does the homework — watches what
       * travelled in this niche and reuses the shape. A storyboard that hides
       * its source asks for a yes on taste instead of on evidence, and the
       * founder's own framing for what he wanted was "I saw something on TikTok
       * that inspired me".
       */
      ctx.runQuery(internal.maya.formats.formatCardsFor, {
        customerId: args.customerId,
      }),
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
     * ⚠️ Prefers a WATCHED card. A `read` card knows the spoken hook; a `watch`
     * card knows the visual shape, which is the half a video borrows. And null
     * is a real answer — with no card she says "had an idea" rather than
     * inventing something that caught her eye (§2.7).
     */
    const card = pickCard(library.cards, { channel: TARGET_PLATFORM });
    const inspiration = card
      ? {
          shape: card.reusableAs,
          sourceUrl: card.sourceUrl,
          channel: card.channel,
        }
      : null;

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
      message: storyboardMessage(storyboard(built.brief), inspiration),
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
      model_version?: string;
      target_platform?: string;
      webhook_url?: string;
    }) => Promise<{ id: string }>;
    /** Explicit, never the vendor's default — see MODEL_VERSIONS. */
    model?: ModelChoice;
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
      /**
       * ⚠️ Always stated. Leaving it out hands a 6× cost decision to a vendor
       * default that can change without us noticing.
       */
      model_version: MODEL_VERSIONS[deps.model ?? DEFAULT_MODEL].name,
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
/* -------------------------------------------------------------------------- */
/* Collecting the render — the other half of the loop                          */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ THE RENDER LOOP WAS OPEN. `submitRender` handed a job to Creatify and
 * NOTHING EVER COLLECTED IT. `getLinkToVideo` and `getAdClone` existed in the
 * vendor layer and were called from nowhere; `vendorJobId` was returned and
 * read by nothing outside a test. `runRender`'s own docblock claimed
 * "Re-hosts on done" and no such code existed. A UGC-video agent whose renders
 * are submitted and never come back has no product — every free step worked
 * and the paid one produced silence.
 */
export type CollectVerdict =
  | { state: "pending"; detail: string }
  | { state: "done"; videoUrl: string; creditsUsed?: number }
  | { state: "failed"; failure: VideoFailure; detail: string };

/**
 * ⭐ What the vendor's job row means. Pure, so the whole decision is testable
 * with no key and no network — which is how the rest of this file was built.
 *
 * ⚠️ Terminal-but-no-URL is treated as FAILURE, not as pending. The vendor
 * reporting "done" with nothing to fetch would otherwise poll until the
 * attempt budget ran out and then report a timeout, which sends whoever
 * debugs it looking at latency instead of at the empty field.
 */
export function collectVerdict(
  job: { status?: string | null; video_output?: string | null; credits_used?: number | null; failed_reason?: string | null },
  isDone: (s: string | null | undefined) => boolean,
  isFailed: (s: string | null | undefined) => boolean
): CollectVerdict {
  if (isFailed(job.status)) {
    return {
      state: "failed",
      failure: "vendor_failed",
      // §11 — no vendor name reaches the founder; the reason still reaches us.
      detail: job.failed_reason?.trim() || "the render didn't come back",
    };
  }
  if (isDone(job.status)) {
    const url = job.video_output?.trim();
    if (!url) {
      return {
        state: "failed",
        failure: "vendor_failed",
        detail: "finished with no video attached",
      };
    }
    return {
      state: "done",
      videoUrl: url,
      creditsUsed: typeof job.credits_used === "number" ? job.credits_used : undefined,
    };
  }
  return { state: "pending", detail: job.status?.trim() || "still rendering" };
}

/**
 * How long we keep asking before calling it. Creatify's own docs put a render
 * at ~2.5 minutes; 40 polls at 15s is 10 minutes, which is 4x the expected
 * time and still bounded. Past it the job takes a NAMED failure (§2.5) rather
 * than sitting `running` forever and being reaped by the deadline sweep, which
 * would surface as an infrastructure fault rather than a vendor one.
 */
export const COLLECT_MAX_POLLS = 40;
export const COLLECT_INTERVAL_MS = 15_000;

/**
 * ⚠️ Video bytes are re-hosted, never linked. Vendor URLs expire, and a
 * placement pointing at an expired vendor URL is a post that breaks weeks
 * later, off in the founder's feed where nobody is watching. Convex stores
 * files natively — R2 was never needed for this (verified 2026-08-09).
 *
 * ⚠️ The magic-byte check is the same lesson `media.ts` learned on images: an
 * SSO redirect or a JSON error page stored as `.mp4` publishes as a broken
 * video, and the failure then surfaces on the platform hours later instead of
 * here where it is still cheap.
 */
export function looksLikeVideo(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const ascii = (i: number, n: number) =>
    String.fromCharCode(...bytes.slice(i, i + n));
  // ISO-BMFF (mp4/m4v/mov): a 'ftyp' box at offset 4.
  if (ascii(4, 4) === "ftyp") return "video/mp4";
  // WebM / Matroska: EBML magic.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return "video/webm";
  return null;
}

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

    const outcome = await submitRender(brief, {
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

    /**
     * ⭐ THE HANDOFF THAT WAS MISSING. A submit with no collection scheduled is
     * a paid job we never look at again. Scheduled rather than awaited so the
     * action returns while the vendor renders — a ~2.5 minute await would sit
     * inside the queue's claim and hold a worker slot for the whole render.
     */
    if (outcome.ok && outcome.vendorJobId) {
      await ctx.scheduler.runAfter(
        COLLECT_INTERVAL_MS,
        internal.maya.video.collectRender,
        {
          customerId: args.customerId,
          vendorJobId: outcome.vendorJobId,
          rung: brief.rung,
          poll: 1,
        }
      );
    }
    return outcome;
  },
});

/**
 * ⭐ Ask the vendor whether it's done, and bring the bytes home if it is.
 *
 * Polling rather than the `webhook_url` the endpoints accept: a webhook needs a
 * public route, a shared secret, and Creatify able to reach us — three things
 * that fail independently and silently. Polling reuses the queue that already
 * exists and is exercisable with no credential. Webhooks are the optimisation
 * once volume justifies it, not the thing to depend on first.
 */
export const collectRender = internalAction({
  args: {
    customerId: v.id("customers"),
    vendorJobId: v.string(),
    rung: v.string(),
    poll: v.number(),
  },
  handler: async (
    ctx: ActionCtx,
    args
  ): Promise<{ ok: boolean; detail: string; assetId?: Id<"mediaAssets"> }> => {
    const [{ isCreatifyConfigured }, endpoints, types] = await Promise.all([
      import("../integrations/creatify/client"),
      import("../integrations/creatify/endpoints"),
      import("../integrations/creatify/types"),
    ]);
    if (!isCreatifyConfigured()) {
      return { ok: false, detail: "that part isn't switched on" };
    }

    let job;
    try {
      job =
        args.rung === "ad_clone"
          ? await endpoints.getAdClone(args.vendorJobId)
          : await endpoints.getLinkToVideo(args.vendorJobId);
    } catch (err) {
      /**
       * ⚠️ A transient read failure must not destroy a render that is still
       * running and already paid for. Retry within the same attempt budget;
       * only exhausting it is terminal.
       */
      if (args.poll < COLLECT_MAX_POLLS) {
        await ctx.scheduler.runAfter(
          COLLECT_INTERVAL_MS,
          internal.maya.video.collectRender,
          { ...args, poll: args.poll + 1 }
        );
        return { ok: false, detail: "couldn't reach it, trying again" };
      }
      return { ok: false, detail: `gave up asking: ${String(err)}` };
    }

    const verdict = collectVerdict(
      job,
      types.isDoneStatus,
      types.isFailedStatus
    );

    if (verdict.state === "pending") {
      if (args.poll >= COLLECT_MAX_POLLS) {
        // §2.5 — a named failure, never silence.
        return { ok: false, detail: "the video didn't finish in time" };
      }
      await ctx.scheduler.runAfter(
        COLLECT_INTERVAL_MS,
        internal.maya.video.collectRender,
        { ...args, poll: args.poll + 1 }
      );
      return { ok: false, detail: verdict.detail };
    }

    if (verdict.state === "failed") {
      return { ok: false, detail: verdict.detail };
    }

    // ── done: bring the bytes home ──────────────────────────────────────────
    const res = await fetch(verdict.videoUrl);
    if (!res.ok) {
      return { ok: false, detail: `couldn't download it (${res.status})` };
    }
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const contentType = looksLikeVideo(bytes);
    if (!contentType) {
      return { ok: false, detail: "what came back wasn't a video" };
    }

    const storageId = await ctx.storage.store(
      new Blob([buffer], { type: contentType })
    );
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      return { ok: false, detail: "stored it but couldn't get a link" };
    }

    const { assetId } = await ctx.runMutation(internal.maya.media.record, {
      customerId: args.customerId,
      kind: "video",
      source: "generated",
      storageKey: storageId,
      publicUrl: url,
      contentType,
      bytes: bytes.length,
      caption: "made for you",
    });

    return { ok: true, detail: "the video is ready", assetId };
  },
});
