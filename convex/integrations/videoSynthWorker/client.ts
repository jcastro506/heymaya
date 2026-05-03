/**
 * videoSynthWorker — HTTP client for the Fly worker that runs multimodal
 * creator-picture synthesis through Gemini's Files API.
 *
 * Wave 4 — replaces the OpenRouter text-only embedding path for the
 * synthesis call when `USE_VIDEO_SYNTH_WORKER=true`. The OpenRouter
 * path stays wired as a fallback so the rollout isn't blocked on the worker
 * being live.
 *
 * Architecture:
 *   • The worker is a separate Fly app with `WORKER_SHARED_SECRET` matching
 *     this client's bearer. Worker URL comes from `VIDEO_SYNTH_WORKER_URL`.
 *   • This client POSTs the per-creator synthesis payload + the canonical
 *     SYNTH_SYSTEM_PROMPT to `${VIDEO_SYNTH_WORKER_URL}/synthesize` and
 *     returns the raw model output for the caller to parse + validate.
 *   • Cross-tenant safety: this module DOES NOT re-resolve the creator. The
 *     calling action MUST have done that already (verified in
 *     synthesizeCreatorPicture.ts where it reads creatorId from the deploy
 *     session — never user input).
 *
 * Test seam: `_setVideoSynthClientForTests(fn)` injects a mock for tests
 * (mirrors the OpenRouter / Composio / Stripe / Fly client patterns).
 */

export class VideoSynthWorkerError extends Error {
  constructor(
    message: string,
    public readonly stage:
      | "config"
      | "network"
      | "auth"
      | "bad-response"
      | "worker-error",
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "VideoSynthWorkerError";
  }
}

export interface SynthesizeWorkerPost {
  postId: string;
  platform: string;
  videoUrl: string;
  kind: "video" | "text-context";
}

export interface SynthesizeWorkerRequest {
  creatorId: string;
  systemPrompt: string;
  userPayloadJson: string;
  posts: SynthesizeWorkerPost[];
  thinkingBudget: "none" | "low" | "medium" | "high";
  retryReminder?: string;
}

export interface SynthesizeWorkerResponse {
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
    skippedVideos: Array<{
      postId: string;
      platform: string;
      reason: string;
      stage: "download" | "upload";
    }>;
    totalElapsedMs: number;
    downloadElapsedMs: number;
    uploadElapsedMs: number;
    geminiElapsedMs: number;
  };
}

export interface SynthesizeWorkerOptions {
  /** Override the worker URL. Default reads VIDEO_SYNTH_WORKER_URL. */
  workerUrl?: string;
  /** Override the bearer secret. Default reads WORKER_SHARED_SECRET. */
  sharedSecret?: string;
  /** Per-call timeout (ms). Default 6 min (worker's own budget is 5 min). */
  timeoutMs?: number;
  /** Test seam — overrides global fetch. */
  fetchImpl?: typeof fetch;
}

export type SynthesizeWorkerImpl = (
  req: SynthesizeWorkerRequest,
  opts?: SynthesizeWorkerOptions
) => Promise<SynthesizeWorkerResponse>;

const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000;

let __injectedClient: SynthesizeWorkerImpl | null = null;

/**
 * Test seam — swap the worker call. `null` resets to the production HTTP
 * implementation. Always reset in `afterEach` so injected mocks don't leak
 * between tests.
 */
export function _setVideoSynthClientForTests(
  impl: SynthesizeWorkerImpl | null
): void {
  __injectedClient = impl;
}

/**
 * Public entry — synthesizeCreatorPicture.ts calls this when the feature
 * flag is on. Returns the parsed worker response or throws
 * VideoSynthWorkerError.
 */
export async function synthesizeViaWorker(
  req: SynthesizeWorkerRequest,
  opts: SynthesizeWorkerOptions = {}
): Promise<SynthesizeWorkerResponse> {
  if (__injectedClient) {
    return await __injectedClient(req, opts);
  }
  return await defaultImpl(req, opts);
}

async function defaultImpl(
  req: SynthesizeWorkerRequest,
  opts: SynthesizeWorkerOptions
): Promise<SynthesizeWorkerResponse> {
  const workerUrl =
    opts.workerUrl ?? process.env.VIDEO_SYNTH_WORKER_URL ?? "";
  const sharedSecret =
    opts.sharedSecret ?? process.env.WORKER_SHARED_SECRET ?? "";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;

  if (!workerUrl) {
    throw new VideoSynthWorkerError(
      "VIDEO_SYNTH_WORKER_URL is not set in Convex env.",
      "config",
      false
    );
  }
  if (!sharedSecret) {
    throw new VideoSynthWorkerError(
      "WORKER_SHARED_SECRET is not set in Convex env.",
      "config",
      false
    );
  }

  const url = `${workerUrl.replace(/\/$/, "")}/synthesize`;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${sharedSecret}`,
      },
      body: JSON.stringify(req),
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    const message =
      err instanceof Error ? err.message : String(err);
    // Aborts are timeouts → retryable. Other network errors are also
    // retryable (transient DNS, transient TLS, Fly auto-stop wake races).
    throw new VideoSynthWorkerError(
      `network error calling video-synth worker: ${message}`,
      "network",
      true,
      undefined,
      err
    );
  }
  clearTimeout(timeoutHandle);

  if (response.status === 401) {
    throw new VideoSynthWorkerError(
      "video-synth worker rejected our bearer (check WORKER_SHARED_SECRET match)",
      "auth",
      false,
      401
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (err) {
    throw new VideoSynthWorkerError(
      `worker returned non-JSON body (status ${response.status})`,
      "bad-response",
      response.status >= 500,
      response.status,
      err
    );
  }

  if (response.status >= 500) {
    const detail = extractErrorDetail(parsed) ?? `HTTP ${response.status}`;
    throw new VideoSynthWorkerError(
      `worker upstream error: ${detail}`,
      "worker-error",
      true,
      response.status
    );
  }

  if (!isOkResponse(parsed)) {
    const detail = extractErrorDetail(parsed) ?? "unknown";
    throw new VideoSynthWorkerError(
      `worker returned ok:false — ${detail}`,
      "worker-error",
      response.status === 502 || response.status === 503,
      response.status
    );
  }

  return parsed as SynthesizeWorkerResponse;
}

function isOkResponse(value: unknown): value is SynthesizeWorkerResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.ok !== true) return false;
  if (typeof v.content !== "string") return false;
  if (typeof v.model !== "string") return false;
  if (!v.usage || typeof v.usage !== "object") return false;
  if (!v.diagnostics || typeof v.diagnostics !== "object") return false;
  return true;
}

function extractErrorDetail(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.error && typeof v.error === "object") {
    const err = v.error as Record<string, unknown>;
    if (typeof err.detail === "string") return err.detail;
    if (typeof err.code === "string") return err.code;
  }
  return null;
}

/**
 * Determines whether the client should be used for this synthesis call.
 * Reads `USE_VIDEO_SYNTH_WORKER` from Convex env. Returns true when the
 * value is `"true"` / `"1"` / `"yes"` (case-insensitive). Anything else
 * (including unset) falls back to the OpenRouter path.
 *
 * Centralized here so the synthesis call site stays a one-liner.
 */
export function isVideoSynthWorkerEnabled(): boolean {
  const raw = (process.env.USE_VIDEO_SYNTH_WORKER ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}
