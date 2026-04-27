/**
 * photoBridgeWorker — HTTP client for the Fly worker that converts HEIC →
 * JPEG (and trans-codes other inbound formats to safe canonical forms).
 *
 * **PARKED — pending re-scope per operator 2026-04-27.** OpenClaw may
 * handle iMessage attachments (incl. HEIC) natively via its channel-pairing
 * adapter; the BlueBubbles + R2-bridge mitigation in R3 § 2 may have been
 * over-engineered for bugs that are already fixed in pinned versions. Until
 * the next agent validates current OpenClaw docs against this assumption,
 * this client is unwired — `convertHeicToJpeg` is callable but no Convex
 * code path invokes it. Keep as a known-good shim if we end up needing it;
 * delete if OpenClaw native handling covers the case.
 *
 * Why a separate worker?
 *   - `sharp` (and the older `imagemagick` CLI) cannot run in Convex's Node
 *     runtime — neither the native binary nor the WASM polyfill are bundled,
 *     and shipping them would balloon the deploy artifact past Convex's
 *     limit. Mirrors the Wave-4 video-synth-worker pattern: heavy media ops
 *     live in a thin Fly app; Convex calls it via signed HTTP.
 *   - HEIC (Apple's default for iPhone photos since iOS 11) is the dominant
 *     inbound format from BlueBubbles — R3 § 2 documents OpenClaw issue
 *     #17670 ("HEIC images not delivered to agent context"). Converting in
 *     the bridge sidesteps the bug for downstream cataloger + Gemini Files
 *     API consumption (Gemini also prefers JPEG/PNG over HEIC).
 *
 * Auth
 * ----
 * Bearer `WORKER_SHARED_SECRET` (same env var as the video-synth-worker —
 * one secret across all our Fly workers). Worker URL via
 * `PHOTO_BRIDGE_WORKER_URL`. If either is missing, calls fail with
 * `PhotoBridgeWorkerError({stage: "config"})`.
 *
 * Failure mode
 * ------------
 * If the worker is unreachable / errors out, the bridge falls back to
 * uploading the original HEIC bytes anyway (`fallback: "original"`) and
 * surfaces a flag on the mediaAssets row so the cataloger can attempt
 * direct HEIC analysis. Never lose the file is the contract.
 */

export class PhotoBridgeWorkerError extends Error {
  constructor(
    message: string,
    public readonly stage:
      | "config"
      | "network"
      | "auth"
      | "bad-response"
      | "worker-error",
    public readonly retryable: boolean,
    public readonly status?: number
  ) {
    super(message);
    this.name = "PhotoBridgeWorkerError";
  }
}

export interface ConvertHeicRequest {
  /** Base64-encoded HEIC bytes. Worker decodes + converts. */
  heicBase64: string;
  /** Sniffed mime from the inbound bridge — included for worker telemetry. */
  sourceMime: string;
}

export interface ConvertHeicResponse {
  /** Base64-encoded JPEG bytes. */
  jpegBase64: string;
  outputMime: "image/jpeg";
  inputBytes: number;
  outputBytes: number;
}

export interface PhotoBridgeWorkerOptions {
  workerUrl?: string;
  sharedSecret?: string;
  /** Per-call timeout (ms). Default 20s. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type PhotoBridgeWorkerImpl = (
  req: ConvertHeicRequest,
  opts?: PhotoBridgeWorkerOptions
) => Promise<ConvertHeicResponse>;

const DEFAULT_TIMEOUT_MS = 20_000;

let __injectedClient: PhotoBridgeWorkerImpl | null = null;

/** Test seam — swap the worker call. Always reset in `afterEach`. */
export function _setPhotoBridgeWorkerForTests(
  impl: PhotoBridgeWorkerImpl | null
): void {
  __injectedClient = impl;
}

/**
 * Public entry — photoBridge bridgeInbound.ts calls this when sniffed mime
 * is HEIC/HEIF. Returns the converted JPEG or throws PhotoBridgeWorkerError.
 */
export async function convertHeicToJpeg(
  req: ConvertHeicRequest,
  opts: PhotoBridgeWorkerOptions = {}
): Promise<ConvertHeicResponse> {
  if (__injectedClient) return await __injectedClient(req, opts);
  return await defaultImpl(req, opts);
}

async function defaultImpl(
  req: ConvertHeicRequest,
  opts: PhotoBridgeWorkerOptions
): Promise<ConvertHeicResponse> {
  const workerUrl =
    opts.workerUrl ?? process.env.PHOTO_BRIDGE_WORKER_URL ?? "";
  const sharedSecret =
    opts.sharedSecret ?? process.env.WORKER_SHARED_SECRET ?? "";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);

  if (!workerUrl) {
    throw new PhotoBridgeWorkerError(
      "PHOTO_BRIDGE_WORKER_URL is not set in Convex env.",
      "config",
      false
    );
  }
  if (!sharedSecret) {
    throw new PhotoBridgeWorkerError(
      "WORKER_SHARED_SECRET is not set in Convex env.",
      "config",
      false
    );
  }

  const url = `${workerUrl.replace(/\/$/, "")}/convert/heic`;
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
    const message = err instanceof Error ? err.message : String(err);
    throw new PhotoBridgeWorkerError(
      `network error calling photo-bridge worker: ${message}`,
      "network",
      true
    );
  }
  clearTimeout(timeoutHandle);

  if (response.status === 401) {
    throw new PhotoBridgeWorkerError(
      "photo-bridge worker rejected our bearer (check WORKER_SHARED_SECRET match)",
      "auth",
      false,
      401
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new PhotoBridgeWorkerError(
      `worker returned non-JSON body (status ${response.status})`,
      "bad-response",
      response.status >= 500,
      response.status
    );
  }

  if (response.status >= 500) {
    throw new PhotoBridgeWorkerError(
      `worker upstream error: ${response.status}`,
      "worker-error",
      true,
      response.status
    );
  }

  if (!isOkResponse(parsed)) {
    throw new PhotoBridgeWorkerError(
      `worker returned ok:false`,
      "worker-error",
      response.status >= 500,
      response.status
    );
  }

  return parsed as ConvertHeicResponse;
}

function isOkResponse(value: unknown): value is ConvertHeicResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.jpegBase64 !== "string") return false;
  if (v.outputMime !== "image/jpeg") return false;
  if (typeof v.inputBytes !== "number") return false;
  if (typeof v.outputBytes !== "number") return false;
  return true;
}
