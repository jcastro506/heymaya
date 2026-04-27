/**
 * maya-service-gbp-post-optimizer — Sprint 3 implementation.
 *
 * Composes a Google Business Profile local post — text + CTA + image hint.
 *
 * LOCAL-HOOK HARD RULE: every output MUST contain at least one local hook
 * pulled from `localPositioning`. Generic "in your area" / "in our community"
 * outputs FAIL. If no usable hook can be sourced, the skill returns
 * `localHookUsed: null` and the orchestrating Convex action MUST refuse to
 * promote the draft.
 *
 * Routing: Gemini 3 Flash, MEDIUM thinking. Reasoning quality matters —
 * local-hook integration + voice mirroring + CTA inference all benefit.
 *
 * Plan-tier: Pro+ only. Starter does not get this skill.
 */

import {
  callOpenRouter,
  type ChatMessage,
} from "../../../convex/agents/modelRouter/openRouterClient";
import {
  planFeaturesService,
  PlanServiceGateError,
  type ServicePlan,
} from "../../../convex/planService";

export type GbpPostType = "STANDARD" | "EVENT" | "OFFER";
export type GbpCtaButton = "CALL" | "BOOK" | "ORDER" | "LEARN_MORE";

export type LocalHookKind =
  | "neighborhood"
  | "zip"
  | "landmark"
  | "competitor-contrast"
  | "weather"
  | "event"
  | "season"
  | "community";

export interface JobPhotoRef {
  assetId: string;
  catalog: {
    primarySubject: string;
    serviceCategory: string;
    suggestedUses: ReadonlyArray<string>;
  };
}

export interface LocalPositioningInput {
  servedZips: ReadonlyArray<string>;
  servedNeighborhoods: ReadonlyArray<string>;
  namedCompetitors: ReadonlyArray<{
    name: string;
    reputationalNote?: string;
  }>;
  recurringLocalHooks: ReadonlyArray<{
    kind: "weather" | "event" | "landmark" | "sport" | "season" | "community";
    text: string;
  }>;
  localChoiceThesis: string;
}

export interface GbpPostOptimizerInputs {
  seedTopic?: string;
  jobPhotos?: ReadonlyArray<JobPhotoRef>;
  serviceArea: string;
  brandVoice: string;
  postType: GbpPostType;
  localPositioning: LocalPositioningInput;
  ctaIntent?: GbpCtaButton;
}

export interface GbpPostOptimizerOutput {
  text: string;
  cta: {
    button: GbpCtaButton;
    targetUrl?: string;
  };
  recommendedImageAssetIds?: ReadonlyArray<string>;
  localHookUsed: {
    kind: LocalHookKind;
    text: string;
    sourcedFrom: string;
  } | null;
  citationContext: {
    grounded: boolean;
    sources: ReadonlyArray<string>;
  };
}

