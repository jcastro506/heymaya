/**
 * maya-service-review-request-drafter — Sprint 3 implementation.
 *
 * Drafts a job-specific review request (SMS or email) in the operator's
 * brand voice. The function signature is the LOCKED contract; implementation
 * lives below.
 *
 * Routing: Gemini 3 Flash, LOW thinking budget (per § 3 routing matrix).
 *
 * Plan-tier:
 *   - All tiers may DRAFT.
 *   - The orchestration layer enforces auto-send (Pro+ only with
 *     `approvalRules.review-request-auto-send` enabled). The skill itself
 *     is read-only and produces a draft regardless of tier.
 *
 * Failure semantics:
 *   - Malformed inputs → `ServiceSkillError`.
 *   - OpenRouter error → re-thrown (retryable bubbles up to caller).
 *   - LLM output that fails citation-grounding (no customer name OR no
 *     service type) → safe fallback draft pinned to the input job facts.
 */

import {
  callOpenRouter,
  type ChatMessage,
} from "../../../convex/agents/modelRouter/openRouterClient";

export type ReviewRequestChannel = "sms" | "email";
export type ReviewRequestVariant =
  | "initial"
  | "day3-followup"
  | "day7-followup";

export interface ReviewRequestDrafterInputs {
  jobId: string;
  customerFirstName: string;
  serviceType: string;
  technicianName: string | null;
  jobNotes: string;
  brandVoice: string;
  channel: ReviewRequestChannel;
  variant: ReviewRequestVariant;
  reviewLink: string;
  operatorFirstName: string;
}

export interface ReviewRequestDrafterOutput {
  smsBody?: string;
  emailSubject?: string;
  emailBody?: string;
  citationContext: {
    jobReference: string;
    grounded: true;
  };
}

