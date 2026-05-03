/**
 * maya-service-content-rejuvenator — surface stale-but-quality assets for repurposing.
 *
 * Per § 3 routing matrix: Gemini 3 Flash, MEDIUM thinking. The skill ranks
 * unposted-or-stale catalog assets and produces draft captions for the top N.
 *
 * Citation firewall enforcement (per SKILL.md):
 *   - every suggested asset must exist in input mediaAssets
 *   - every suggestedAction must reference a target platform NOT already in
 *     the asset's usageHistory
 *   - low-quality (visualQuality < 0.4) → skipped
 *   - private-content (incomplete catalog or "[uncataloged]") → skipped
 *
 * The LLM call is the prosification step: it takes the rule-based ranked
 * candidates and writes draftCaption + reasoning. If callLlm is omitted,
 * the skill falls back to deterministic captions from the catalog.captionDraft.
 */

export type RejuvenationAction =
  | "post-to-gbp-as-scrollable"
  | "post-to-instagram-single"
  | "post-to-instagram-carousel"
  | "post-to-facebook-carousel"
  | "edit-to-tiktok-clip"
  | "pair-as-before-after";

export type RejuvenationTargetPlatform =
  | "gbp"
  | "instagram"
  | "facebook"
  | "tiktok";

export interface RejuvenatorMediaAsset {
  assetId: string;
  catalog: {
    primarySubject: string;
    serviceCategory: string;
    visualQuality: number;
    suggestedUses: ReadonlyArray<string>;
    captionDraft?: string;
  };
  receivedAt: number;
  usageHistory: ReadonlyArray<{ platform: string; postedAt: number }>;
}

export interface ContentRejuvenatorInputs {
  businessId: string;
  mediaAssets: ReadonlyArray<RejuvenatorMediaAsset>;
  recentCadence: {
    gbpLastPostAt: number | null;
    fbLastPostAt: number | null;
    igLastPostAt: number | null;
    tiktokLastPostAt: number | null;
  };
  targetPostCount: number;
}

export interface ContentRejuvenatorOutput {
  suggestions: ReadonlyArray<{
    assetId: string;
    suggestedAction: RejuvenationAction;
    targetPlatform: RejuvenationTargetPlatform;
    draftCaption: string;
    reasoning: string;
    confidence: number;
  }>;
  skippedAssets: ReadonlyArray<{
    assetId: string;
    reason:
      | "low-quality"
      | "recently-used"
      | "private-content"
      | "incomplete-catalog";
  }>;
}

export interface LlmCaller {
  (prompt: { system: string; user: string }): Promise<string>;
}

const MIN_QUALITY = 0.4;
const RECENTLY_USED_DAYS = 90;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

interface RankedCandidate {
  asset: RejuvenatorMediaAsset;
  targetPlatform: RejuvenationTargetPlatform;
  suggestedAction: RejuvenationAction;
  rankScore: number;
}

function platformLastPostedAt(
  asset: RejuvenatorMediaAsset,
  platform: RejuvenationTargetPlatform
): number | null {
  const matches = asset.usageHistory
    .filter((u) => u.platform === platform)
    .map((u) => u.postedAt);
  return matches.length > 0 ? Math.max(...matches) : null;
}

function pickAction(
  asset: RejuvenatorMediaAsset,
  platform: RejuvenationTargetPlatform
): RejuvenationAction {
  const uses = asset.catalog.suggestedUses;
  if (platform === "gbp") {
    if (uses.includes("gbp-scrollable")) return "post-to-gbp-as-scrollable";
    return "post-to-gbp-as-scrollable";
  }
  if (platform === "instagram") {
    if (uses.includes("instagram-carousel"))
      return "post-to-instagram-carousel";
    return "post-to-instagram-single";
  }
  if (platform === "facebook") {
    return "post-to-facebook-carousel";
  }
  return "edit-to-tiktok-clip";
}

function rankCandidates(
  inputs: ContentRejuvenatorInputs
): {
  ranked: RankedCandidate[];
  skipped: ContentRejuvenatorOutput["skippedAssets"];
} {
  const skipped: { assetId: string; reason: "low-quality" | "recently-used" | "private-content" | "incomplete-catalog" }[] = [];
  const ranked: RankedCandidate[] = [];

  for (const asset of inputs.mediaAssets) {
    if (
      !asset.catalog.primarySubject ||
      asset.catalog.primarySubject === "[uncataloged]"
    ) {
      skipped.push({ assetId: asset.assetId, reason: "incomplete-catalog" });
      continue;
    }
    if (asset.catalog.visualQuality < MIN_QUALITY) {
      skipped.push({ assetId: asset.assetId, reason: "low-quality" });
      continue;
    }
    if (
      asset.catalog.suggestedUses.includes("internal-reference-only") &&
      asset.catalog.suggestedUses.length === 1
    ) {
      skipped.push({ assetId: asset.assetId, reason: "private-content" });
      continue;
    }

    // Try each platform; pick the BEST (lightest cadence + asset never posted).
    const candidates: RankedCandidate[] = [];
    const platforms: RejuvenationTargetPlatform[] = [
      "gbp",
      "instagram",
      "facebook",
      "tiktok",
    ];
    for (const p of platforms) {
      const lastPosted = platformLastPostedAt(asset, p);
      if (
        lastPosted !== null &&
        Date.now() - lastPosted < RECENTLY_USED_DAYS * MS_PER_DAY
      ) {
        continue; // already posted recently on this platform
      }
      // Score: never-posted-on-platform = 1.0, older-than-90d = 0.7,
      // never-uploaded-asset on this platform with light cadence = high.
      const cadenceKey =
        p === "gbp"
          ? inputs.recentCadence.gbpLastPostAt
          : p === "facebook"
            ? inputs.recentCadence.fbLastPostAt
            : p === "instagram"
              ? inputs.recentCadence.igLastPostAt
              : inputs.recentCadence.tiktokLastPostAt;
      const cadenceFresh =
        cadenceKey === null
          ? 1
          : Math.max(
              0,
              1 -
                (Date.now() - cadenceKey) / (RECENTLY_USED_DAYS * MS_PER_DAY)
            );
      // Lower cadenceFresh = more stale → higher rank (we want to fill quiet platforms).
      const cadenceBoost = 1 - cadenceFresh;
      const qualityScore = asset.catalog.visualQuality;
      const score = qualityScore * 0.6 + cadenceBoost * 0.4;
      candidates.push({
        asset,
        targetPlatform: p,
        suggestedAction: pickAction(asset, p),
        rankScore: score,
      });
    }
    if (candidates.length === 0) {
      skipped.push({ assetId: asset.assetId, reason: "recently-used" });
      continue;
    }
    candidates.sort((a, b) => b.rankScore - a.rankScore);
    ranked.push(candidates[0]);
  }

  ranked.sort((a, b) => b.rankScore - a.rankScore);
  return { ranked, skipped };
}

