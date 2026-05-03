/**
 * maya-service-asset-cataloger — multimodal one-time catalog of inbound media.
 *
 * Per § 3 routing matrix: Gemini 3 Flash, MEDIUM thinking. Multimodal vision.
 * The skill:
 *
 *   1. Hash-dedupes the asset bytes (sha-256). If the orchestrator passes a
 *      pre-existing catalog for the same hash, the skill no-ops and returns
 *      it. (Idempotency — same bytes = $0 op.)
 *   2. Validates mime type + size. Oversized video / unsupported mime → reject
 *      with operator-facing notice.
 *   3. Calls Gemini multimodal vision via the injected `visionCaller`.
 *   4. Parses structured catalog JSON from the model.
 *   5. Audits flags + suggested-uses against the schema enumeration to
 *      prevent garbage in the persisted catalog.
 *
 * Failure mode: if the LLM returns garbage, we return an "[uncataloged]"
 * placeholder so the orchestrator can re-queue without losing the asset.
 *
 * **Load-bearing for the photo-bridge agent.** The catalog shape returned
 * here is what `mediaAssets.catalog` persists.
 */

export type AssetSuggestedUse =
  | "gbp-post"
  | "gbp-scrollable"
  | "instagram-single"
  | "instagram-carousel"
  | "instagram-reel"
  | "facebook-carousel"
  | "tiktok-clip"
  | "before-after-pair"
  | "internal-reference-only";

export type AssetFlag =
  | "face-detected"
  | "license-plate"
  | "customer-identifying"
  | "blurry"
  | "private-document";

export interface AssetCatalogerInputs {
  assetUrl: string;
  mimeType: string;
  businessId: string;
  serviceJobId?: string;
  geminiFilesApiClient: unknown;
  /** Pre-computed sha256 hash of the bytes (orchestrator does this). */
  contentHash?: string;
  /** Asset size in bytes — orchestrator passes from R2 metadata. */
  byteSize?: number;
  /** Existing catalog for the same hash, if found. Triggers idempotent no-op. */
  existingCatalog?: AssetCatalogerOutput;
}

export interface AssetCatalogerOutput {
  catalog: {
    primarySubject: string;
    serviceCategory: string;
    visualQuality: number;
    framingNotes: string;
    suggestedUses: ReadonlyArray<AssetSuggestedUse>;
    pairableWithAssetId?: string;
    captionDraft?: string;
    catalogedAt: number;
    catalogModel: "gemini-3-flash-medium";
    catalogCostUsd: number;
  };
  flags: ReadonlyArray<AssetFlag>;
}

export interface VisionCallerInput {
  assetUrl: string;
  mimeType: string;
  prompt: { system: string; user: string };
}

export interface VisionCallerResult {
  text: string;
  costUsd: number;
}

export interface VisionCaller {
  (input: VisionCallerInput): Promise<VisionCallerResult>;
}

const SUPPORTED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const SUPPORTED_VIDEO_MIMES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
]);

const SUPPORTED_AUDIO_MIMES = new Set([
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
]);

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const VALID_USES: ReadonlySet<AssetSuggestedUse> = new Set([
  "gbp-post",
  "gbp-scrollable",
  "instagram-single",
  "instagram-carousel",
  "instagram-reel",
  "facebook-carousel",
  "tiktok-clip",
  "before-after-pair",
  "internal-reference-only",
]);

const VALID_FLAGS: ReadonlySet<AssetFlag> = new Set([
  "face-detected",
  "license-plate",
  "customer-identifying",
  "blurry",
  "private-document",
]);

function uncatalogedFallback(_inputs: AssetCatalogerInputs): AssetCatalogerOutput {
  return {
    catalog: {
      primarySubject: "[uncataloged]",
      serviceCategory: "[uncataloged]",
      visualQuality: 0,
      framingNotes: "Catalog failed; queued for retry.",
      suggestedUses: ["internal-reference-only"],
      catalogedAt: Date.now(),
      catalogModel: "gemini-3-flash-medium",
      catalogCostUsd: 0,
    },
    flags: [],
  };
}

function buildVisionPrompt(serviceJobLink: boolean): {
  system: string;
  user: string;
} {
  const system = [
    "You catalog one image, video, or audio asset for a service-business operator's content library.",
    "",
    "HARD RULES:",
    "1. Output ONLY a JSON object — no markdown fences, no preamble.",
    "2. primarySubject: short noun phrase, e.g. 'HVAC condenser unit', 'interior of clean kitchen', 'before-shot of clogged drain'.",
    "3. serviceCategory: a service-business category that matches typical service-types (HVAC / plumbing / electrical / cleaning / lawn / restoration / roofing / pest / general).",
    "4. visualQuality: number 0..1 — sharpness, lighting, framing.",
    "5. framingNotes: ≤140 chars — operator-actionable observation about what could improve.",
    "6. suggestedUses: ranked list from this exact set: gbp-post | gbp-scrollable | instagram-single | instagram-carousel | instagram-reel | facebook-carousel | tiktok-clip | before-after-pair | internal-reference-only. NEVER invent values outside this set.",
    "7. flags: from this exact set: face-detected | license-plate | customer-identifying | blurry | private-document.",
    "8. captionDraft: optional 1-sentence starter caption — operator can edit. If asset is private/blurry, omit captionDraft.",
    "",
    "JSON output schema:",
    `{"primarySubject": string, "serviceCategory": string, "visualQuality": number, "framingNotes": string, "suggestedUses": string[], "flags": string[], "captionDraft"?: string}`,
  ].join("\n");
  const user = serviceJobLink
    ? "This asset is linked to a recent CRM job — favor 'before-after-pair' if visually appropriate."
    : "No CRM-job linkage. Catalog this asset on its own merits.";
  return { system, user };
}