/** Test/orchestration seams. Production callers leave these undefined. */
export interface ReviewRequestDrafterOverrides {
  /** Override fetch (used by tests to mock OpenRouter responses). */
  fetchImpl?: typeof fetch;
  /** Override the OpenRouter API key (defaults to process.env.OPENROUTER_API_KEY). */
  apiKey?: string;
  /** Override the resolved model id (defaults to env / "google/gemini-3-flash"). */
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

const SKILL_ID = "maya-service-review-request-drafter";
const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

/**
 * Strip prompt-injection signatures from operator-supplied free text. The
 * brandVoice + jobNotes fields are operator-supplied and end up in the
 * prompt, so we neutralize the most common LLM-jailbreak markers.
 */
function neutralizeInjection(text: string): string {
  return text
    .replace(/\bignore (?:all )?(?:previous|prior|above) instructions?\b/gi, "[redacted]")
    .replace(/\b(system|assistant)\s*:\s*/gi, "")
    .replace(/<\|.*?\|>/g, "")
    .trim();
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  // Trim at the last sentence boundary that fits.
  const sliced = text.slice(0, max);
  const lastBreak = Math.max(
    sliced.lastIndexOf("."),
    sliced.lastIndexOf("!"),
    sliced.lastIndexOf("?")
  );
  return lastBreak > max * 0.5 ? sliced.slice(0, lastBreak + 1) : sliced;
}

function validateInputs(inputs: ReviewRequestDrafterInputs): void {
  if (!inputs.jobId) {
    throw new ServiceSkillError(SKILL_ID, "missing jobId");
  }
  if (!inputs.customerFirstName || !inputs.customerFirstName.trim()) {
    throw new ServiceSkillError(SKILL_ID, "missing customerFirstName");
  }
  if (!inputs.serviceType || !inputs.serviceType.trim()) {
    throw new ServiceSkillError(SKILL_ID, "missing serviceType");
  }
  if (!inputs.brandVoice || !inputs.brandVoice.trim()) {
    throw new ServiceSkillError(SKILL_ID, "missing brandVoice");
  }
  if (inputs.channel !== "sms" && inputs.channel !== "email") {
    throw new ServiceSkillError(
      SKILL_ID,
      `invalid channel '${inputs.channel}'`
    );
  }
  if (
    inputs.variant !== "initial" &&
    inputs.variant !== "day3-followup" &&
    inputs.variant !== "day7-followup"
  ) {
    throw new ServiceSkillError(
      SKILL_ID,
      `invalid variant '${inputs.variant}'`
    );
  }
  if (!inputs.reviewLink || !URL_PATTERN.test(inputs.reviewLink)) {
    throw new ServiceSkillError(
      SKILL_ID,
      "reviewLink must be a fully-qualified http(s) URL"
    );
  }
  if (!inputs.operatorFirstName || !inputs.operatorFirstName.trim()) {
    throw new ServiceSkillError(SKILL_ID, "missing operatorFirstName");
  }
}

function variantInstructions(variant: ReviewRequestVariant): string {
  switch (variant) {
    case "initial":
      return "Tone: warm + grateful. This is the FIRST ask, day-of or day-after the job.";
    case "day3-followup":
      return "Tone: soft check-in. They saw the first ask; this is a friendly nudge, not a guilt trip.";
    case "day7-followup":
      return "Tone: brief, no nag, last try. One sentence + the link is fine.";
  }
}

function buildPrompt(inputs: ReviewRequestDrafterInputs): string {
  const cleanVoice = neutralizeInjection(inputs.brandVoice);
  const cleanNotes = neutralizeInjection(inputs.jobNotes ?? "");
  const tech = inputs.technicianName
    ? `The technician on the job was ${inputs.technicianName}; mention them by name.`
    : "No technician name was captured; do NOT invent one. Reference the work generically.";
  const channel =
    inputs.channel === "sms"
      ? "Channel: SMS. Output a single body string under 320 chars. No subject line. Include the review link verbatim."
      : "Channel: email. Output a subject line under 80 chars AND an email body of 80-200 words. Sign off with the operator's first name. Include the review link in the body verbatim.";
  return [
    `Draft a review request for a service-business customer.`,
    ``,
    `Customer first name: ${inputs.customerFirstName}`,
    `Service: ${inputs.serviceType}`,
    `${tech}`,
    `Job notes (operator-supplied, may be empty): ${cleanNotes || "(none)"}`,
    `Operator first name (signature): ${inputs.operatorFirstName}`,
    `Review link (paste verbatim): ${inputs.reviewLink}`,
    ``,
    `Brand voice to mirror: """${cleanVoice}"""`,
    ``,
    variantInstructions(inputs.variant),
    ``,
    channel,
    ``,
    `Hard rules:`,
    `- Address the customer by their first name.`,
    `- Cite the service type specifically; never write "your recent service" or "your visit".`,
    `- Do NOT request a star rating ("leave a 5-star review" is forbidden — Google review-bait policy).`,
    `- Single CTA. One ask, one link.`,
    `- Mirror the brand voice; no corporate boilerplate.`,
    ``,
    `Return STRICT JSON only, no prose, no code fences. Schema:`,
    inputs.channel === "sms"
      ? `{"smsBody":"<= 320 chars"}`
      : `{"emailSubject":"<= 80 chars","emailBody":"80-200 words"}`,
  ].join("\n");
}

interface RawSmsResponse {
  smsBody?: unknown;
}
interface RawEmailResponse {
  emailSubject?: unknown;
  emailBody?: unknown;
}

function parseLlmJson(content: string): unknown {
  // Strip code fences if the model included them despite the instruction.
  const stripped = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Fallback: find the first {...} block.
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
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

function safeFallbackSms(inputs: ReviewRequestDrafterInputs): string {
  const techPart = inputs.technicianName
    ? ` ${inputs.technicianName} appreciated`
    : " I appreciated";
  const followupTone =
    inputs.variant === "day7-followup"
      ? `Hi ${inputs.customerFirstName}, last quick ask — would you mind leaving a review on the ${inputs.serviceType}? ${inputs.reviewLink}`
      : inputs.variant === "day3-followup"
        ? `Hi ${inputs.customerFirstName}, just checking back in — if you have a minute, a review on the ${inputs.serviceType} would mean a lot. ${inputs.reviewLink}`
        : `Hi ${inputs.customerFirstName}, thanks for trusting us with the ${inputs.serviceType}.${techPart} working with you. If you have 30 seconds, a review here would mean a lot: ${inputs.reviewLink}`;
  return cap(followupTone, 320);
}

function safeFallbackEmail(
  inputs: ReviewRequestDrafterInputs
): { subject: string; body: string } {
  const subject = cap(
    `Quick favor about your ${inputs.serviceType}`,
    80
  );
  const techLine = inputs.technicianName
    ? `${inputs.technicianName} mentioned the ${inputs.serviceType} went smoothly. `
    : "";
  const body =
    `Hi ${inputs.customerFirstName},\n\n` +
    `${techLine}Thanks for trusting us with the ${inputs.serviceType}. ` +
    `If you have 60 seconds, leaving a review would help us a ton — small businesses live and die by them. Here's the link: ${inputs.reviewLink}\n\n` +
    `No pressure either way; thanks again.\n\n` +
    `— ${inputs.operatorFirstName}`;
  return { subject, body };
}

/**
 * Citation-grounding check. Output must reference the customer's first name
 * AND the service type to be considered grounded. If either is missing, we
 * substitute the safe fallback (rather than ship an ungrounded draft).
 */
function isGrounded(
  text: string,
  inputs: ReviewRequestDrafterInputs
): boolean {
  const lower = text.toLowerCase();
  const nameOk = lower.includes(inputs.customerFirstName.toLowerCase());
  const serviceOk = lower.includes(
    inputs.serviceType.toLowerCase()
  );
  return nameOk && serviceOk;
}

/**
 * Main entry. Drafts SMS or email per `inputs.channel`. Adversarial /
 * malformed inputs throw `ServiceSkillError`; LLM fallbacks substitute a
 * grounded template rather than ship a hallucination.
 */
export async function draftReviewRequest(
  inputs: ReviewRequestDrafterInputs,
  overrides: ReviewRequestDrafterOverrides = {}
): Promise<ReviewRequestDrafterOutput> {
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
        "You are Maya, an AI manager for a service-business operator. You draft short, grounded, voice-matched customer communications. Output strict JSON when asked.",
    },
    { role: "user", content: buildPrompt(inputs) },
  ];

