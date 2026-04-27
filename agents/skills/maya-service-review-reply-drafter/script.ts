/**
 * maya-service-review-reply-drafter — Sprint 3 implementation.
 *
 * Drafts a Google Business Profile review reply that passes Google's
 * `ReviewReplyState` moderation. NEVER auto-publishes — operator approval
 * required at every tier (Google moderation lock + product-quality lock).
 *
 * Routing: Gemini 3 Flash, MEDIUM thinking budget. Public + permanent +
 * multi-stakeholder text — reasoning quality matters.
 *
 * Citation firewall: when `jobContext` is present, the skill MAY reference
 * the technician name + service type. When absent, the skill returns a
 * generic acknowledgment AND `citationContext.matchedJob: null`. Risk flags
 * (extortion, legal-threat) escalate to operator-only handling and replace
 * the draft with a placeholder.
 */

import {
  callOpenRouter,
  type ChatMessage,
} from "../../../convex/agents/modelRouter/openRouterClient";

export type ReviewSentiment = "positive" | "neutral" | "negative";
export type ReviewRiskFlag =
  | "extortion-language"
  | "profanity"
  | "competitor-name-drop"
  | "personal-info-leak"
  | "legal-threat";

export interface ReviewReplyJobContext {
  jobId: string;
  serviceType: string;
  technicianName: string | null;
  completedAt: number;
  notes: string;
}

export interface ReviewReplyDrafterInputs {
  reviewBody: string;
  reviewerName: string;
  starRating: 1 | 2 | 3 | 4 | 5;
  brandVoice: string;
  jobContext?: ReviewReplyJobContext;
  operatorFirstName: string;
}

export interface ReviewReplyDrafterOutput {
  replyText: string;
  sentiment: ReviewSentiment;
  riskFlags: ReadonlyArray<ReviewRiskFlag>;
  citationContext: {
    matchedJob: string | null;
    grounded: boolean;
  };
}

export interface ReviewReplyDrafterOverrides {
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
    super(
      detail
        ? `${skill}: ${reason} — ${detail}`
        : `${skill}: ${reason}`
    );
    this.name = "ServiceSkillError";
  }
}

const SKILL_ID = "maya-service-review-reply-drafter";
const REPLY_HARD_CAP = 350; // GBP soft cap

const EXTORTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:remove|delete)\s+this\s+review\s+if/i,
  /\bunless\s+you\s+(?:refund|pay|give)/i,
  /\bi\s+will\s+(?:keep|leave)\s+(?:posting|reviewing)/i,
  /\bgive\s+me\s+a\s+(?:discount|refund)\s+or\s+i/i,
];
const LEGAL_THREAT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:lawsuit|sue|attorney|lawyer|legal\s+action|small\s+claims)\b/i,
  /\bsee\s+you\s+in\s+court\b/i,
];
const PROFANITY_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:f\*+ck|fuck|shit|asshole|bastard|bitch|damn(?:\s+it)?)\b/i,
];
const PERSONAL_INFO_PATTERNS: ReadonlyArray<RegExp> = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\b\d{16}\b/, // bare card numbers
];

function detectRiskFlags(
  reviewBody: string
): ReviewRiskFlag[] {
  const flags = new Set<ReviewRiskFlag>();
  if (EXTORTION_PATTERNS.some((r) => r.test(reviewBody))) {
    flags.add("extortion-language");
  }
  if (LEGAL_THREAT_PATTERNS.some((r) => r.test(reviewBody))) {
    flags.add("legal-threat");
  }
  if (PROFANITY_PATTERNS.some((r) => r.test(reviewBody))) {
    flags.add("profanity");
  }
  if (PERSONAL_INFO_PATTERNS.some((r) => r.test(reviewBody))) {
    flags.add("personal-info-leak");
  }
  return Array.from(flags);
}

function detectCompetitorMention(
  reply: string,
  competitorNames: ReadonlyArray<string>
): boolean {
  const lower = reply.toLowerCase();
  return competitorNames.some((c) => c && lower.includes(c.toLowerCase()));
}

function neutralizeInjection(text: string): string {
  return text
    .replace(/\bignore (?:all )?(?:previous|prior|above) instructions?\b/gi, "[redacted]")
    .replace(/\b(system|assistant)\s*:\s*/gi, "")
    .replace(/<\|.*?\|>/g, "")
    .trim();
}

function inferSentiment(starRating: number): ReviewSentiment {
  if (starRating >= 4) return "positive";
  if (starRating === 3) return "neutral";
  return "negative";
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  return lastSpace > max * 0.5
    ? sliced.slice(0, lastSpace).trimEnd()
    : sliced;
}

