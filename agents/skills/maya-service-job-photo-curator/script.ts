/**
 * maya-service-job-photo-curator — Sprint 3 implementation.
 *
 * Multimodal Gemini Files API curation. Picks best photos from a job batch
 * with reasoning + before/after pairing + face/license-plate flagging.
 *
 * Routing: Gemini 3 Flash, MEDIUM thinking (multimodal vision).
 *
 * Plan-tier: Starter capped at 3 photos out (enforced via `maxPhotosOut`).
 * Pro+: no cap.
 *
 * Photo-bridge integrity (R3 § 2): every input URL must be an http(s) URL.
 * `file://`, `data:`, and other local-only schemes are rejected.
 */

import {
  callOpenRouter,
  type ChatMessage,
} from "../../../convex/agents/modelRouter/openRouterClient";

export type PhotoFlag =
  | "face-detected"
  | "license-plate"
  | "blurry"
  | "uninteresting";

export interface JobPhotoCuratorInputs {
  photoUrls: ReadonlyArray<string>;
  jobContext?: {
    jobId: string;
    serviceType: string;
    customerLastName?: string;
  };
  geminiFilesApiClient: unknown;
  maxPhotosOut: number;
}

export interface JobPhotoCuratorOutput {
  bestPhotos: ReadonlyArray<{
    url: string;
    reasoning: string;
    qualityScore: number;
    flags: ReadonlyArray<PhotoFlag>;
  }>;
  rejected: ReadonlyArray<{ url: string; reason: string }>;
  beforeAfterPairs: ReadonlyArray<{
    beforeUrl: string;
    afterUrl: string;
    rationale: string;
  }>;
}

export interface JobPhotoCuratorOverrides {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  model?: string;
}

export class ServiceSkillError extends Error {
  constructor(
    public readonly skill: string,
    public readonly reason: string,
    public readonly detail?: string
  ) {
    super(detail ? `${skill}: ${reason} — ${detail}` : `${skill}: ${reason}`);
    this.name = "ServiceSkillError";
  }
}

const SKILL_ID = "maya-service-job-photo-curator";
const URL_PATTERN = /^https?:\/\//i;

function validateInputs(inputs: JobPhotoCuratorInputs): void {
  if (!Array.isArray(inputs.photoUrls) || inputs.photoUrls.length === 0) {
    throw new ServiceSkillError(SKILL_ID, "missing photoUrls (empty)");
  }
  if (
    typeof inputs.maxPhotosOut !== "number" ||
    inputs.maxPhotosOut < 1
  ) {
    throw new ServiceSkillError(
      SKILL_ID,
      `invalid maxPhotosOut '${inputs.maxPhotosOut}'`
    );
  }
  for (const url of inputs.photoUrls) {
    if (typeof url !== "string" || !URL_PATTERN.test(url)) {
      throw new ServiceSkillError(
        SKILL_ID,
        "photo URL must be http(s) — photo-bridge integrity (R3 § 2)",
        url.slice(0, 80)
      );
    }
    if (url.startsWith("file://") || url.startsWith("data:")) {
      throw new ServiceSkillError(
        SKILL_ID,
        "photo URL must be http(s); file:// and data: are forbidden"
      );
    }
  }
}

function neutralizeInjection(text: string): string {
  return text
    .replace(/\bignore (?:all )?(?:previous|prior|above) instructions?\b/gi, "[redacted]")
    .replace(/\b(system|assistant)\s*:\s*/gi, "")
    .replace(/<\|.*?\|>/g, "")
    .trim();
}

