/**
 * Creatify typed endpoint wrappers.
 *
 * The ONLY place (besides client.ts) that knows Creatify's URLs/paths. The
 * Convex orchestration layer calls these functions; it never builds a Creatify
 * request itself. Each wrapper takes an explicit `CreatifyClient` so actions and
 * tests can inject one.
 *
 * Confirmed live (creatify-test.ts + OpenAPI):
 *   - POST /api/links/                 { url } → { id }
 *   - PUT  /api/links/{id}/            { title, description, image_urls }
 *   - POST /api/ads_clone/             { link, video_url, aspect_ratio, language?, webhook_url? } → job
 *   - GET  /api/ads_clone/{id}/        → job
 *   - POST /api/aurora/  GET /api/aurora/{id}/
 *   - POST /api/link_to_videos/        GET /api/link_to_videos/{id}/
 *   - POST /api/ai_scripts/            { url | title+description } → { script }
 *
 * Optional create fields on link_to_videos (override_script / visual_style /
 * script_style) are best-effort from docs and should be confirmed on the first
 * live run; unset fields are simply omitted from the body.
 */

import { CreatifyClient, getDefaultClient } from "./client";
import type {
  AdCloneInput,
  AiScriptInput,
  AssetGenInput,
  CreatifyInspiration,
  CreatifyJob,
  CreatifyJobMode,
  CreatifyLink,
  CreatifyScript,
  CreatifyVideoMode,
  IabImagesInput,
  LinkToVideoInput,
} from "./types";

function assertId<T extends { id?: unknown }>(obj: T, what: string): T & { id: string } {
  if (!obj || typeof obj.id !== "string" || !obj.id) {
    throw new Error(`Creatify ${what}: response missing id — got ${JSON.stringify(obj).slice(0, 300)}`);
  }
  return obj as T & { id: string };
}

/** Drop undefined/null keys so we only send fields the caller actually set. */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

// ── Links (product scrape input) ──────────────────────────────────────────────

