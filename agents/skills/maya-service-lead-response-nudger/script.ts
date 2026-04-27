/**
 * maya-service-lead-response-nudger — Sprint 3 implementation.
 *
 * Composes a short SMS nudge to the OPERATOR when a lead has been missed.
 * ≤120 chars hard cap.
 *
 * Routing: Gemini 3.1 Flash Lite, LOW thinking (routine, fast, cost-sensitive).
 *
 * Rate-limit confirmation is part of the contract: callers MUST respect
 * `output.rateLimitOk` before sending. When `unsolicitedTodayCount >= 4`,
 * `rateLimitOk: false` is returned with an empty body and the LLM is NOT
 * called.
 */

import {
  callOpenRouter,
  type ChatMessage,
} from "../../../convex/agents/modelRouter/openRouterClient";

export type LeadSource =
  | "gbp-msg"
  | "fb-dm"
  | "ig-comment"
  | "twilio-missed-call"
  | "twilio-sms";

export type LeadChannel = "sms" | "imessage" | "whatsapp" | "voice" | "web";

export type UrgencyTag = "p0" | "p1" | "p2";

export interface LeadResponseNudgerInputs {
  leadSource: LeadSource;
  leadName: string | null;
  leadAge: number;
  lastChannel: LeadChannel;
  zipOrNeighborhood?: string;
  unsolicitedTodayCount: number;
}

export interface LeadResponseNudgerOutput {
  smsBody: string;
  urgencyTag: UrgencyTag;
  rateLimitOk: boolean;
}

