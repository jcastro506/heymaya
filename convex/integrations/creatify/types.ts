/**
 * Creatify request/response types + status helpers.
 *
 * Creatify's create endpoints return a job object immediately with a `status`;
 * the finished video appears at `video_output` once `status` reaches a terminal
 * "done". We model status permissively (it's a free-form string across the
 * lifecycle: pending / in_queue / running / rendering / done / failed / error)
 * and expose helpers so the orchestration layer never hardcodes magic strings.
 */

/** Vertical-first aspect ratios Creatify accepts (we only ever use 9x16 in V1). */
export type CreatifyAspectRatio = "9x16" | "16x9" | "1x1";

/**
 * A create/poll job result, shared in shape across ads_clone / aurora /
 * link_to_videos / product_to_video. Only `id` + `status` are guaranteed on
 * create; `video_output` + `credits_used` populate as it progresses.
 */
export interface CreatifyJob {
  id: string;
  status: string;
  /** Finished video URL — present once status is terminal-done. */
  video_output?: string | null;
  /** Render progress 0..1 or 0..100 depending on endpoint; advisory only. */
  progress?: number | null;
  /** Credits consumed by this job — the real COGS signal. */
  credits_used?: number | null;
  /** Populated on failure. */
  failed_reason?: string | null;
  [key: string]: unknown;
}

/** A Creatify "Link" — the product scrape used as input to link_to_videos / ads_clone. */
export interface CreatifyLink {
  id: string;
  url?: string | null;
  title?: string | null;
  description?: string | null;
  image_urls?: string[] | null;
  [key: string]: unknown;
}

/** AI-script generation result (writeOnly url/title/description in, script out). */
export interface CreatifyScript {
  id: string;
  script?: string | null;
  [key: string]: unknown;
}

const DONE_RE = /^(done|completed|complete|success|succeeded|ready|finished)$/i;
const FAILED_RE = /^(failed|error|errored|cancelled|canceled|rejected)$/i;

export function isDoneStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && DONE_RE.test(status.trim());
}

export function isFailedStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && FAILED_RE.test(status.trim());
}

/** Terminal = no more polling needed (either done or failed). */
export function isTerminalStatus(status: string | null | undefined): boolean {
  return isDoneStatus(status) || isFailedStatus(status);
}

/**
 * The production video modes we expose to Maya (vendor-neutral capability names).
 * NOTE: `product_video` is intentionally NOT here yet — Product Video is a
 * separate two-step endpoint (`/api/product_to_videos/` gen_image→gen_video)
 * with its own status enum, added in Phase 2. Don't route it through the
 * single-create poller below.
 */
export type CreatifyVideoMode =
  | "ad_clone" // copy a winning reference video's format onto the product
  | "url_to_video" // scrape the product URL → fully edited ad
  | "aurora"; // ultra-realistic talking head from one photo + audio

/** Inputs for an ad-clone job (the differentiator: copy a winning TikTok). */
export interface AdCloneInput {
  /** UUID of a pre-created Link (must contain ≥1 product image). */
  link: string;
  /** URL of the reference ad video to copy structure/pacing/style from. */
  video_url: string;
  aspect_ratio?: CreatifyAspectRatio;
  /** ISO language code; null/omitted → keep the reference's original language. */
  language?: string | null;
  webhook_url?: string | null;
}

/** `model_version` selects the render engine / realism tier on link_to_videos + lipsyncs. */
export type CreatifyModelVersion = "standard" | "aurora_v1" | "aurora_v1_fast";

/** Inputs for a URL→video job (Creatify writes the script + assembles the edit). */
export interface LinkToVideoInput {
  link: string;
  aspect_ratio?: CreatifyAspectRatio;
  /** {15,30,45,60} seconds; default 15. */
  video_length?: 15 | 30 | 45 | 60;
  /** Optional override script (HYBRID mode: Maya writes the grounded script). Omit → Creatify auto-writes. */
  override_script?: string | null;
  /** Named ScriptStyleEnum / VisualStyle template; Creatify defaults if omitted. */
  script_style?: string | null;
  visual_style?: string | null;
  /** Realism tier: standard (5cr/30s) | aurora_v1 (1cr/s) | aurora_v1_fast (0.5cr/s). */
  model_version?: CreatifyModelVersion;
  /** A persona id (from /api/personas/) and accent id (from /api/voices/) to pin the creator. */
  override_avatar?: string | null;
  override_voice?: string | null;
  target_platform?: string | null;
  target_audience?: string | null;
  language?: string | null;
  webhook_url?: string | null;
}

/** Inputs for AI-script generation (URL or title+description). */
export interface AiScriptInput {
  url?: string | null;
  title?: string | null;
  description?: string | null;
}