/** Create a Link by scraping a product URL (1 credit). */
export async function createLinkFromUrl(
  url: string,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyLink> {
  const res = await client.request<CreatifyLink>("/api/links/", {
    method: "POST",
    body: { url },
  });
  return assertId(res, "createLinkFromUrl");
}

/** Attach grounded metadata + the founder's real product screenshots to a Link. */
export async function updateLink(
  id: string,
  fields: { title?: string; description?: string; image_urls?: string[] },
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyLink> {
  const res = await client.request<CreatifyLink>(`/api/links/${id}/`, {
    method: "PUT",
    body: compact(fields),
  });
  return assertId(res, "updateLink");
}

/** One-shot Link from explicit params (title/description/images) — no scrape (1 credit). */
export async function createLinkWithParams(
  fields: { title?: string; description?: string; image_urls?: string[] },
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyLink> {
  const res = await client.request<CreatifyLink>("/api/link_with_params/", {
    method: "POST",
    body: compact(fields),
  });
  return assertId(res, "createLinkWithParams");
}

// ── Ad Clone (the differentiator: copy a winning video's format) ──────────────

export async function createAdClone(
  input: AdCloneInput,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyJob> {
  const res = await client.request<CreatifyJob>("/api/ads_clone/", {
    method: "POST",
    body: compact({
      link: input.link,
      video_url: input.video_url,
      aspect_ratio: input.aspect_ratio ?? "9x16",
      language: input.language,
      webhook_url: input.webhook_url,
    }),
  });
  return assertId(res, "createAdClone");
}

export async function getAdClone(
  id: string,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyJob> {
  return client.request<CreatifyJob>(`/api/ads_clone/${id}/`, { method: "GET" });
}

// ── URL → finished edited ad (Creatify writes the script) ─────────────────────

export async function createLinkToVideo(
  input: LinkToVideoInput,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyJob> {
  const res = await client.request<CreatifyJob>("/api/link_to_videos/", {
    method: "POST",
    body: compact({
      link: input.link,
      aspect_ratio: input.aspect_ratio ?? "9x16",
      video_length: input.video_length,
      override_script: input.override_script,
      script_style: input.script_style,
      visual_style: input.visual_style,
      model_version: input.model_version,
      override_avatar: input.override_avatar,
      override_voice: input.override_voice,
      target_platform: input.target_platform,
      target_audience: input.target_audience,
      language: input.language,
      webhook_url: input.webhook_url,
    }),
  });
  return assertId(res, "createLinkToVideo");
}

export async function getLinkToVideo(
  id: string,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyJob> {
  return client.request<CreatifyJob>(`/api/link_to_videos/${id}/`, { method: "GET" });
}

// ── Aurora (ultra-realistic talking head: one photo + audio) ──────────────────

export async function createAurora(
  body: Record<string, unknown>,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyJob> {
  const res = await client.request<CreatifyJob>("/api/aurora/", {
    method: "POST",
    body: compact(body),
  });
  return assertId(res, "createAurora");
}

export async function getAurora(
  id: string,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyJob> {
  return client.request<CreatifyJob>(`/api/aurora/${id}/`, { method: "GET" });
}

// ── AI Scripts (grounded script from URL or title+description) ────────────────

export async function generateAiScript(
  input: AiScriptInput,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyScript> {
  const res = await client.request<CreatifyScript>("/api/ai_scripts/", {
    method: "POST",
    body: compact({
      url: input.url,
      title: input.title,
      description: input.description,
    }),
  });
  return assertId(res, "generateAiScript");
}

// ── IAB Images (static ad-banner set — the Growth $149 static path) ───────────
// ⚠ UNVERIFIED LIVE — docs-derived (POST /api/iab_images/ → 2 cr → output[].url).

export async function createIabImages(
  input: IabImagesInput,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyJob> {
  const res = await client.request<CreatifyJob>("/api/iab_images/", {
    method: "POST",
    body: compact({
      link: input.link,
      image_urls: input.image_urls,
      prompt: input.prompt,
      format: input.format,
      webhook_url: input.webhook_url,
    }),
  });
  return assertId(res, "createIabImages");
}

export async function getIabImages(
  id: string,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyJob> {
  return client.request<CreatifyJob>(`/api/iab_images/${id}/`, { method: "GET" });
}

// ── Asset Generator (raw image models; schema-driven) ─────────────────────────
// ⚠ UNVERIFIED LIVE — model roster is runtime-only via the schemas endpoint.

/** Free GET of the available asset-generator models + their param schemas. */
export async function getAssetGeneratorSchemas(
  client: CreatifyClient = getDefaultClient()
): Promise<unknown> {
  return client.request<unknown>("/api/asset_generator/schemas/", { method: "GET" });
}

export async function createAssetGen(
  input: AssetGenInput,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyJob> {
  const res = await client.request<CreatifyJob>("/api/asset_generator/", {
    method: "POST",
    body: compact({
      model: input.model,
      prompt: input.prompt,
      image_urls: input.image_urls,
      webhook_url: input.webhook_url,
      ...(input.params ?? {}),
    }),
  });
  return assertId(res, "createAssetGen");
}

export async function getAssetGen(
  id: string,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyJob> {
  return client.request<CreatifyJob>(`/api/asset_generator/${id}/`, { method: "GET" });
}

// ── Inspiration (recipe/format catalog — NOT a competitor-ad feed) ────────────
// GET /api/inspirations/ is FREE (catalog). A job renders a recipe (per-recipe cost).

/** Free: fetch the recipe/format catalog. Maya reads it as a brief input. */
export async function getInspirations(
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyInspiration[]> {
  const res = await client.request<unknown>("/api/inspirations/", { method: "GET" });
  // The endpoint may return an array or a {results:[…]} envelope; normalize.
  if (Array.isArray(res)) return res as CreatifyInspiration[];
  if (res && typeof res === "object" && Array.isArray((res as { results?: unknown }).results)) {
    return (res as { results: CreatifyInspiration[] }).results;
  }
  return [];
}

export async function createInspirationJob(
  body: Record<string, unknown>,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyJob> {
  const res = await client.request<CreatifyJob>("/api/inspiration_jobs/", {
    method: "POST",
    body: compact(body),
  });
  return assertId(res, "createInspirationJob");
}

export async function getInspirationJob(
  id: string,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyJob> {
  return client.request<CreatifyJob>(`/api/inspiration_jobs/${id}/`, { method: "GET" });
}

// ── Unified poll router — the orchestration layer calls this from the scheduler ─

/**
 * Poll the right GET endpoint for a given job mode (video OR static image).
 * Video and image jobs share the async {id,status}→poll shape, so the durable
 * poll loop routes both through here off the persisted `CreatifyJobMode`.
 */
export async function getCreatifyJob(
  mode: CreatifyJobMode,
  id: string,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyJob> {
  switch (mode) {
    case "ad_clone":
      return getAdClone(id, client);
    case "url_to_video":
      return getLinkToVideo(id, client);
    case "aurora":
      return getAurora(id, client);
    case "iab_images":
      return getIabImages(id, client);
    case "asset_gen":
      return getAssetGen(id, client);
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Creatify getCreatifyJob: unknown mode ${String(_exhaustive)}`);
    }
  }
}

/** Back-compat alias — video-only callers. Delegates to {@link getCreatifyJob}. */
export async function getVideoJob(
  mode: CreatifyVideoMode,
  id: string,
  client: CreatifyClient = getDefaultClient()
): Promise<CreatifyJob> {
  return getCreatifyJob(mode, id, client);
}