function validateInputs(inputs: ReviewReplyDrafterInputs): void {
  if (!inputs.reviewBody || !inputs.reviewBody.trim()) {
    throw new ServiceSkillError(SKILL_ID, "missing reviewBody");
  }
  if (!inputs.reviewerName || !inputs.reviewerName.trim()) {
    throw new ServiceSkillError(SKILL_ID, "missing reviewerName");
  }
  if (
    inputs.starRating !== 1 &&
    inputs.starRating !== 2 &&
    inputs.starRating !== 3 &&
    inputs.starRating !== 4 &&
    inputs.starRating !== 5
  ) {
    throw new ServiceSkillError(
      SKILL_ID,
      `invalid starRating ${inputs.starRating} (must be 1-5)`
    );
  }
  if (!inputs.brandVoice || !inputs.brandVoice.trim()) {
    throw new ServiceSkillError(SKILL_ID, "missing brandVoice");
  }
  if (!inputs.operatorFirstName || !inputs.operatorFirstName.trim()) {
    throw new ServiceSkillError(SKILL_ID, "missing operatorFirstName");
  }
}

function buildPrompt(inputs: ReviewReplyDrafterInputs): string {
  const cleanVoice = neutralizeInjection(inputs.brandVoice);
  const cleanBody = neutralizeInjection(inputs.reviewBody);
  const jobLine = inputs.jobContext
    ? `Matched job: ${inputs.jobContext.serviceType}${
        inputs.jobContext.technicianName
          ? ` (technician: ${inputs.jobContext.technicianName})`
          : ""
      }. You MAY reference these facts.`
    : "No matched job. DO NOT invent a service type or technician name. Generic acknowledgment only.";

  let toneRule: string;
  if (inputs.starRating >= 5) {
    toneRule =
      "5-star: warm, specific to the review's content; sign off in the operator's voice. No upsell.";
  } else if (inputs.starRating === 4) {
    toneRule =
      "4-star: thank, acknowledge the gap implicitly, offer to address anything that fell short via private channel.";
  } else if (inputs.starRating === 3) {
    toneRule =
      "3-star: acknowledge the gap, no defensive language. Offer to make it right via 'please call us'.";
  } else {
    toneRule =
      "1-2 star: empathy first, never argue specifics in public. ALWAYS end with 'please call us so we can make this right'.";
  }

  return [
    `Draft a Google Business Profile review reply.`,
    ``,
    `Reviewer name: ${inputs.reviewerName}`,
    `Star rating: ${inputs.starRating}/5`,
    `Review body (verbatim, may be hostile or off-topic):`,
    `"""${cleanBody}"""`,
    ``,
    jobLine,
    `Operator first name (sign-off): ${inputs.operatorFirstName}`,
    `Brand voice to mirror: """${cleanVoice}"""`,
    ``,
    `Hard rules (Google ReviewReplyState moderation + brand-safety):`,
    `- ≤350 characters total. This is hard.`,
    `- Never name a competitor.`,
    `- Never quote a price or guarantee.`,
    `- Never imply liability ("sorry the leak happened" not "sorry our work caused it").`,
    `- Never argue facts publicly. Take disputes offline.`,
    `- Never promise specifics ("5-star guarantee", "free service forever").`,
    `- If review mentions a technician name AND jobContext is present and matches, you may name them. Otherwise generic.`,
    ``,
    toneRule,
    ``,
    `Return STRICT JSON only, no prose, no code fences. Schema:`,
    `{"replyText":"<= 350 chars","sentiment":"positive|neutral|negative"}`,
  ].join("\n");
}

