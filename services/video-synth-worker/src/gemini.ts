/**
 * Gemini Files API caller — uploads downloaded videos, polls until ACTIVE,
 * then makes ONE multimodal generateContent call with all video file refs +
 * the synthesis prompt + the per-creator text payload.
 *
 * Port of `MayaClaude/hey-maya/server/src/lib/video-analysis.ts` adapted for
 * HeyMaya's synthesis pipeline:
 *   • Multi-video upload (not single-video analysis)
 *   • Receives the synthesis system prompt + user payload from the Convex
 *     caller (so the canonical prompt lives in
 *     `convex/onboarding/maya/synthesizeCreatorPicture.ts::SYNTH_SYSTEM_PROMPT`
 *     and the worker is a dumb pipe — see services README).
 *   • HIGH thinking budget (Gemini reasoning effort) configurable per call
 *     since synthesis bypasses plan-tier clamps for everyone.
 *
 * The SDK's File state polling is preserved verbatim from the reference
 * pattern — Gemini's Files API needs ACTIVE state before generateContent can
 * reference the URI; PROCESSING uploads silently fail with a 400 if used.
 *
 * Error model:
 *   • `GeminiError` is throwable — synthesize.ts catches and converts to a
 *     structured response.
 */

import {
  GoogleGenAI,
  FileState,
  type File as GeminiFile,
  type Part,
} from "@google/genai";

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly stage:
      | "client-init"
      | "upload"
      | "polling"
      | "processing-failed"
      | "generate-content"
      | "empty-response",
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export interface GeminiClientOptions {
  apiKey?: string;
  model?: string;
  /** Per-file polling timeout in ms. Default 30s. */
  pollingTimeoutMs?: number;
  /** Per-file polling interval in ms. Default 2s. */
  pollingIntervalMs?: number;
  /** generateContent total wall-clock budget. Default 120s. */
  generateTimeoutMs?: number;
  /** Test seam — inject a fake genai-like object for unit tests. */
  clientImpl?: unknown;
}

export interface UploadedVideoRef {
  /** The platform postId from the request — round-tripped for diagnostics. */
  postId: string;
  platform: string;
  /** Gemini Files API URI (e.g. "files/abc123"). */
  fileUri: string;
  mimeType: string;
}

const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_POLLING_TIMEOUT_MS = 30_000;
const DEFAULT_POLLING_INTERVAL_MS = 2_000;
const DEFAULT_GENERATE_TIMEOUT_MS = 120_000;

/**
 * Upload one video file and wait for it to be ACTIVE. Throws GeminiError on
 * any failure. The worker treats upload failure as text-only-fallback —
 * `synthesize.ts` decides the policy.
 */
export async function uploadAndWaitActive(
  client: GoogleGenAI,
  filePath: string,
  context: { postId: string; platform: string },
  opts: Pick<GeminiClientOptions, "pollingTimeoutMs" | "pollingIntervalMs"> = {}
): Promise<UploadedVideoRef> {
  const pollingTimeoutMs = opts.pollingTimeoutMs ?? DEFAULT_POLLING_TIMEOUT_MS;
  const pollingIntervalMs = opts.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS;

  let uploaded: GeminiFile;
  try {
    uploaded = await client.files.upload({
      file: filePath,
      config: { mimeType: "video/mp4" },
    });
  } catch (err) {
    throw new GeminiError(
      `upload failed for ${context.platform}/${context.postId}`,
      "upload",
      err
    );
  }

  if (!uploaded.name || !uploaded.uri) {
    throw new GeminiError(
      `upload returned no name/uri for ${context.platform}/${context.postId}`,
      "upload"
    );
  }

  // Poll until ACTIVE or timeout. The SDK returns the file with a state
  // (PROCESSING / ACTIVE / FAILED) and we have to wait through PROCESSING
  // before we can reference the file in a generateContent call.
  let state: FileState | undefined = uploaded.state;
  const deadline = Date.now() + pollingTimeoutMs;
  while (state === FileState.PROCESSING && Date.now() < deadline) {
    await sleep(pollingIntervalMs);
    try {
      const info = await client.files.get({ name: uploaded.name });
      state = info.state;
    } catch (err) {
      throw new GeminiError(
        `polling failed for ${context.platform}/${context.postId}`,
        "polling",
        err
      );
    }
  }

  if (state !== FileState.ACTIVE) {
    throw new GeminiError(
      `file ${context.platform}/${context.postId} did not become ACTIVE (final state: ${String(state)})`,
      "processing-failed"
    );
  }

  return {
    postId: context.postId,
    platform: context.platform,
    fileUri: uploaded.uri,
    mimeType: "video/mp4",
  };
}

/**
 * Build the multimodal `parts[]` array for a single user-role content block:
 * one `fileData` part per uploaded video, then one `text` part with the JSON
 * payload (which already encodes the per-platform posts + creator metadata).
 *
 * The synthesis system prompt is attached as a system-role message in
 * `callGeminiSynthesis` below.
 */
export function buildMultimodalParts(
  uploaded: ReadonlyArray<UploadedVideoRef>,
  userPayloadJson: string
): Part[] {
  const parts: Part[] = uploaded.map((u) => ({
    fileData: {
      fileUri: u.fileUri,
      mimeType: u.mimeType,
    },
  }));
  parts.push({ text: userPayloadJson });
  return parts;
}

