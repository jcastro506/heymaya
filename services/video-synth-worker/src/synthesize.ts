/**
 * synthesize — orchestrator for the worker's `/synthesize` endpoint.
 *
 * Receives a request body shaped like:
 *   {
 *     creatorId,
 *     systemPrompt,         // SYNTH_SYSTEM_PROMPT from the Convex side
 *     userPayloadJson,      // serialized PromptPayload (already includes
 *                           // per-platform posts + creator metadata + the
 *                           // batchingDiagnostics block)
 *     posts: [
 *       { platform, postId, videoUrl, kind: "video"|"text-context" },
 *       ...
 *     ],
 *     thinkingBudget,       // "none"|"low"|"medium"|"high" — synthesis is "high"
 *     retryReminder?,       // appended on retry attempts
 *   }
 *
 * For each `kind:"video"` post:
 *   1. download via yt-dlp → local /tmp file (parallel, capped at 5)
 *   2. upload to Gemini Files API → get fileUri (parallel)
 *   3. wait for ACTIVE state
 *
 * `kind:"text-context"` posts are NOT downloaded — they're already encoded
 * inside `userPayloadJson` as text by the Convex caller, so the worker just
 * forwards them through the prompt.
 *
 * Then ONE generateContent call with all video file refs + the user payload.
 *
 * Cleanup runs in `try/finally`. Per-video download failure is non-fatal:
 * the post is dropped from the multimodal batch and surfaced in
 * `diagnostics.skippedVideos`, and the synthesis still runs.
 */

import { GoogleGenAI } from "@google/genai";
import {
  callGeminiSynthesis,
  uploadAndWaitActive,
  GeminiError,
  type UploadedVideoRef,
} from "./gemini";
import {
  cleanupVideo,
  cleanupTmpDirOlderThan,
  downloadVideo,
  type Platform,
} from "./video";

export interface SynthesizePostInput {
  postId: string;
  platform: string;
  videoUrl: string;
  kind: "video" | "text-context";
}

export interface SynthesizeRequestBody {
  creatorId: string;
  systemPrompt: string;
  userPayloadJson: string;
  posts: SynthesizePostInput[];
  thinkingBudget: "none" | "low" | "medium" | "high";
  retryReminder?: string;
}

export interface SkippedVideo {
  postId: string;
  platform: string;
  reason: string;
  stage: "download" | "upload";
}

export interface SynthesizeResult {
  ok: true;
  /** Raw model JSON text — caller (Convex) parses + validates downstream. */
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
  };
  diagnostics: {
    videosRequested: number;
    videosDownloaded: number;
    videosUploaded: number;
    skippedVideos: SkippedVideo[];
    totalElapsedMs: number;
    downloadElapsedMs: number;
    uploadElapsedMs: number;
    geminiElapsedMs: number;
  };
}

export interface SynthesizeFailure {
  ok: false;
  error: {
    code:
      | "no-videos-and-required"
      | "all-videos-failed"
      | "gemini-failure"
      | "internal";
    detail: string;
    stage?: GeminiError["stage"];
  };
  diagnostics?: SynthesizeResult["diagnostics"];
}

export interface SynthesizeOptions {
  /** Concurrent download/upload cap. */
  concurrency?: number;
  /** Per-video download timeout (ms). */
  downloadTimeoutMs?: number;
  /** Total request budget (ms). Default 5min. */
  totalBudgetMs?: number;
  /**
   * Inject a Gemini client (for tests). When not provided, the caller is
   * expected to construct one via `buildGeminiClient` and pass it in.
   */
  client: GoogleGenAI;
  /** Override per-call download impl (tests). */
  downloadImpl?: typeof downloadVideo;
  /** Override per-call upload impl (tests). */
  uploadImpl?: typeof uploadAndWaitActive;
  /** Override per-call generateContent impl (tests). */
  generateImpl?: typeof callGeminiSynthesis;
  /** Optional override for tmp dir (tests). */
  tmpDir?: string;
  /** When true, log structured JSON to stderr. Default true. */
  log?: (line: Record<string, unknown>) => void;
  /** Override model name (tests / dev). */
  model?: string;
}

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
const DEFAULT_TOTAL_BUDGET_MS = 5 * 60 * 1000;
const TMP_FILE_MAX_AGE_SEC = 600; // 10min — tail-end housekeeping

/**
 * Promise-pool runner. Limits concurrency to `concurrency` simultaneous
 * inflight tasks. Returns results in the original input order.
 */