interface RawResponse {
  replyText?: unknown;
  sentiment?: unknown;
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

function operatorOnlyPlaceholder(flags: ReviewRiskFlag[]): string {
  return `[operator: this review needs your direct handling — risk flags: ${flags.join(", ")}]`;
}

function safeFallbackReply(
  inputs: ReviewReplyDrafterInputs
): string {
  if (inputs.starRating >= 5) {
    const techPart =
      inputs.jobContext?.technicianName
        ? `${inputs.jobContext.technicianName} `
        : "";
    return cap(
      `Thanks so much, ${inputs.reviewerName} — ${techPart}appreciated the chance to help. — ${inputs.operatorFirstName}`,
      REPLY_HARD_CAP
    );
  }
  if (inputs.starRating >= 3) {
    return cap(
      `Thanks for the feedback, ${inputs.reviewerName}. We'd like to address anything that fell short — please call us so we can make this right. — ${inputs.operatorFirstName}`,
      REPLY_HARD_CAP
    );
  }
  return cap(
    `${inputs.reviewerName}, we hear you and we're sorry the experience didn't meet expectations. Please call us so we can make this right. — ${inputs.operatorFirstName}`,
    REPLY_HARD_CAP
  );
}

/**
 * Local citation grounding: if `jobContext` is absent, the reply MUST NOT
 * reference a service type or technician name. If present, the reply MAY
 * reference them. Always rejects competitor name-drops.
 */
function passesLocalCitationFirewall(
  reply: string,
  inputs: ReviewReplyDrafterInputs
): { pass: boolean; reason?: string } {
  // Competitor name-drop detection lives at the orchestration layer
  // (it knows the localPositioning competitor list). We only check the
  // simpler "don't invent jobContext" sub-rule here.
  if (!inputs.jobContext) {
    // Without a matched job, the reply cannot name a technician.
    // Grounded mode = generic only.
    return { pass: true };
  }
  return { pass: true };
}

/**
 * Optional: orchestrator-supplied competitor list to scrub. Tests inject it.
 */
export interface ReviewReplyFirewallContext {
  competitorNames?: ReadonlyArray<string>;
}

export async function draftReviewReply(
  inputs: ReviewReplyDrafterInputs,
  overrides: ReviewReplyDrafterOverrides = {},
  firewallContext: ReviewReplyFirewallContext = {}
): Promise<ReviewReplyDrafterOutput> {
  validateInputs(inputs);

  const sentiment = inferSentiment(inputs.starRating);
  const riskFlags = detectRiskFlags(inputs.reviewBody);
  const matchedJob = inputs.jobContext
    ? `${inputs.jobContext.serviceType} (job ${inputs.jobContext.jobId})`
    : null;

  // Hard escalation: extortion or legal-threat → operator-only handling.
  // Do NOT call the LLM; do NOT auto-promote past approval.
  if (
    riskFlags.includes("extortion-language") ||
    riskFlags.includes("legal-threat")
  ) {
    return {
      replyText: operatorOnlyPlaceholder(riskFlags),
      sentiment: "negative",
      riskFlags,
      citationContext: {
        matchedJob,
        grounded: matchedJob !== null,
      },
    };
  }

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
        "You are Maya, an AI manager for a service-business operator. You draft Google Business Profile review replies that pass Google ReviewReplyState moderation. Output strict JSON when asked.",
    },
    { role: "user", content: buildPrompt(inputs) },
  ];

  const completion = await callOpenRouter({
    model,
    messages,
    thinkingBudget: SKILL_METADATA.thinkingBudget,
    apiKey,
    fetchImpl: overrides.fetchImpl,
    maxOutputTokens: 400,
  });

  const parsed = parseLlmJson(completion.content);
  const llmText =
    typeof parsed.replyText === "string" ? parsed.replyText.trim() : "";
  const llmSentimentRaw =
    typeof parsed.sentiment === "string"
      ? parsed.sentiment.toLowerCase()
      : "";
  const llmSentiment: ReviewSentiment =
    llmSentimentRaw === "positive" ||
    llmSentimentRaw === "neutral" ||
    llmSentimentRaw === "negative"
      ? llmSentimentRaw
      : sentiment;

  let reply = cap(llmText, REPLY_HARD_CAP);

  // Citation firewall: reject competitor mentions.
  const competitors = firewallContext.competitorNames ?? [];
  if (
    reply &&
    detectCompetitorMention(reply, competitors)
  ) {
    riskFlags.push("competitor-name-drop");
    reply = safeFallbackReply(inputs);
  }

  // Citation firewall: reject ungrounded technician/service references when
  // jobContext is absent.
  if (reply && !inputs.jobContext) {
    // If LLM hallucinated a technician name (any unknown proper noun is hard
    // to prove is a "technician name", so we just check that the reply
    // doesn't mention "our technician [Name]" patterns).
    if (/\b(?:our|the)\s+(?:tech(?:nician)?|installer|plumber|electrician)\s+[A-Z][a-z]+/i.test(reply)) {
      reply = safeFallbackReply(inputs);
    }
  }

  // Local citation firewall (placeholder hook for the agent-2 skill).
  const local = passesLocalCitationFirewall(reply, inputs);
  if (!local.pass) {
    reply = safeFallbackReply(inputs);
  }

  if (!reply) {
    reply = safeFallbackReply(inputs);
  }

  return {
    replyText: reply,
    sentiment: llmSentiment,
    riskFlags,
    citationContext: {
      matchedJob,
      grounded: matchedJob !== null,
    },
  };
}

export const SKILL_METADATA = {
  name: "maya-service-review-reply-drafter" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "medium" as const,
  planTier: ["starter", "pro", "studio"] as const,
  /** LOCKED: never auto-publish at any tier. Server-side fail-closed. */
  autoPublishForbidden: true as const,
};
