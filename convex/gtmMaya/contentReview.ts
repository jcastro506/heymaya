/**
 * S13 (2026-05-29) — user-submitted content review.
 *
 * Founders send Maya a finished/edited post, video, or image and want real,
 * specific feedback ("strong hook; cut to the demo by 0:02; caption's buried").
 * The watching is multimodal — OpenRouter is text-only, so it CANNOT proxy
 * video; per the locked architecture, video/image watching routes to the
 * shared `services/video-synth-worker` (yt-dlp/direct download → Gemini Files
 * API), NOT through OpenRouter and NOT per-machine.
 *
 * Flow:
 *   1. The operator sends an attachment in Telegram → OpenClaw's telegram
 *      plugin delivers it to Maya on the Fly machine with a `file_id`.
 *   2. Maya resolves the Telegram file URL (getFile → file_path → the
 *      api.telegram.org/file/... URL — she has $TELEGRAM_BOT_TOKEN) and POSTs
 *      it to `/lc_gtm/review_media`.
 *   3. THIS module hands that URL to the video-synth-worker (platform
 *      "unknown" → yt-dlp's generic downloader handles a direct file URL),
 *      with a feedback system-prompt, and returns the worker's structured
 *      analysis + the geminiCalled proof.
 *   4. Maya turns the analysis into specific feedback in her voice and offers
 *      the next step (approve → post / one-tap hand-off).
 *
 * Convex's job here is the bridge + the grounded proof (`geminiCalled`), not
 * the watching itself — same boundary as the rest of the GTM product.
 */

import { v } from "convex/values";
import { httpAction, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { authenticate } from "./openclaw/inboundCallback";
import {
  synthesizeViaWorker,
  VideoSynthWorkerError,
} from "../integrations/videoSynthWorker/client";

/** The feedback contract the watcher returns — Maya renders it in her voice. */
const REVIEW_SYSTEM_PROMPT = `You are a sharp social-media editor watching a founder's draft post before they publish it. Watch/look at the media and return SPECIFIC, honest, actionable feedback — the kind a real editor gives, grounded in what you actually saw, never generic praise.

Return your analysis as plain text covering, in order:
1. HOOK: does the first 0-3 seconds (or the first line, for an image/caption) earn the watch? Quote/describe the actual hook and say if it lands or needs to change.
2. PACING / STRUCTURE: where does it drag, where's the payoff, when does the demo/point actually land (cite the timestamp). What to cut.
3. CAPTION / KEYWORD: is the keyword/value front-loaded or buried? What to move up.
4. WHAT'S WORKING: the genuine strengths — be specific, don't pad.
5. VERDICT: ship as-is / quick fixes first / needs a rework — and the ONE highest-leverage change.

Be concrete and reference what you actually saw (a real beat, a real timestamp, a real line). No hype, no emoji, no generic "great content!" — specific or silent.`;

/**
 * Watch a piece of operator-submitted media via the video-synth-worker and
 * return structured feedback. `mediaUrl` is a directly-downloadable URL
 * (e.g. the Telegram file URL Maya resolved via getFile). Soft-fails into a
 * clean reason so Maya can tell the operator honestly rather than crash.
 */
export const reviewSubmittedMedia = internalAction({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    mediaUrl: v.string(),
    /** "video" routes through yt-dlp+Gemini; "image" uses the same upload
     *  path (the worker's downloader fetches the direct URL either way). */
    kind: v.union(v.literal("video"), v.literal("image")),
    /** The operator's specific ask, if any ("is the hook strong enough?"). */
    operatorAsk: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    analysis?: string;
    geminiCalled: boolean;
    reason?: string;
  }> => {
    const userPayload = {
      task: "review-submitted-content",
      kind: args.kind,
      operatorAsk: args.operatorAsk ?? "Give me your honest editor's read before I post this.",
    };

    try {
      const result = await synthesizeViaWorker({
        creatorId: String(args.accountId),
        systemPrompt: REVIEW_SYSTEM_PROMPT,
        userPayloadJson: JSON.stringify(userPayload),
        posts: [
          {
            postId: "operator-submitted",
            platform: "unknown",
            videoUrl: args.mediaUrl,
            kind: "video",
          },
        ],
        thinkingBudget: "medium",
      });
      // The worker only uploads to Gemini after a successful download, so a
      // non-zero upload count is the honest "we actually watched it" proof.
      const geminiCalled = result.diagnostics.videosUploaded > 0;
      if (!geminiCalled) {
        const skip = result.diagnostics.skippedVideos[0];
        return {
          ok: false,
          geminiCalled: false,
          reason: skip
            ? `couldn't ${skip.stage} the media (${skip.reason})`
            : "couldn't fetch the media to watch it",
        };
      }
      return { ok: true, analysis: result.content, geminiCalled: true };
    } catch (err) {
      const reason =
        err instanceof VideoSynthWorkerError
          ? `watcher ${err.stage}`
          : (err as Error).message;
      console.error(`[gtm/contentReview] reviewSubmittedMedia failed: ${reason}`);
      return { ok: false, geminiCalled: false, reason };
    }
  },
});

/**
 * POST /lc_gtm/review_media — Maya hands a directly-downloadable media URL
 * (the Telegram file URL she resolved via getFile) and gets back structured
 * editor feedback she renders in her voice. hookToken-authed like every
 * other /lc_gtm/* endpoint.
 *
 * Body: { mediaUrl, kind: "video"|"image", operatorAsk? }
 * Returns 200 with { ok, analysis?, geminiCalled, reason? } so Maya can speak
 * honestly whether or not the watch succeeded (never a hard error to chat).
 */
interface ReviewMediaPayload {
  mediaUrl?: string;
  kind?: "video" | "image";
  operatorAsk?: string;
}
export const reviewMediaHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: ReviewMediaPayload;
  try {
    body = (await request.json()) as ReviewMediaPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.mediaUrl || (body.kind !== "video" && body.kind !== "image")) {
    return new Response("missing required fields (mediaUrl, kind)", {
      status: 400,
    });
  }

  const result = await ctx.runAction(
    internal.gtmMaya.contentReview.reviewSubmittedMedia,
    {
      accountId: auth.accountId,
      agentId: auth.agentId,
      mediaUrl: body.mediaUrl,
      kind: body.kind,
      operatorAsk: body.operatorAsk,
    }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