function buildPrompt(
  ranked: RankedCandidate[]
): { system: string; user: string } {
  const system = [
    "You write draft captions for stale-but-good service-business content assets.",
    "",
    "HARD RULES:",
    "1. Use ONLY the catalog data provided. Do not invent details.",
    "2. Plain prose draft caption per asset. No hashtags-only spam.",
    "3. reasoning: ≤100 chars per asset. 'Why this one' in plain English.",
    "4. confidence: 0..1 self-rating.",
    "5. Output JSON only.",
    "",
    "JSON output schema:",
    `{"items": [{"assetId": string, "draftCaption": string, "reasoning": string, "confidence": number}]}`,
  ].join("\n");
  const user = ranked
    .map(
      (c, i) =>
        `${i + 1}. assetId=${c.asset.assetId}, subject=${c.asset.catalog.primarySubject}, category=${c.asset.catalog.serviceCategory}, quality=${c.asset.catalog.visualQuality}, target=${c.targetPlatform}, action=${c.suggestedAction}, existingCaption=${c.asset.catalog.captionDraft ?? "(none)"}`
    )
    .join("\n");
  return { system, user };
}

interface RawItem {
  assetId?: string;
  draftCaption?: string;
  reasoning?: string;
  confidence?: number;
}

function parseLlmOutput(raw: string): RawItem[] {
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
    if (!m) return [];
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.items)) return [];
  return obj.items as RawItem[];
}

export async function rejuvenateContent(
  inputs: ContentRejuvenatorInputs,
  callLlm?: LlmCaller
): Promise<ContentRejuvenatorOutput> {
  const { ranked, skipped } = rankCandidates(inputs);

  if (ranked.length === 0) {
    return { suggestions: [], skippedAssets: skipped };
  }

  const top = ranked.slice(0, Math.max(1, inputs.targetPostCount));

  // Build allowed-asset-id set for citation firewall enforcement.
  const allowedAssetIds = new Set(inputs.mediaAssets.map((a) => a.assetId));

  let prosified: RawItem[] = [];
  if (callLlm) {
    const prompt = buildPrompt(top);
    const raw = await callLlm(prompt);
    prosified = parseLlmOutput(raw);
  }

  const suggestions: ContentRejuvenatorOutput["suggestions"] = top.map((c) => {
    const ai = prosified.find((p) => p.assetId === c.asset.assetId);
    const fallbackCaption =
      c.asset.catalog.captionDraft ??
      `${c.asset.catalog.primarySubject} — fresh from the field.`;
    return {
      assetId: c.asset.assetId,
      suggestedAction: c.suggestedAction,
      targetPlatform: c.targetPlatform,
      draftCaption:
        ai && typeof ai.draftCaption === "string" && ai.draftCaption.trim().length > 0
          ? ai.draftCaption
          : fallbackCaption,
      reasoning:
        ai && typeof ai.reasoning === "string" && ai.reasoning.trim().length > 0
          ? ai.reasoning.slice(0, 100)
          : `Quality ${c.asset.catalog.visualQuality.toFixed(2)}, unposted on ${c.targetPlatform}.`,
      confidence:
        ai && typeof ai.confidence === "number"
          ? Math.max(0, Math.min(1, ai.confidence))
          : c.rankScore,
    };
  });

  // Citation firewall: every assetId in suggestions must be in inputs.mediaAssets.
  for (const s of suggestions) {
    if (!allowedAssetIds.has(s.assetId)) {
      throw new Error(
        `content-rejuvenator: suggestion references asset '${s.assetId}' not in input library`
      );
    }
    // Cross-check usageHistory: never suggest a platform the asset has already
    // posted on within the recently-used window.
    const asset = inputs.mediaAssets.find((a) => a.assetId === s.assetId);
    if (!asset) continue;
    const lastPosted = platformLastPostedAt(asset, s.targetPlatform);
    if (
      lastPosted !== null &&
      Date.now() - lastPosted < RECENTLY_USED_DAYS * MS_PER_DAY
    ) {
      throw new Error(
        `content-rejuvenator: asset ${s.assetId} already recently posted on ${s.targetPlatform}`
      );
    }
  }

  return { suggestions, skippedAssets: skipped };
}

export const SKILL_METADATA = {
  name: "maya-service-content-rejuvenator" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "medium" as const,
  planTier: ["starter", "pro", "studio"] as const,
};

export const __test__ = { rankCandidates, pickAction, parseLlmOutput };