function buildPrompt(inputs: JobPhotoCuratorInputs): string {
  const ctx = inputs.jobContext;
  const ctxLine = ctx
    ? `Job context: ${neutralizeInjection(ctx.serviceType)}${
        ctx.customerLastName
          ? ` (customer surname: ${neutralizeInjection(ctx.customerLastName)})`
          : ""
      }`
    : "No job context provided.";
  const cap = Math.min(inputs.maxPhotosOut, inputs.photoUrls.length);
  const list = inputs.photoUrls
    .map((u, i) => `  ${i}: ${u}`)
    .join("\n");

  return [
    `You are reviewing a batch of job-site photos for a service-business operator.`,
    `Your task: pick the best ${cap} for marketing use, flag privacy issues, identify before/after pairs.`,
    ``,
    ctxLine,
    ``,
    `Photos (index : url):`,
    list,
    ``,
    `For each photo, return:`,
    `- index (number)`,
    `- qualityScore (0..1; >0.7 means usable for marketing)`,
    `- visualQuality ("excellent"|"good"|"fair"|"poor")`,
    `- framingNotes (≤80 chars)`,
    `- flags array (subset of: "face-detected","license-plate","blurry","uninteresting")`,
    `- suggestedUses array (subset of: "gbp-post","review-reply","website","internal-only")`,
    ``,
    `Hard rules:`,
    `- A clearly-identifiable customer face (not a worn safety mask) → flag "face-detected" + reject from bestPhotos.`,
    `- A readable license plate → flag "license-plate" + reject from bestPhotos.`,
    `- Pick UP TO ${cap} photos for bestPhotos (lower is OK if quality is poor).`,
    `- Identify BEFORE/AFTER pairs by visual evidence (same scene, different completion state).`,
    ``,
    `Return STRICT JSON only, no prose, no code fences. Schema:`,
    `{`,
    `  "perPhoto": [`,
    `    {"index": 0, "qualityScore": 0.85, "visualQuality": "good", "framingNotes": "...", "flags": [], "suggestedUses": ["gbp-post"]}`,
    `  ],`,
    `  "beforeAfterPairs": [`,
    `    {"beforeIndex": 1, "afterIndex": 2, "rationale": "..."}`,
    `  ]`,
    `}`,
  ].join("\n");
}

interface PerPhotoLLM {
  index?: unknown;
  qualityScore?: unknown;
  visualQuality?: unknown;
  framingNotes?: unknown;
  flags?: unknown;
  suggestedUses?: unknown;
}

interface PairLLM {
  beforeIndex?: unknown;
  afterIndex?: unknown;
  rationale?: unknown;
}

interface RawResponse {
  perPhoto?: unknown;
  beforeAfterPairs?: unknown;
}

function parseLlmJson(content: string): RawResponse {
  const stripped = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(stripped) as RawResponse;
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as RawResponse;
      } catch {
        /* fall through */
      }
    }
    throw new ServiceSkillError(
      SKILL_ID,
      "LLM returned malformed JSON",
      stripped.slice(0, 200)
    );
  }
}

const VALID_FLAGS: ReadonlySet<PhotoFlag> = new Set<PhotoFlag>([
  "face-detected",
  "license-plate",
  "blurry",
  "uninteresting",
]);

function coerceFlags(raw: unknown): PhotoFlag[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is PhotoFlag => typeof x === "string" && VALID_FLAGS.has(x as PhotoFlag)
  );
}

function reasonForFlag(flag: PhotoFlag): string {
  switch (flag) {
    case "face-detected":
      return "customer face visible without consent";
    case "license-plate":
      return "readable license plate visible";
    case "blurry":
      return "image too blurry for marketing use";
    case "uninteresting":
      return "low visual interest";
  }
}