export interface GeminiCallResult {
  /** Raw model text — the caller (synthesize.ts) returns it verbatim to Convex. */
  content: string;
  /** Approximate input + output token counts when the SDK exposes them. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    /** Reasoning / thinking tokens, when surfaced by the model. */
    thinkingTokens: number;
  };
  model: string;
}

export interface SynthesisCallInput {
  systemPrompt: string;
  userPayloadJson: string;
  /**
   * Optional retry reminder — appended as an extra system-role message,
   * mirroring the OpenRouter retry path's behavior.
   */
  retryReminder?: string;
  uploadedVideos: ReadonlyArray<UploadedVideoRef>;
  thinkingBudget: "none" | "low" | "medium" | "high";
}

/**
 * One generateContent call. Returns the model's raw text + usage. Throws
 * GeminiError on transport / empty-response failures.
 */
export async function callGeminiSynthesis(
  client: GoogleGenAI,
  input: SynthesisCallInput,
  opts: Pick<GeminiClientOptions, "model" | "generateTimeoutMs"> = {}
): Promise<GeminiCallResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const generateTimeoutMs = opts.generateTimeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS;

  const userParts = buildMultimodalParts(
    input.uploadedVideos,
    input.userPayloadJson
  );

  // The Gemini SDK accepts contents as an array of role-tagged Content
  // objects. We build:
  //   • system → the synthesis prompt (+ optional retry reminder)
  //   • user   → fileData parts + the user payload JSON text
  // The role tag is significant — Gemini honors system-role separately from
  // user-role (system instructions stick across the whole call).
  const systemContent = input.retryReminder
    ? `${input.systemPrompt}\n\n${input.retryReminder}`
    : input.systemPrompt;

  // Convert thinking budget → Gemini's thinking config. The SDK exposes this
  // via `config.thinkingConfig.thinkingBudget` (a token count). HIGH is the
  // unbounded default in the synthesis path; map the public 4-level enum to
  // a numeric token cap so we can clamp Starter creators predictably IF/WHEN
  // we ever stop bypassing the clamp here.
  const thinkingBudgetTokens = thinkingBudgetToTokens(input.thinkingBudget);

  let response;
  try {
    response = await withTimeout(
      client.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: userParts,
          },
        ],
        config: {
          systemInstruction: systemContent,
          temperature: 0.3,
          // Gemini caps responseModalities to TEXT for synthesis (we want
          // structured JSON back, not audio/video).
          responseModalities: ["TEXT"],
          // Sprint 10: the new @google/genai ThinkingConfig type exposes
          // includeThoughts only; the per-call thinking budget is controlled
          // by the model's default budget (Gemini 2.5+ has built-in thinking,
          // Gemini 3 Flash Preview keeps thinking always-on for synthesis).
          // We pass includeThoughts:true so the usage report includes
          // thinkingTokens for accounting.
          thinkingConfig:
            thinkingBudgetTokens === null
              ? undefined
              : { includeThoughts: true },
        },
      }),
      generateTimeoutMs,
      "generate-content timeout"
    );
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    throw new GeminiError(
      `generateContent failed: ${err instanceof Error ? err.message : String(err)}`,
      "generate-content",
      err
    );
  }

  const text =
    typeof response.text === "string"
      ? response.text.trim()
      : extractTextFromResponse(response);

  if (!text) {
    throw new GeminiError("Gemini returned empty text", "empty-response");
  }

  // Usage shape varies per SDK version. Be defensive.
  const usage = (response as { usageMetadata?: Record<string, number> })
    .usageMetadata ?? {};
  const inputTokens =
    typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : 0;
  const outputTokens =
    typeof usage.candidatesTokenCount === "number"
      ? usage.candidatesTokenCount
      : 0;
  const thinkingTokens =
    typeof usage.thoughtsTokenCount === "number" ? usage.thoughtsTokenCount : 0;

  return {
    content: text,
    usage: { inputTokens, outputTokens, thinkingTokens },
    model,
  };
}

/**
 * Best-effort text extraction when `response.text` is undefined (some SDK
 * versions surface text via `candidates[0].content.parts[*].text`).
 */
function extractTextFromResponse(resp: unknown): string {
  if (!resp || typeof resp !== "object") return "";
  const candidates = (resp as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

function thinkingBudgetToTokens(
  budget: "none" | "low" | "medium" | "high"
): number | null {
  switch (budget) {
    case "none":
      return 0;
    case "low":
      return 2_000;
    case "medium":
      return 8_000;
    case "high":
      // null == let Gemini pick its own ceiling (effectively unbounded for
      // this account tier).
      return null;
  }
}

/**
 * Race a promise against a wall-clock deadline. Throws GeminiError on
 * timeout. Used so a misbehaving Gemini call can't pin the worker forever.
 */
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  reason: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutP = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new GeminiError(`${reason} after ${ms}ms`, "generate-content"));
    }, ms);
  });
  try {
    return await Promise.race([p, timeoutP]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a default Gemini client. Production wiring; tests inject their own.
 */
export function buildGeminiClient(opts: GeminiClientOptions = {}): GoogleGenAI {
  const apiKey = opts.apiKey ?? process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    throw new GeminiError(
      "GOOGLE_GENAI_API_KEY is not set",
      "client-init"
    );
  }
  return new GoogleGenAI({ apiKey });
}
