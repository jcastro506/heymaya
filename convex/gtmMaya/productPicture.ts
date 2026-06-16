/**
 * W1.0 — Intelligent product picture (LLM synthesis).
 *
 * Upgrades the regex `appInspector` summary into a real, grounded picture of
 * the product. Modeled on the service pack's `generateBusinessPicture`:
 * assemble the founder's own words + the crawled landing page + (for mobile)
 * the store listing + cited grounded-search findings, then have the model
 * synthesize ONE structured picture — asserting only what the sources support
 * and listing everything it could not verify under `gaps`.
 *
 * Pure + dependency-injected (`apiKey`, `fetchImpl`) so it unit-tests against a
 * faked OpenRouter response. The caller (the inspector action) resolves the key
 * from env and gathers the source material. Soft-failure is the caller's job:
 * if synthesis throws, the regex `summary` remains as the cheap fallback.
 */

import {
  callOpenRouter,
  OpenRouterError,
  type ChatMessage,
  type OpenRouterUsage,
} from "../agents/modelRouter/openRouterClient";

const SYNTH_MODEL_DEFAULT = "google/gemini-3-flash";

export type PictureConfidence = "high" | "medium" | "low";

export interface ProductPicture {
  /** One-sentence promise — what the product does for whom. */
  promise: string;
  /** 1–2 sentences on the core workflow / what it actually does. */
  whatItDoes: string;
  /** The ICP in plain words — who it's for. */
  whoItsFor: string;
  /** The real differentiator / wedge (founder's words win when supplied). */
  differentiator: string;
  /** Market category. */
  category: string;
  /** Named competitors — only those grounded in the supplied sources. */
  competitors: string[];
  /** Visible pricing, or null if not surfaced. */
  pricing: string | null;
  /** Grounded proof points (metrics, customers, traction). */
  proofPoints: string[];
  /** How confident the model is in this picture overall. */
  confidence: PictureConfidence;
  /** What it could NOT verify — the honest "still to confirm in research" list. */
  gaps: string[];
  /** Source hostnames/URLs the picture leaned on. */
  sources: string[];
}

export interface GroundedFinding {
  title: string | null;
  url: string;
  excerpt: string | null;
}