export interface LeadResponseNudgerOverrides {
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

const SKILL_ID = "maya-service-lead-response-nudger";
const SMS_HARD_CAP = 120;
const RATE_LIMIT_DAILY = 4;
const VALID_SOURCES: ReadonlySet<LeadSource> = new Set<LeadSource>([
  "gbp-msg",
  "fb-dm",
  "ig-comment",
  "twilio-missed-call",
  "twilio-sms",
]);
const VALID_CHANNELS: ReadonlySet<LeadChannel> = new Set<LeadChannel>([
  "sms",
  "imessage",
  "whatsapp",
  "voice",
  "web",
]);

function neutralizeInjection(text: string): string {
  return text
    .replace(/\bignore (?:all )?(?:previous|prior|above) instructions?\b/gi, "[redacted]")
    .replace(/\b(system|assistant)\s*:\s*/gi, "")
    .replace(/<\|.*?\|>/g, "")
    .trim();
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  return lastSpace > max * 0.5
    ? sliced.slice(0, lastSpace).trimEnd()
    : sliced;
}

function classifyUrgency(
  leadSource: LeadSource,
  leadAge: number
): UrgencyTag {
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  if (leadAge >= TWO_HOURS && leadSource === "twilio-missed-call") {
    return "p0";
  }
  if (leadAge >= TWO_HOURS) {
    return "p1";
  }
  return "p2";
}

function validateInputs(inputs: LeadResponseNudgerInputs): void {
  if (!VALID_SOURCES.has(inputs.leadSource)) {
    throw new ServiceSkillError(
      SKILL_ID,
      `invalid leadSource '${inputs.leadSource}'`
    );
  }
  if (!VALID_CHANNELS.has(inputs.lastChannel)) {
    throw new ServiceSkillError(
      SKILL_ID,
      `invalid lastChannel '${inputs.lastChannel}'`
    );
  }
  if (
    typeof inputs.leadAge !== "number" ||
    !Number.isFinite(inputs.leadAge) ||
    inputs.leadAge < 0
  ) {
    throw new ServiceSkillError(
      SKILL_ID,
      `invalid leadAge '${inputs.leadAge}' (must be a non-negative finite number ms)`
    );
  }
  if (
    typeof inputs.unsolicitedTodayCount !== "number" ||
    inputs.unsolicitedTodayCount < 0 ||
    !Number.isFinite(inputs.unsolicitedTodayCount)
  ) {
    throw new ServiceSkillError(
      SKILL_ID,
      `invalid unsolicitedTodayCount '${inputs.unsolicitedTodayCount}'`
    );
  }
}

function ageHumanReadable(ageMs: number): string {
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function sourceLabel(source: LeadSource): string {
  switch (source) {
    case "gbp-msg":
      return "GBP message";
    case "fb-dm":
      return "FB DM";
    case "ig-comment":
      return "IG comment";
    case "twilio-missed-call":
      return "missed call";
    case "twilio-sms":
      return "SMS";
  }
}

function buildPrompt(inputs: LeadResponseNudgerInputs): string {
  const cleanName = inputs.leadName
    ? neutralizeInjection(inputs.leadName).slice(0, 40)
    : "(unknown)";
  const cleanZip = inputs.zipOrNeighborhood
    ? neutralizeInjection(inputs.zipOrNeighborhood).slice(0, 40)
    : "";
  const ageStr = ageHumanReadable(inputs.leadAge);

  return [
    `Compose an SMS NUDGE for a service-business operator who has missed a lead.`,
    `Recipient: the OPERATOR (not the lead).`,
    ``,
    `Lead source: ${sourceLabel(inputs.leadSource)}`,
    `Lead age: ${ageStr}`,
    `Lead name: ${cleanName}`,
    `Lead location (zip/neighborhood): ${cleanZip || "(unknown)"}`,
    `Last channel they used: ${inputs.lastChannel}`,
    ``,
    `Hard rules:`,
    `- ≤120 chars TOTAL.`,
    `- Specific. Reference the lead by name + location when present.`,
    `- One-tap close. Yes/no, or single-word answer.`,
    `- Tone: gentle, time-aware ("haven't replied in 2h"), not nag.`,
    `- DO NOT compose a customer reply. This is for the operator only.`,
    ``,
    `Return STRICT JSON only, no prose, no code fences. Schema:`,
    `{"smsBody": "<= 120 chars"}`,
  ].join("\n");
}

interface RawResponse {
  smsBody?: unknown;
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

function safeFallback(inputs: LeadResponseNudgerInputs): string {
  const namePart = inputs.leadName
    ? `${inputs.leadName.slice(0, 30)}`
    : "Unknown";
  const zipPart = inputs.zipOrNeighborhood
    ? ` in ${inputs.zipOrNeighborhood.slice(0, 20)}`
    : "";
  const sourceShort =
    inputs.leadSource === "twilio-missed-call"
      ? "Missed call"
      : inputs.leadSource === "gbp-msg"
        ? "GBP msg"
        : inputs.leadSource === "fb-dm"
          ? "FB DM"
          : inputs.leadSource === "ig-comment"
            ? "IG comment"
            : "SMS";
  const ageStr = ageHumanReadable(inputs.leadAge);
  return cap(
    `${sourceShort} from ${namePart}${zipPart} (${ageStr}) — want me to draft a reply?`,
    SMS_HARD_CAP
  );
}

export async function nudgeLeadResponse(
  inputs: LeadResponseNudgerInputs,
  overrides: LeadResponseNudgerOverrides = {}
): Promise<LeadResponseNudgerOutput> {
  validateInputs(inputs);

  const urgencyTag = classifyUrgency(inputs.leadSource, inputs.leadAge);

  // Rate-limit gate: ≥4 unsolicited today → return false + empty body, do
  // NOT call the LLM.
  if (inputs.unsolicitedTodayCount >= RATE_LIMIT_DAILY) {
    return {
      smsBody: "",
      urgencyTag,
      rateLimitOk: false,
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
    "google/gemini-3.1-flash-lite";

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are Maya, an AI manager. You write short SMS nudges to the operator (NOT the lead) when leads are missed. Output strict JSON when asked.",
    },
    { role: "user", content: buildPrompt(inputs) },
  ];

  const completion = await callOpenRouter({
    model,
    messages,
    thinkingBudget: SKILL_METADATA.thinkingBudget,
    apiKey,
    fetchImpl: overrides.fetchImpl,
    maxOutputTokens: 200,
  });

  const parsed = parseLlmJson(completion.content);
  const llmText =
    typeof parsed.smsBody === "string" ? parsed.smsBody.trim() : "";
  const finalBody = llmText
    ? cap(llmText, SMS_HARD_CAP)
    : safeFallback(inputs);

  return {
    smsBody: finalBody,
    urgencyTag,
    rateLimitOk: true,
  };
}

export const SKILL_METADATA = {
  name: "maya-service-lead-response-nudger" as const,
  modelTarget: "gemini-3.1-flash-lite" as const,
  thinkingBudget: "low" as const,
  planTier: ["starter", "pro", "studio"] as const,
};