interface RawCatalog {
  primarySubject?: string;
  serviceCategory?: string;
  visualQuality?: number;
  framingNotes?: string;
  suggestedUses?: string[];
  flags?: string[];
  captionDraft?: string;
}

function parseCatalogOutput(raw: string): RawCatalog {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("asset-cataloger: LLM returned non-JSON");
    parsed = JSON.parse(m[0]);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("asset-cataloger: invalid JSON shape");
  }
  return parsed as RawCatalog;
}

function isSupportedMime(mime: string): boolean {
  return (
    SUPPORTED_IMAGE_MIMES.has(mime) ||
    SUPPORTED_VIDEO_MIMES.has(mime) ||
    SUPPORTED_AUDIO_MIMES.has(mime)
  );
}

export class AssetCatalogerRejectError extends Error {
  constructor(public readonly reason: string) {
    super(`asset-cataloger: ${reason}`);
    this.name = "AssetCatalogerRejectError";
  }
}

export async function catalogAsset(
  inputs: AssetCatalogerInputs,
  visionCaller: VisionCaller
): Promise<AssetCatalogerOutput> {
  // Idempotency: orchestrator pre-fetches existing catalog by contentHash.
  if (inputs.existingCatalog) {
    return inputs.existingCatalog;
  }

  // Mime + size gates.
  if (!isSupportedMime(inputs.mimeType)) {
    throw new AssetCatalogerRejectError(
      `unsupported mime '${inputs.mimeType}' — operator notified`
    );
  }
  if (
    SUPPORTED_VIDEO_MIMES.has(inputs.mimeType) &&
    inputs.byteSize !== undefined &&
    inputs.byteSize > MAX_VIDEO_BYTES
  ) {
    throw new AssetCatalogerRejectError(
      `video exceeds ${MAX_VIDEO_BYTES / (1024 * 1024)}MB cap — operator notified`
    );
  }

  const prompt = buildVisionPrompt(Boolean(inputs.serviceJobId));

  let visionResult: VisionCallerResult;
  try {
    visionResult = await visionCaller({
      assetUrl: inputs.assetUrl,
      mimeType: inputs.mimeType,
      prompt,
    });
  } catch (err) {
    // Vision failed — return uncataloged placeholder so the asset is not lost.
    return uncatalogedFallback(inputs);
  }

  let parsed: RawCatalog;
  try {
    parsed = parseCatalogOutput(visionResult.text);
  } catch {
    return uncatalogedFallback(inputs);
  }

  const primarySubject =
    typeof parsed.primarySubject === "string" && parsed.primarySubject.trim().length > 0
      ? parsed.primarySubject.trim()
      : "[uncataloged]";
  const serviceCategory =
    typeof parsed.serviceCategory === "string" && parsed.serviceCategory.trim().length > 0
      ? parsed.serviceCategory.trim().toLowerCase()
      : "general";

  const visualQuality =
    typeof parsed.visualQuality === "number"
      ? Math.max(0, Math.min(1, parsed.visualQuality))
      : 0.5;

  const framingNotes =
    typeof parsed.framingNotes === "string"
      ? parsed.framingNotes.slice(0, 140)
      : "";

  const suggestedUses: AssetSuggestedUse[] = (
    Array.isArray(parsed.suggestedUses) ? parsed.suggestedUses : []
  )
    .filter((s): s is string => typeof s === "string")
    .map((s) => s as AssetSuggestedUse)
    .filter((s) => VALID_USES.has(s));

  if (suggestedUses.length === 0) {
    suggestedUses.push("internal-reference-only");
  }

  const flags: AssetFlag[] = (Array.isArray(parsed.flags) ? parsed.flags : [])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s as AssetFlag)
    .filter((f) => VALID_FLAGS.has(f));

  // If a privacy flag is set, drop captionDraft to avoid surfacing
  // identifying content. The orchestrator may still cache the asset for
  // operator review, but we don't ship a public caption.
  const privacyFlagged =
    flags.includes("face-detected") ||
    flags.includes("license-plate") ||
    flags.includes("customer-identifying") ||
    flags.includes("private-document");

  const captionDraft =
    !privacyFlagged && typeof parsed.captionDraft === "string"
      ? parsed.captionDraft.slice(0, 280)
      : undefined;

  return {
    catalog: {
      primarySubject,
      serviceCategory,
      visualQuality,
      framingNotes,
      suggestedUses,
      ...(captionDraft ? { captionDraft } : {}),
      catalogedAt: Date.now(),
      catalogModel: "gemini-3-flash-medium",
      catalogCostUsd: visionResult.costUsd,
    },
    flags,
  };
}

export const SKILL_METADATA = {
  name: "maya-service-asset-cataloger" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "medium" as const,
  planTier: ["starter", "pro", "studio"] as const,
};

export const __test__ = {
  buildVisionPrompt,
  parseCatalogOutput,
  isSupportedMime,
  uncatalogedFallback,
  VALID_USES,
  VALID_FLAGS,
};