async function runWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const lane = async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };
  const laneCount = Math.min(concurrency, items.length);
  for (let i = 0; i < laneCount; i += 1) {
    runners.push(lane());
  }
  await Promise.all(runners);
  return results;
}

function normalizePlatform(p: string): Platform {
  const lower = p.toLowerCase();
  if (lower === "tiktok") return "tiktok";
  if (lower === "instagram" || lower === "ig") return "instagram";
  if (lower === "youtube" || lower === "yt") return "youtube";
  if (lower === "linkedin" || lower === "li") return "linkedin";
  if (lower === "x" || lower === "twitter") return "x";
  if (lower === "facebook" || lower === "fb") return "facebook";
  return "unknown";
}

/**
 * Main orchestrator. Pure function over the request body + injected client.
 */
export async function runSynthesis(
  body: SynthesizeRequestBody,
  opts: SynthesizeOptions
): Promise<SynthesizeResult | SynthesizeFailure> {
  const log = opts.log ?? defaultLog;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const downloadTimeoutMs =
    opts.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const totalBudgetMs = opts.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
  const downloadImpl = opts.downloadImpl ?? downloadVideo;
  const uploadImpl = opts.uploadImpl ?? uploadAndWaitActive;
  const generateImpl = opts.generateImpl ?? callGeminiSynthesis;

  const start = Date.now();
  const videoPosts = body.posts.filter((p) => p.kind === "video");

  log({
    msg: "synthesize:start",
    creatorId: body.creatorId,
    videosRequested: videoPosts.length,
    textOnlyCount: body.posts.length - videoPosts.length,
    thinkingBudget: body.thinkingBudget,
    retry: Boolean(body.retryReminder),
  });

  const skippedVideos: SkippedVideo[] = [];
  const downloadedFiles: string[] = [];
  const uploadResults: UploadedVideoRef[] = [];

  let downloadElapsedMs = 0;
  let uploadElapsedMs = 0;

  try {
    // Stage 1: download every video in parallel (capped concurrency).
    const dlStart = Date.now();
    const dlOutcomes = await runWithConcurrency(
      videoPosts,
      concurrency,
      async (post) => {
        const platform = normalizePlatform(post.platform);
        const result = await downloadImpl(platform, post.videoUrl, {
          timeoutMs: downloadTimeoutMs,
          tmpDir: opts.tmpDir,
        });
        return { post, result };
      }
    );
    downloadElapsedMs = Date.now() - dlStart;

    for (const { post, result } of dlOutcomes) {
      if (!result.ok || !result.filePath) {
        skippedVideos.push({
          postId: post.postId,
          platform: post.platform,
          reason: result.error ?? "unknown-download-failure",
          stage: "download",
        });
        continue;
      }
      downloadedFiles.push(result.filePath);
    }

    log({
      msg: "synthesize:downloads-complete",
      creatorId: body.creatorId,
      downloaded: downloadedFiles.length,
      skipped: skippedVideos.length,
      elapsedMs: downloadElapsedMs,
    });

    // Budget gate.
    if (Date.now() - start > totalBudgetMs) {
      return failure(
        "internal",
        `request budget exceeded during downloads (${totalBudgetMs}ms)`,
        diagnostics(
          videoPosts.length,
          downloadedFiles.length,
          uploadResults.length,
          skippedVideos,
          start,
          downloadElapsedMs,
          uploadElapsedMs,
          0
        )
      );
    }

    // Stage 2: upload each downloaded file → Gemini Files API. Map file to
    // the originating post via the index alignment we maintain in
    // postsForUpload (we filter the same outcomes list to the successful ones).
    const upStart = Date.now();
    const successfulOutcomes = dlOutcomes.filter(
      (o): o is typeof o & { result: { ok: true; filePath: string; elapsedSec: number } } =>
        o.result.ok && Boolean(o.result.filePath)
    );
    const upOutcomes = await runWithConcurrency(
      successfulOutcomes,
      concurrency,
      async ({ post, result }) => {
        try {
          const ref = await uploadImpl(opts.client, result.filePath, {
            postId: post.postId,
            platform: post.platform,
          });
          return { post, ref };
        } catch (err) {
          const reason =
            err instanceof GeminiError ? err.message : String(err);
          return { post, error: reason };
        }
      }
    );
    uploadElapsedMs = Date.now() - upStart;

    for (const o of upOutcomes) {
      // Type narrowing: TypeScript widens the discriminated union after
      // the runWithConcurrency lane returns. Use the explicit "ref" key
      // check + non-null assertion to recover the success/failure branch.
      if ("ref" in o && o.ref) {
        uploadResults.push(o.ref);
      } else if ("error" in o) {
        skippedVideos.push({
          postId: o.post.postId,
          platform: o.post.platform,
          reason: o.error,
          stage: "upload",
        });
      }
    }

    log({
      msg: "synthesize:uploads-complete",
      creatorId: body.creatorId,
      uploaded: uploadResults.length,
      skipped: skippedVideos.length,
      elapsedMs: uploadElapsedMs,
    });

    // Budget gate.
    if (Date.now() - start > totalBudgetMs) {
      return failure(
        "internal",
        `request budget exceeded during uploads (${totalBudgetMs}ms)`,
        diagnostics(
          videoPosts.length,
          downloadedFiles.length,
          uploadResults.length,
          skippedVideos,
          start,
          downloadElapsedMs,
          uploadElapsedMs,
          0
        )
      );
    }

    // Stage 3: ONE generateContent call.
    const genStart = Date.now();
    let geminiResult;
    try {
      geminiResult = await generateImpl(
        opts.client,
        {
          systemPrompt: body.systemPrompt,
          userPayloadJson: body.userPayloadJson,
          retryReminder: body.retryReminder,
          uploadedVideos: uploadResults,
          thinkingBudget: body.thinkingBudget,
        },
        {
          model: opts.model,
          generateTimeoutMs: Math.max(
            10_000,
            totalBudgetMs - (Date.now() - start)
          ),
        }
      );
    } catch (err) {
      const stage =
        err instanceof GeminiError ? err.stage : "generate-content";
      return failure(
        "gemini-failure",
        err instanceof Error ? err.message : String(err),
        diagnostics(
          videoPosts.length,
          downloadedFiles.length,
          uploadResults.length,
          skippedVideos,
          start,
          downloadElapsedMs,
          uploadElapsedMs,
          Date.now() - genStart
        ),
        stage
      );
    }
    const geminiElapsedMs = Date.now() - genStart;

    log({
      msg: "synthesize:gemini-complete",
      creatorId: body.creatorId,
      elapsedMs: geminiElapsedMs,
      contentLen: geminiResult.content.length,
      inputTokens: geminiResult.usage.inputTokens,
      outputTokens: geminiResult.usage.outputTokens,
      // Sprint 10 — track which multimodal fields Gemini emitted (cheap
      // substring check — useful diagnostic for empty multimodal output
      // without forcing a re-parse on the worker).
      hasVoiceAndPersonality: geminiResult.content.includes('"voiceAndPersonality"'),
      hasVisualStyle: geminiResult.content.includes('"visualStyle"'),
      hasRecurringElements: geminiResult.content.includes('"recurringElements"'),
      hasWarmthMaterial: geminiResult.content.includes('"warmthMaterial"'),
    });

    return {
      ok: true,
      content: geminiResult.content,
      model: geminiResult.model,
      usage: geminiResult.usage,
      diagnostics: diagnostics(
        videoPosts.length,
        downloadedFiles.length,
        uploadResults.length,
        skippedVideos,
        start,
        downloadElapsedMs,
        uploadElapsedMs,
        geminiElapsedMs
      ),
    };
  } finally {
    // Cleanup happens unconditionally — successful path AND error path.
    for (const f of downloadedFiles) {
      cleanupVideo(f);
    }
    cleanupTmpDirOlderThan(TMP_FILE_MAX_AGE_SEC, opts.tmpDir);
    log({
      msg: "synthesize:cleanup",
      creatorId: body.creatorId,
      filesRemoved: downloadedFiles.length,
    });
  }
}

function diagnostics(
  videosRequested: number,
  videosDownloaded: number,
  videosUploaded: number,
  skippedVideos: SkippedVideo[],
  start: number,
  downloadElapsedMs: number,
  uploadElapsedMs: number,
  geminiElapsedMs: number
): SynthesizeResult["diagnostics"] {
  return {
    videosRequested,
    videosDownloaded,
    videosUploaded,
    skippedVideos,
    totalElapsedMs: Date.now() - start,
    downloadElapsedMs,
    uploadElapsedMs,
    geminiElapsedMs,
  };
}

function failure(
  code: SynthesizeFailure["error"]["code"],
  detail: string,
  diag?: SynthesizeResult["diagnostics"],
  stage?: GeminiError["stage"]
): SynthesizeFailure {
  return {
    ok: false,
    error: { code, detail, stage },
    diagnostics: diag,
  };
}

function defaultLog(line: Record<string, unknown>): void {
  // Single-line JSON to stderr for Fly's log shipper.
  process.stderr.write(JSON.stringify({ ts: Date.now(), ...line }) + "\n");
}
