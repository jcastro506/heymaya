/**
 * Gemini, direct (plan §12.3). Video and images go to Google as bytes, never
 * through OpenRouter. One post per call. Inline under the request ceiling; above it
 * the Files API is the next step (not tonight), so oversize returns a named failure
 * and the caller degrades the card to transcript depth.
 *
 * Cost: Gemini reports token usage, not dollars, so USD comes from the price table
 * below and the row is marked `endpoint_table` (§16.4).
 */

export const INLINE_MAX_BYTES = 19 * 1024 * 1024; // the request ceiling is ~20 MB after base64 inflation is accounted for by Google

/** $/1M tokens, verified 2026-09-01 via trackers; re-verify on the official page. */
export const GEMINI_PRICES: Record<string, { inPerM: number; outPerM: number }> = {
  "gemini-3.1-flash-lite": { inPerM: 0.25, outPerM: 1.5 },
  "gemini-3-flash-preview": { inPerM: 0.5, outPerM: 3.0 },
  "gemini-3.5-flash": { inPerM: 1.5, outPerM: 9.0 },
  "gemini-3.6-flash": { inPerM: 0.75, outPerM: 3.75 },
  "gemini-3.7-flash": { inPerM: 0.75, outPerM: 3.75 },
  "gemini-2.5-flash-lite": { inPerM: 0.1, outPerM: 0.4 },
};

export interface WatchInput {
  model: string;
  apiKey: string;
  prompt: string;
  media: { bytes: ArrayBuffer; mimeType: string } | { fileUri: string; mimeType: string };
  /** Low resolution for backfill volume; default for the sampled watches (§12.3). */
  resolution?: "low" | "default";
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
  /** Give up after this long. Without it a hung call held the action to Convex's 10-minute limit and the creator heard nothing. */
  timeoutMs?: number;
}

/** A watch that has not answered in this long is not going to: the caller says so and moves on. */
export const WATCH_TIMEOUT_MS = 150_000;

export type WatchResult =
  | { ok: true; text: string; usage: { promptTokens: number; outputTokens: number; costUsd: number } }
  | { ok: false; reason: string; usage?: { promptTokens: number; outputTokens: number; costUsd: number } };

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function priceUsd(model: string, promptTokens: number, outputTokens: number): number {
  const p = GEMINI_PRICES[model] ?? GEMINI_PRICES["gemini-3.7-flash"];
  return (promptTokens * p.inPerM + outputTokens * p.outPerM) / 1_000_000;
}

export const FILE_MAX_BYTES = 200 * 1024 * 1024; // a minute of 4K is ~350 MB; drafts over this are asked for a smaller export

/** Gemini Files API (resumable upload), then wait until the video is processed. Never throws. */
export async function uploadFile(input: { apiKey: string; bytes: ArrayBuffer; mimeType: string; fetchImpl?: typeof fetch; pollMs?: number; maxWaitMs?: number }): Promise<{ ok: true; uri: string } | { ok: false; reason: string }> {
  const f = input.fetchImpl ?? fetch;
  try {
    const start = await f(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${input.apiKey}`, {
      method: "POST",
      headers: { "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(input.bytes.byteLength), "X-Goog-Upload-Header-Content-Type": input.mimeType, "content-type": "application/json" },
      body: JSON.stringify({ file: { display_name: "draft" } }),
    });
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!start.ok || !uploadUrl) return { ok: false, reason: `upload start ${start.status}` };
    const done = await f(uploadUrl, { method: "POST", headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: input.bytes });
    const body = (await done.json()) as { file?: { name?: string; uri?: string; state?: string } };
    if (!done.ok || !body.file?.name || !body.file.uri) return { ok: false, reason: `upload ${done.status}` };
    let state = body.file.state;
    const deadline = Date.now() + (input.maxWaitMs ?? 90_000);
    while (state === "PROCESSING" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, input.pollMs ?? 2_000));
      const g = await f(`https://generativelanguage.googleapis.com/v1beta/${body.file.name}?key=${input.apiKey}`);
      state = ((await g.json()) as { state?: string }).state;
    }
    if (state !== "ACTIVE") return { ok: false, reason: `the video was still processing (${state ?? "unknown"})` };
    return { ok: true, uri: body.file.uri };
  } catch (error) {
    return { ok: false, reason: `upload failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** One generateContent call with a media part and a JSON-only answer. Never throws. */
export async function watchMedia(input: WatchInput): Promise<WatchResult> {
  const f = input.fetchImpl ?? fetch;
  // A phone video is often over the inline ceiling: upload it as a file first (up to FILE_MAX_BYTES).
  if ("bytes" in input.media && input.media.bytes.byteLength > INLINE_MAX_BYTES) {
    if (input.media.bytes.byteLength > FILE_MAX_BYTES) return { ok: false, reason: `media is ${Math.round(input.media.bytes.byteLength / 1e6)}MB, over the ${Math.round(FILE_MAX_BYTES / 1e6)}MB cap` };
    const up = await uploadFile({ apiKey: input.apiKey, bytes: input.media.bytes, mimeType: input.media.mimeType, fetchImpl: f });
    if (!up.ok) return { ok: false, reason: up.reason };
    return await watchMedia({ ...input, media: { fileUri: up.uri, mimeType: input.media.mimeType } });
  }
  const mediaPart =
    "bytes" in input.media
      ? { inlineData: { mimeType: input.media.mimeType, data: toBase64(input.media.bytes) } }
      : { fileData: { mimeType: input.media.mimeType, fileUri: input.media.fileUri } };
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    maxOutputTokens: input.maxOutputTokens ?? 1200,
    temperature: 0.2,
  };
  if (input.resolution === "low") generationConfig.mediaResolution = "MEDIA_RESOLUTION_LOW";

  let res: Response;
  try {
    res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent?key=${input.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [mediaPart, { text: input.prompt }] }], generationConfig }),
      signal: AbortSignal.timeout(input.timeoutMs ?? WATCH_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, reason: `gemini timed out after ${Math.round((input.timeoutMs ?? WATCH_TIMEOUT_MS) / 1000)}s` };
    return { ok: false, reason: `gemini unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
  let payload: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    error?: { message?: string };
  };
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    return { ok: false, reason: `gemini returned ${res.status} with a non-JSON body` };
  }
  const promptTokens = payload.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = payload.usageMetadata?.candidatesTokenCount ?? 0;
  const usage = { promptTokens, outputTokens, costUsd: priceUsd(input.model, promptTokens, outputTokens) };
  if (!res.ok) return { ok: false, reason: payload.error?.message ?? `gemini returned ${res.status}`, usage };
  const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) return { ok: false, reason: `empty completion (${payload.candidates?.[0]?.finishReason ?? "no candidate"})`, usage };
  return { ok: true, text, usage };
}

/** Fetch a media URL to bytes with a size cap; expired CDN URLs surface as a named failure. */
export async function fetchMedia(url: string, maxBytes = INLINE_MAX_BYTES, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; bytes: ArrayBuffer; mimeType: string } | { ok: false; reason: string }> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return { ok: false, reason: `media fetch ${res.status}` };
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > maxBytes) return { ok: false, reason: `media is ${Math.round(len / 1e6)}MB, over the cap` };
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > maxBytes) return { ok: false, reason: `media is ${Math.round(bytes.byteLength / 1e6)}MB, over the cap` };
    const ct = res.headers.get("content-type") ?? "";
    const mimeType = ct.startsWith("video/") || ct.startsWith("image/") ? ct.split(";")[0] : "video/mp4";
    return { ok: true, bytes, mimeType };
  } catch (error) {
    return { ok: false, reason: `media fetch failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