export async function curateJobPhotos(
  inputs: JobPhotoCuratorInputs,
  overrides: JobPhotoCuratorOverrides = {}
): Promise<JobPhotoCuratorOutput> {
  validateInputs(inputs);

  const apiKey =
    overrides.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
  if (!apiKey) {
    throw new ServiceSkillError(
      SKILL_ID,
      "missing OPENROUTER_API_KEY"
    );
  }
  const model =
    overrides.model ??
    process.env.OPENROUTER_DEFAULT_MODEL ??
    "google/gemini-3-flash";

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are Maya, an AI manager. You review service-business job-site photos for marketing use, flag privacy issues, and identify before/after pairs. Output strict JSON when asked.",
    },
    { role: "user", content: buildPrompt(inputs) },
  ];

  const completion = await callOpenRouter({
    model,
    messages,
    thinkingBudget: SKILL_METADATA.thinkingBudget,
    apiKey,
    fetchImpl: overrides.fetchImpl,
    maxOutputTokens: 1500,
  });

  const parsed = parseLlmJson(completion.content);
  const perPhotoArr: PerPhotoLLM[] = Array.isArray(parsed.perPhoto)
    ? (parsed.perPhoto as PerPhotoLLM[])
    : [];

  const bestPhotos: Array<{
    url: string;
    reasoning: string;
    qualityScore: number;
    flags: PhotoFlag[];
  }> = [];
  const rejected: Array<{ url: string; reason: string }> = [];

  for (const entry of perPhotoArr) {
    if (
      typeof entry.index !== "number" ||
      entry.index < 0 ||
      entry.index >= inputs.photoUrls.length
    ) {
      continue;
    }
    const url = inputs.photoUrls[entry.index];
    const flags = coerceFlags(entry.flags);
    const score =
      typeof entry.qualityScore === "number" &&
      Number.isFinite(entry.qualityScore)
        ? Math.max(0, Math.min(1, entry.qualityScore))
        : 0;
    const reasoning =
      typeof entry.framingNotes === "string"
        ? entry.framingNotes.slice(0, 140)
        : "";

    // Privacy hard-rejects: face or license plate.
    if (
      flags.includes("face-detected") ||
      flags.includes("license-plate")
    ) {
      rejected.push({
        url,
        reason: reasonForFlag(
          flags.includes("face-detected") ? "face-detected" : "license-plate"
        ),
      });
      continue;
    }
    // Quality reject: blurry or quality < 0.4.
    if (flags.includes("blurry") || score < 0.4) {
      rejected.push({
        url,
        reason: flags.includes("blurry")
          ? reasonForFlag("blurry")
          : "quality below threshold",
      });
      continue;
    }
    bestPhotos.push({
      url,
      reasoning,
      qualityScore: score,
      flags,
    });
  }

  // Plan-tier cap: maxPhotosOut.
  const sortedBest = [...bestPhotos].sort(
    (a, b) => b.qualityScore - a.qualityScore
  );
  const cappedBest = sortedBest.slice(0, inputs.maxPhotosOut);
  const trimmedTail = sortedBest.slice(inputs.maxPhotosOut);
  for (const t of trimmedTail) {
    rejected.push({
      url: t.url,
      reason: `over maxPhotosOut cap of ${inputs.maxPhotosOut}`,
    });
  }

  // Before/after pairs: only valid if both indices were in `bestPhotos`.
  const bestUrls = new Set(cappedBest.map((p) => p.url));
  const pairsRaw: PairLLM[] = Array.isArray(parsed.beforeAfterPairs)
    ? (parsed.beforeAfterPairs as PairLLM[])
    : [];
  const beforeAfterPairs: Array<{
    beforeUrl: string;
    afterUrl: string;
    rationale: string;
  }> = [];
  for (const p of pairsRaw) {
    if (
      typeof p.beforeIndex !== "number" ||
      typeof p.afterIndex !== "number" ||
      p.beforeIndex < 0 ||
      p.afterIndex < 0 ||
      p.beforeIndex >= inputs.photoUrls.length ||
      p.afterIndex >= inputs.photoUrls.length ||
      p.beforeIndex === p.afterIndex
    ) {
      continue;
    }
    const beforeUrl = inputs.photoUrls[p.beforeIndex];
    const afterUrl = inputs.photoUrls[p.afterIndex];
    if (!bestUrls.has(beforeUrl) || !bestUrls.has(afterUrl)) continue;
    beforeAfterPairs.push({
      beforeUrl,
      afterUrl,
      rationale:
        typeof p.rationale === "string" ? p.rationale.slice(0, 200) : "",
    });
  }

  return {
    bestPhotos: cappedBest,
    rejected,
    beforeAfterPairs,
  };
}

export const SKILL_METADATA = {
  name: "maya-service-job-photo-curator" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "medium" as const,
  planTier: ["starter", "pro", "studio"] as const,
};
