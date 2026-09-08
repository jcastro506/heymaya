/**
 * Image generation through OpenRouter's unified image API (Sprint 4g, 2026-09-08).
 *
 * The vendor call and nothing else. One image per request: the model returns it as a
 * data URL on `message.images[]` (the shape OpenRouter documents for image output), and
 * this hands back bytes. Reference photos go in as `image_url` parts of the same user
 * turn, so the model can match a creator's own light and setting.
 *
 * Never throws: every failure is a named reason, because the caller is a Convex action
 * fanning out several of these at once, and one rejected promise would drop the frames
 * that did come back.
 */

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Nano Banana 2 (Gemini 3.1 Flash Image); the older Flash Image as the fallback. Overridable per environment. */
export const IMAGE_MODEL = process.env.MODEL_IMAGE ?? "google/gemini-3.1-flash-image";
export const IMAGE_MODEL_FALLBACK = process.env.MODEL_IMAGE_FALLBACK ?? "google/gemini-2.5-flash-image";
/** An image takes five to twenty seconds; a hung request must not hold a render job open forever. */
export const IMAGE_TIMEOUT_MS = 60_000;

export interface GenerateImageInput {
  model: string;
  prompt: string;
  /** Photos to match (light, palette, setting), never to copy. */
  references?: Array<{ bytes: ArrayBuffer; mimeType: string }>;
  aspectRatio?: "9:16" | "1:1" | "16:9";
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type GenerateImageResult =
  | { ok: true; bytes: ArrayBuffer; mimeType: string; costUsd?: number; model: string }
  | { ok: false; reason: string };

/** ArrayBuffer → base64 without Buffer (the Convex runtime has btoa, not Node's Buffer). */
export function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** A data URL → bytes and mime, or null when it is not one. */
export function dataUrlToBytes(url: string): { bytes: ArrayBuffer; mimeType: string } | null {
  const m = url.match(/^data:([\w/+.-]+);base64,([\s\S]+)$/);
  if (!m) return null;
  try {
    const binary = atob(m[2]);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return { bytes: out.buffer, mimeType: m[1] };
  } catch {
    return null;
  }
}

/** The request body, pure, so a test can assert on it without a network. */
export function imageRequestBody(input: Pick<GenerateImageInput, "model" | "prompt" | "references" | "aspectRatio">): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
  for (const r of input.references ?? []) content.push({ type: "image_url", image_url: { url: `data:${r.mimeType};base64,${bytesToBase64(r.bytes)}` } });
  return {
    model: input.model,
    messages: [{ role: "user", content }],
    modalities: ["image", "text"],
    image_config: { aspect_ratio: input.aspectRatio ?? "9:16" },
    usage: { include: true },
  };
}

/** Where the image is in the response: `message.images[].image_url.url`, or an image part in `content`. Pure. */
export function parseImageResponse(json: unknown): { ok: true; dataUrl: string; costUsd?: number } | { ok: false; reason: string } {
  const root = json as { error?: { message?: string }; choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string }; imageUrl?: { url?: string } }>; content?: unknown } }>; usage?: { cost?: number } } | null;
  if (!root || typeof root !== "object") return { ok: false, reason: "image response was not JSON" };
  if (root.error?.message) return { ok: false, reason: `image model refused: ${root.error.message.slice(0, 200)}` };
  const message = root.choices?.[0]?.message;
  const fromImages = message?.images?.map((i) => i.image_url?.url ?? i.imageUrl?.url).find((u): u is string => typeof u === "string" && u.startsWith("data:"));
  const parts = Array.isArray(message?.content) ? (message!.content as Array<{ type?: string; image_url?: { url?: string } }>) : [];
  const fromParts = parts.map((p) => p.image_url?.url).find((u): u is string => typeof u === "string" && u.startsWith("data:"));
  const dataUrl = fromImages ?? fromParts;
  if (!dataUrl) return { ok: false, reason: "the image model answered with no image" };
  const cost = typeof root.usage?.cost === "number" ? root.usage.cost : undefined;
  return { ok: true, dataUrl, costUsd: cost };
}

/** A 1×1 PNG, for MODEL_FAKE=1: the pipeline runs end to end in tests with no network and no spend. */
const FAKE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  if (process.env.MODEL_FAKE === "1") {
    if (process.env.FRAMES_FAKE_FAIL === "1") return { ok: false, reason: "fake image failure" };
    const fake = dataUrlToBytes(`data:image/png;base64,${FAKE_PNG}`)!;
    return { ok: true, bytes: fake.bytes, mimeType: fake.mimeType, costUsd: 0, model: input.model };
  }
  if (!input.apiKey) return { ok: false, reason: "no OpenRouter API key" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? IMAGE_TIMEOUT_MS);
  try {
    const res = await (input.fetchImpl ?? fetch)(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify(imageRequestBody(input)),
      signal: controller.signal,
    });
    const raw = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(raw); } catch { json = null; }
    if (!res.ok) {
      const detail = (json as { error?: { message?: string } } | null)?.error?.message ?? raw.slice(0, 200);
      return { ok: false, reason: `image model HTTP ${res.status}: ${detail}` };
    }
    const parsed = parseImageResponse(json);
    if (!parsed.ok) return parsed;
    const bytes = dataUrlToBytes(parsed.dataUrl);
    if (!bytes) return { ok: false, reason: "the image came back in a shape I could not decode" };
    return { ok: true, bytes: bytes.bytes, mimeType: bytes.mimeType, costUsd: parsed.costUsd, model: input.model };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: /abort/i.test(msg) ? `image model timed out after ${input.timeoutMs ?? IMAGE_TIMEOUT_MS}ms` : `image call failed: ${msg.slice(0, 200)}` };
  } finally {
    clearTimeout(timer);
  }
}