export interface GbpPostOptimizerOverrides {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  model?: string;
  /**
   * Optional plan check. When set, fails-closed against `planFeaturesService`.
   * Production callers pass the resolved business plan.
   */
  planTier?: ServicePlan | string | null;
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

const SKILL_ID = "maya-service-gbp-post-optimizer";
const TEXT_HARD_CAP = 1500;
const GENERIC_PHRASES: ReadonlyArray<RegExp> = [
  /\bin your area\b/i,
  /\bin our community\b/i,
  /\bin the local area\b/i,
  /\bnear you\b/i,
];

function neutralizeInjection(text: string): string {
  return text
    .replace(/\bignore (?:all )?(?:previous|prior|above) instructions?\b/gi, "[redacted]")
    .replace(/\b(system|assistant)\s*:\s*/gi, "")
    .replace(/<\|.*?\|>/g, "")
    .trim();
}

function stripPriceQuotes(text: string): string {
  // Replace bare currency price quotes ($199, $1,234, $19.99) with
  // "competitive rates" — operator owns pricing per § 7 hard rule.
  return text.replace(/\$\s?\d{1,3}(?:[\d,]*)(?:\.\d{2})?/g, "competitive rates");
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const lastBreak = sliced.lastIndexOf(". ");
  return lastBreak > max * 0.6
    ? sliced.slice(0, lastBreak + 1)
    : sliced.trimEnd();
}

interface CandidateHook {
  kind: LocalHookKind;
  text: string;
  sourcedFrom: string;
}

/**
 * Build the candidate-hook list from `localPositioning`. Order matters —
 * earlier hooks are preferred when the LLM doesn't pick.
 */
function buildHookCandidates(
  lp: LocalPositioningInput
): CandidateHook[] {
  const out: CandidateHook[] = [];
  lp.servedNeighborhoods.forEach((n, i) => {
    if (n && n.trim()) {
      out.push({
        kind: "neighborhood",
        text: n.trim(),
        sourcedFrom: `localPositioning.servedNeighborhoods[${i}]`,
      });
    }
  });
  lp.recurringLocalHooks.forEach((h, i) => {
    if (h.text && h.text.trim()) {
      // Map fixture's "sport" subtype to the "community" output kind to keep
      // the public LocalHookKind enum tight (sport is a flavor of community).
      const kind: LocalHookKind =
        h.kind === "sport" ? "community" : h.kind;
      out.push({
        kind,
        text: h.text.trim(),
        sourcedFrom: `localPositioning.recurringLocalHooks[${i}]`,
      });
    }
  });
  lp.servedZips.forEach((z, i) => {
    if (z && z.trim()) {
      out.push({
        kind: "zip",
        text: z.trim(),
        sourcedFrom: `localPositioning.servedZips[${i}]`,
      });
    }
  });
  return out;
}

function inferCtaFromPostType(postType: GbpPostType): GbpCtaButton {
  switch (postType) {
    case "OFFER":
      return "BOOK";
    case "EVENT":
      return "LEARN_MORE";
    case "STANDARD":
      return "CALL";
  }
}

function rankPhotos(
  photos: ReadonlyArray<JobPhotoRef>,
  cap: number
): string[] {
  const scored = photos.map((p) => {
    const useScore = p.catalog.suggestedUses.includes("gbp-post") ? 2 : 0;
    return { id: p.assetId, score: useScore };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, cap).map((s) => s.id);
}

function validateInputs(inputs: GbpPostOptimizerInputs): void {
  if (!inputs.seedTopic && (!inputs.jobPhotos || inputs.jobPhotos.length === 0)) {
    throw new ServiceSkillError(
      SKILL_ID,
      "must supply seedTopic OR jobPhotos[]"
    );
  }
  if (!inputs.serviceArea || !inputs.serviceArea.trim()) {
    throw new ServiceSkillError(SKILL_ID, "missing serviceArea");
  }
  if (!inputs.brandVoice || !inputs.brandVoice.trim()) {
    throw new ServiceSkillError(SKILL_ID, "missing brandVoice");
  }
  if (
    inputs.postType !== "STANDARD" &&
    inputs.postType !== "EVENT" &&
    inputs.postType !== "OFFER"
  ) {
    throw new ServiceSkillError(
      SKILL_ID,
      `invalid postType '${inputs.postType}'`
    );
  }
}

function buildPrompt(
  inputs: GbpPostOptimizerInputs,
  candidates: CandidateHook[]
): string {
  const cleanVoice = neutralizeInjection(inputs.brandVoice);
  const cleanSeed = neutralizeInjection(
    stripPriceQuotes(inputs.seedTopic ?? "")
  );
  const photoSummary =
    inputs.jobPhotos && inputs.jobPhotos.length > 0
      ? `Photos available (one of these will be selected by orchestrator): ${inputs.jobPhotos
          .map((p) => `[${p.catalog.primarySubject} / ${p.catalog.serviceCategory}]`)
          .join(", ")}`
      : "No photos provided.";
  const hookList =
    candidates.length > 0
      ? candidates
          .slice(0, 8)
          .map((c) => `  - {kind:"${c.kind}", text:"${c.text}", sourcedFrom:"${c.sourcedFrom}"}`)
          .join("\n")
      : "(no candidates — fall back to a served zip + the GBP city.)";

  return [
    `Compose a Google Business Profile local post.`,
    ``,
    `Service area: ${inputs.serviceArea}`,
    `Post type: ${inputs.postType}`,
    `Seed topic (operator-supplied, may be empty): ${cleanSeed || "(none)"}`,
    photoSummary,
    `CTA intent (operator preference, may be empty): ${inputs.ctaIntent ?? "(infer from postType)"}`,
    `Brand voice to mirror: """${cleanVoice}"""`,
    ``,
    `LOCAL-HOOK HARD RULE: the post body MUST weave in EXACTLY ONE of these hooks (choose the best fit). Use the literal `,
    `'text' field; do NOT paraphrase the hook out of recognition.`,
    hookList,
    ``,
    `Hard rules:`,
    `- Hook lives in the FIRST 80 chars (mobile preview cutoff).`,
    `- Caption length: 80-400 chars for STANDARD; longer OK for EVENT/OFFER (max 1500).`,
    `- NO price quotes — write "starting at" or "competitive rates" instead.`,
    `- NO generic phrasing ("in your area", "in our community", "near you") — those FAIL.`,
    `- Mirror the brand voice; no corporate boilerplate.`,
    `- One CTA, one ask.`,
    ``,
    `Return STRICT JSON only, no prose, no code fences. Schema:`,
    `{`,
    `  "text": "<= 1500 chars",`,
    `  "cta": "CALL"|"BOOK"|"ORDER"|"LEARN_MORE",`,
    `  "localHookUsed": {"kind":"...", "text":"...", "sourcedFrom":"..."}`,
    `}`,
  ].join("\n");
}

interface RawResponse {
  text?: unknown;
  cta?: unknown;
  localHookUsed?: unknown;
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

function isValidCta(s: unknown): s is GbpCtaButton {
  return (
    s === "CALL" ||
    s === "BOOK" ||
    s === "ORDER" ||
    s === "LEARN_MORE"
  );
}

function isValidHookKind(s: unknown): s is LocalHookKind {
  return (
    s === "neighborhood" ||
    s === "zip" ||
    s === "landmark" ||
    s === "competitor-contrast" ||
    s === "weather" ||
    s === "event" ||
    s === "season" ||
    s === "community"
  );
}

function containsGeneric(text: string): boolean {
  return GENERIC_PHRASES.some((r) => r.test(text));
}

/**
 * Verify the LLM's claimed hook actually appears in the post text AND
 * matches a real candidate from `localPositioning`.
 */
function verifyHookInText(
  hook: { kind: LocalHookKind; text: string; sourcedFrom: string } | null,
  text: string,
  candidates: CandidateHook[]
): { ok: boolean; resolved: CandidateHook | null } {
  if (!hook) return { ok: false, resolved: null };
  const matchCandidate = candidates.find(
    (c) =>
      c.sourcedFrom === hook.sourcedFrom ||
      c.text.toLowerCase() === hook.text.toLowerCase()
  );
  if (!matchCandidate) return { ok: false, resolved: null };
  if (!text.toLowerCase().includes(matchCandidate.text.toLowerCase())) {
    return { ok: false, resolved: null };
  }
  return { ok: true, resolved: matchCandidate };
}

/**
 * Best-effort programmatic hook insertion when the LLM-supplied draft fails
 * verification. Picks the highest-priority candidate, weaves it into the
 * first sentence, and returns the rebuilt text + the resolved hook.
 */
function injectHookProgrammatically(
  baseText: string,
  candidates: CandidateHook[],
  postType: GbpPostType
): { text: string; resolved: CandidateHook } | null {
  if (candidates.length === 0) return null;
  const best = candidates[0];
  const lead =
    postType === "OFFER"
      ? `Special for ${best.text}: `
      : postType === "EVENT"
        ? `Coming up in ${best.text}: `
        : `Just wrapped a job in ${best.text} — `;
  const rebuilt = `${lead}${baseText.trim()}`;
  return { text: cap(rebuilt, TEXT_HARD_CAP), resolved: best };
}

/**
 * Plan-tier gate. Pro+ only. Starter callers throw `PlanServiceGateError`.
 */
function gatePlanTier(planTier?: ServicePlan | string | null): void {
  if (planTier === undefined) return; // skip when unset (e.g. unit tests)
  const features = planFeaturesService({ planTier: planTier ?? undefined });
  if (features.plan === "starter") {
    throw new PlanServiceGateError(
      "starter",
      "gbp-post-optimizer",
      "pro"
    );
  }
}

export async function optimizeGbpPost(
  inputs: GbpPostOptimizerInputs,
  overrides: GbpPostOptimizerOverrides = {}
): Promise<GbpPostOptimizerOutput> {
  validateInputs(inputs);
  gatePlanTier(overrides.planTier);

  const candidates = buildHookCandidates(inputs.localPositioning);

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
        "You are Maya, an AI manager for a service-business operator. You compose Google Business Profile local posts that always weave in a real hyperlocal hook from the operator's localPositioning. Output strict JSON when asked.",
    },
    { role: "user", content: buildPrompt(inputs, candidates) },
  ];

  const completion = await callOpenRouter({
    model,
    messages,
    thinkingBudget: SKILL_METADATA.thinkingBudget,
    apiKey,
    fetchImpl: overrides.fetchImpl,
    maxOutputTokens: 1200,
  });

  const parsed = parseLlmJson(completion.content);
  const draftTextRaw =
    typeof parsed.text === "string" ? parsed.text.trim() : "";
  const ctaResolved: GbpCtaButton =
    inputs.ctaIntent && isValidCta(inputs.ctaIntent)
      ? inputs.ctaIntent
      : isValidCta(parsed.cta)
        ? parsed.cta
        : inferCtaFromPostType(inputs.postType);

  let text = stripPriceQuotes(draftTextRaw);
  text = cap(text, TEXT_HARD_CAP);

  let resolvedHook: CandidateHook | null = null;
  let llmHook:
    | { kind: LocalHookKind; text: string; sourcedFrom: string }
    | null = null;
  if (
    parsed.localHookUsed &&
    typeof parsed.localHookUsed === "object" &&
    parsed.localHookUsed !== null
  ) {
    const h = parsed.localHookUsed as {
      kind?: unknown;
      text?: unknown;
      sourcedFrom?: unknown;
    };
    if (
      isValidHookKind(h.kind) &&
      typeof h.text === "string" &&
      typeof h.sourcedFrom === "string"
    ) {
      llmHook = {
        kind: h.kind,
        text: h.text,
        sourcedFrom: h.sourcedFrom,
      };
    }
  }

  const verify = verifyHookInText(llmHook, text, candidates);
  if (verify.ok && verify.resolved) {
    resolvedHook = verify.resolved;
  } else if (candidates.length > 0) {
    // Programmatic fallback: try to inject the top candidate.
    const injection = injectHookProgrammatically(
      text || "Local service available — call for scheduling.",
      candidates,
      inputs.postType
    );
    if (injection) {
      text = injection.text;
      resolvedHook = injection.resolved;
    }
  }

  // Generic-phrase scrub. If the post still contains "in your area" etc.,
  // we strip that phrase. The hook check above is the primary defense.
  if (containsGeneric(text)) {
    GENERIC_PHRASES.forEach((r) => {
      text = text.replace(r, "").replace(/\s{2,}/g, " ").trim();
    });
  }

  // If we still don't have a resolved hook AND the text contains generic
  // phrasing, return localHookUsed: null so the orchestrator refuses promotion.
  const finalHookUsed = resolvedHook
    ? {
        kind: resolvedHook.kind,
        text: resolvedHook.text,
        sourcedFrom: resolvedHook.sourcedFrom,
      }
    : null;

  // Image ranking — top 5 photos by gbp-post suggestedUse.
  const recommendedImageAssetIds =
    inputs.jobPhotos && inputs.jobPhotos.length > 0
      ? rankPhotos(inputs.jobPhotos, 5)
      : undefined;

  const sources: string[] = [];
  if (finalHookUsed) sources.push(finalHookUsed.sourcedFrom);
  sources.push("brandVoice");

  return {
    text,
    cta: { button: ctaResolved },
    recommendedImageAssetIds,
    localHookUsed: finalHookUsed,
    citationContext: {
      grounded: finalHookUsed !== null,
      sources,
    },
  };
}

export const SKILL_METADATA = {
  name: "maya-service-gbp-post-optimizer" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "medium" as const,
  planTier: ["pro", "studio"] as const,
  /** Hard rule per § 7 — every output must contain at least one local hook. */
  localHookRequired: true as const,
};