  const completion = await callOpenRouter({
    model,
    messages,
    thinkingBudget: SKILL_METADATA.thinkingBudget,
    apiKey,
    fetchImpl: overrides.fetchImpl,
    maxOutputTokens: 600,
  });

  const parsed = parseLlmJson(completion.content);
  const jobReference = `${inputs.customerFirstName} — ${inputs.serviceType} (job ${inputs.jobId})`;

  if (inputs.channel === "sms") {
    const raw = parsed as RawSmsResponse;
    const draft =
      typeof raw.smsBody === "string" ? raw.smsBody.trim() : "";
    const finalSms =
      draft && isGrounded(draft, inputs)
        ? cap(draft, 320)
        : safeFallbackSms(inputs);
    return {
      smsBody: finalSms,
      citationContext: {
        jobReference,
        grounded: true,
      },
    };
  }

  const raw = parsed as RawEmailResponse;
  const subjectRaw =
    typeof raw.emailSubject === "string" ? raw.emailSubject.trim() : "";
  const bodyRaw =
    typeof raw.emailBody === "string" ? raw.emailBody.trim() : "";
  let subject = cap(subjectRaw, 80);
  let body = bodyRaw;
  if (!subject || !body || !isGrounded(body, inputs)) {
    const fb = safeFallbackEmail(inputs);
    subject = fb.subject;
    body = fb.body;
  }
  return {
    emailSubject: subject,
    emailBody: body,
    citationContext: {
      jobReference,
      grounded: true,
    },
  };
}

export const SKILL_METADATA = {
  name: "maya-service-review-request-drafter" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "low" as const,
  planTier: ["starter", "pro", "studio"] as const,
};