export interface ProductPictureInputs {
  productName: string;
  productUrl?: string | null;
  /** Founder's own differentiator — the strongest prior. */
  founderDifferentiator?: string | null;
  founderWhy?: string | null;
  /** The regex crawl summary (promise/audience/features/CTAs). */
  crawledSummary?: {
    productPromise: string;
    likelyAudience: string[];
    visibleFeatures: string[];
    conversionSurface: string[];
  } | null;
  /** Pre-rendered store-listing context (App Store / Play), if mobile. */
  storeListingContext?: string | null;
  /** Cited findings from grounded web search ("<product>", "<product> vs"). */
  groundedFindings?: GroundedFinding[];
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export interface ProductPictureResult {
  picture: ProductPicture;
  model: string;
  latencyMs: number;
  usage: OpenRouterUsage;
}

const SYSTEM_PROMPT = `You are Maya, an AI go-to-market manager building your working picture of a founder's product BEFORE you do channel research. You are NOT the product and must never describe yourself.

Output STRICT JSON only (no prose, no code fences) matching exactly:
{
  "promise": string,            // one sentence: what it does, for whom
  "whatItDoes": string,         // 1-2 sentences on the core workflow
  "whoItsFor": string,          // the ICP in plain words
  "differentiator": string,     // the real wedge — prefer the founder's words when given
  "category": string,           // market category
  "competitors": string[],      // ONLY names grounded in the supplied sources; [] if none
  "pricing": string | null,     // only if visible in the sources; else null
  "proofPoints": string[],      // grounded metrics/customers/traction; [] if none
  "confidence": "high" | "medium" | "low",
  "gaps": string[],             // everything you could NOT verify from the sources
  "sources": string[]           // hostnames/URLs you leaned on
}

Grounding rules (non-negotiable):
- Assert ONLY what the provided sources support. Do not invent competitors, metrics, customers, or pricing.
- The founder's own differentiator/why, when provided, is the strongest signal — honor it.
- Anything you cannot verify goes in "gaps", not in the confident fields. An honest gaps list is more valuable than a confident guess.
- Set "confidence" low if you had thin sources (e.g. no site text and no store listing).`;

function buildUserMessage(inputs: ProductPictureInputs): string {
  const parts: string[] = [];
  parts.push(`PRODUCT NAME: ${inputs.productName}`);
  if (inputs.productUrl) parts.push(`URL: ${inputs.productUrl}`);

  if (inputs.founderDifferentiator) {
    parts.push(
      `FOUNDER'S DIFFERENTIATOR (their own words — strongest signal):\n${inputs.founderDifferentiator.trim()}`
    );
  }
  if (inputs.founderWhy) {
    parts.push(`FOUNDER'S WHY:\n${inputs.founderWhy.trim()}`);
  }

  if (inputs.crawledSummary) {
    const c = inputs.crawledSummary;
    parts.push(
      [
        "LANDING PAGE (crawled):",
        `- promise: ${c.productPromise}`,
        c.likelyAudience.length
          ? `- audience signals: ${c.likelyAudience.join(", ")}`
          : null,
        c.visibleFeatures.length
          ? `- feature signals: ${c.visibleFeatures.join(", ")}`
          : null,
        c.conversionSurface.length
          ? `- CTAs: ${c.conversionSurface.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  if (inputs.storeListingContext) {
    parts.push(`APP STORE LISTING:\n${inputs.storeListingContext.trim()}`);
  }

  if (inputs.groundedFindings && inputs.groundedFindings.length > 0) {
    const findings = inputs.groundedFindings
      .slice(0, 8)
      .map((f, i) => {
        const head = f.title ? `${f.title} (${f.url})` : f.url;
        return `[${i + 1}] ${head}\n${(f.excerpt ?? "").slice(0, 600)}`;
      })
      .join("\n\n");
    parts.push(`GROUNDED WEB SEARCH (how the world describes it, cited):\n${findings}`);
  }

  parts.push(
    "Build the structured product picture now. Strict JSON only. Put anything you cannot verify in gaps."
  );
  return parts.join("\n\n");
}

/** Strip code fences and parse the first JSON object in the model output. */
function parsePictureJson(content: string): unknown {
  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(text);
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asStringArray(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, cap);
}

function asConfidence(v: unknown): PictureConfidence {
  return v === "high" || v === "medium" || v === "low" ? v : "low";
}

/** Coerce raw model JSON into a safe, clamped ProductPicture. */
export function coerceProductPicture(raw: unknown): ProductPicture {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pricing = o.pricing;
  return {
    promise: asString(o.promise),
    whatItDoes: asString(o.whatItDoes),
    whoItsFor: asString(o.whoItsFor),
    differentiator: asString(o.differentiator),
    category: asString(o.category),
    competitors: asStringArray(o.competitors, 12),
    pricing: typeof pricing === "string" && pricing.trim() ? pricing.trim() : null,
    proofPoints: asStringArray(o.proofPoints, 12),
    confidence: asConfidence(o.confidence),
    gaps: asStringArray(o.gaps, 12),
    sources: asStringArray(o.sources, 12),
  };
}

/**
 * Synthesize the grounded product picture. Throws OpenRouterError on API
 * failure and a plain Error on unparseable output — the caller decides whether
 * to soft-fall back to the regex summary.
 */
export async function generateProductPicture(
  inputs: ProductPictureInputs
): Promise<ProductPictureResult> {
  if (!inputs.apiKey) {
    throw new Error(
      "generateProductPicture: openrouter apiKey is required (caller resolves from env)."
    );
  }
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(inputs) },
  ];
  const model = inputs.model ?? SYNTH_MODEL_DEFAULT;
  const start = Date.now();

  let result;
  try {
    result = await callOpenRouter({
      model,
      messages,
      thinkingBudget: "high",
      apiKey: inputs.apiKey,
      fetchImpl: inputs.fetchImpl,
    });
  } catch (err) {
    if (err instanceof OpenRouterError) throw err;
    throw new Error(
      `generateProductPicture: OpenRouter call failed: ${(err as Error).message}`
    );
  }

  let parsed: unknown;
  try {
    parsed = parsePictureJson(result.content);
  } catch (err) {
    throw new Error(
      `generateProductPicture: model output was not valid JSON: ${(err as Error).message}. Head: ${result.content.slice(0, 200)}`
    );
  }

  return {
    picture: coerceProductPicture(parsed),
    model: result.model,
    latencyMs: Date.now() - start,
    usage: result.usage,
  };
}
