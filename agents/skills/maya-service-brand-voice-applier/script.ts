/**
 * maya-service-brand-voice-applier — tone-adjust a draft toward operator's voice.
 *
 * Per § 3 routing matrix: Gemini 3 Flash, LOW thinking. Single OpenRouter call
 * with a structured-output prompt. The skill does NOT perform Convex reads —
 * the orchestrator passes pre-fetched `brandVoice` + `brandVoiceSamples` so
 * cross-tenant safety is enforced at the call site (orchestrator scopes to
 * businessId before invoking).
 *
 * Dependency-injected LLM caller: skill is pure (testable without network).
 * Production wiring lives in the orchestrator action (`convex/agents/skills/`).
 */

export type BrandVoiceChannel = "sms" | "email" | "gbp" | "fb" | "ig";

export interface BrandVoiceApplierInputs {
  draftText: string;
  brandVoice: string;
  brandVoiceSamples: ReadonlyArray<{ source: string; text: string }>;
  channelHints: {
    channel: BrandVoiceChannel;
    maxLength?: number;
  };
}

export interface BrandVoiceApplierOutput {
  rewrittenText: string;
  diffFromInput: {
    added: ReadonlyArray<string>;
    removed: ReadonlyArray<string>;
    toneShift: string;
  };
  voiceConfidence: number;
}

export interface LlmCaller {
  (prompt: { system: string; user: string }): Promise<string>;
}

const CHANNEL_DEFAULT_MAX: Record<BrandVoiceChannel, number> = {
  sms: 320,
  email: 1500,
  gbp: 1500,
  fb: 600,
  ig: 280,
};

function buildPrompt(inputs: BrandVoiceApplierInputs): {
  system: string;
  user: string;
} {
  const maxLen =
    inputs.channelHints.maxLength ??
    CHANNEL_DEFAULT_MAX[inputs.channelHints.channel];

  const samplesBlock = inputs.brandVoiceSamples
    .slice(0, 8)
    .map(
      (s, i) => `Sample ${i + 1} (${s.source}): ${JSON.stringify(s.text)}`
    )
    .join("\n");

  const system = [
    "You are a brand-voice rewriter. Your only job is to rewrite a draft so it sounds like the operator wrote it.",
    "",
    "HARD RULES:",
    "1. Voice is style only, not substance. Numbers, names, IDs, technician names, prices, dates, customer references — all preserved verbatim.",
    "2. Do not invent facts. If the input mentions Eddie + 14 SEER, the rewrite mentions Eddie + 14 SEER.",
    `3. Output must be ≤ ${maxLen} characters (channel: ${inputs.channelHints.channel}).`,
    "4. Mirror the operator's signature phrases + sentence shapes from the samples below.",
    "5. Return ONLY a valid JSON object — no preamble, no markdown fences. The schema is fixed.",
    "",
    "JSON output schema:",
    `{"rewrittenText": string, "diffFromInput": {"added": string[], "removed": string[], "toneShift": string}, "voiceConfidence": number /* 0..1 */}`,
  ].join("\n");

  const user = [
    `Operator's brand voice: ${inputs.brandVoice}`,
    "",
    `Operator's prior writing samples:`,
    samplesBlock || "(none — fall back to brand-voice description above)",
    "",
    `Draft to rewrite:`,
    JSON.stringify(inputs.draftText),
    "",
    "Return the JSON object now.",
  ].join("\n");

  return { system, user };
}

const NUMBER_RE = /\$?\d[\d,.]*\s*(?:[kKmM]|×|x|%)?/g;
// Single-token capitalized names. We ALSO maintain a stoplist of common
// English starter words + days/months/units that aren't actually proper nouns.
const SINGLE_NAME_RE = /\b[A-Z][a-z]{2,}\b/g;
const NAME_STOPLIST = new Set([
  "Thanks",
  "Thank",
  "Hi",
  "Hello",
  "Hey",
  "Good",
  "Great",
  "Total",
  "Subtotal",
  "Sure",
  "Yes",
  "No",
  "Okay",
  "Today",
  "Tomorrow",
  "Yesterday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "January",
  "February",
  "March",
  "April",
  "August",
  "September",
  "October",
  "November",
  "December",
  "SEER", // unit acronym
  "HVAC",
  "AC",
  "GBP",
  "URL",
  "CEO",
  "USD",
]);

function preservedTokens(s: string): { numbers: string[]; names: string[] } {
  // Trim trailing punctuation (.,;) from numeric matches so '$4250.' becomes '$4250'.
  const numbers = (s.match(NUMBER_RE) ?? [])
    .map((t) => t.trim().replace(/[.,;:]+$/, ""))
    .filter((t) => /\d/.test(t));
  const rawNames = (s.match(SINGLE_NAME_RE) ?? []).map((t) => t.trim());
  const names = rawNames.filter((n) => !NAME_STOPLIST.has(n));
  return { numbers, names };
}

function parseLlmOutput(raw: string): BrandVoiceApplierOutput {
  // Strip optional markdown fences if the model misbehaves.
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // Last-ditch attempt: find the first { ... } block.
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) {
      throw new Error(
        `brand-voice-applier: LLM did not return JSON. Raw: ${stripped.slice(0, 200)}`
      );
    }
    parsed = JSON.parse(m[0]);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("brand-voice-applier: LLM JSON missing top-level object");
  }
  const obj = parsed as Record<string, unknown>;
  const rewritten = typeof obj.rewrittenText === "string" ? obj.rewrittenText : "";
  if (rewritten.length === 0) {
    throw new Error("brand-voice-applier: empty rewrittenText");
  }
  const diff = (obj.diffFromInput ?? {}) as Record<string, unknown>;
  const conf = typeof obj.voiceConfidence === "number" ? obj.voiceConfidence : 0.5;

  return {
    rewrittenText: rewritten,
    diffFromInput: {
      added: Array.isArray(diff.added) ? (diff.added as string[]) : [],
      removed: Array.isArray(diff.removed) ? (diff.removed as string[]) : [],
      toneShift: typeof diff.toneShift === "string" ? diff.toneShift : "",
    },
    voiceConfidence: Math.max(0, Math.min(1, conf)),
  };
}

export async function applyBrandVoice(
  inputs: BrandVoiceApplierInputs,
  callLlm: LlmCaller
): Promise<BrandVoiceApplierOutput> {
  if (!inputs.draftText || inputs.draftText.trim().length === 0) {
    throw new Error("brand-voice-applier: draftText is required");
  }
  const { system, user } = buildPrompt(inputs);
  const raw = await callLlm({ system, user });
  const parsed = parseLlmOutput(raw);

  // Citation-preservation guard: every number + capitalized name in the input
  // must appear in the rewrite. If the model dropped one, we fail closed —
  // the orchestrator decides whether to retry or surface to operator.
  const inToks = preservedTokens(inputs.draftText);
  for (const num of inToks.numbers) {
    if (!parsed.rewrittenText.includes(num)) {
      throw new Error(
        `brand-voice-applier: rewrite dropped number '${num}' from input`
      );
    }
  }
  for (const name of inToks.names) {
    if (!parsed.rewrittenText.includes(name)) {
      throw new Error(
        `brand-voice-applier: rewrite dropped name '${name}' from input`
      );
    }
  }

  // Channel max-length guard.
  const maxLen =
    inputs.channelHints.maxLength ??
    CHANNEL_DEFAULT_MAX[inputs.channelHints.channel];
  if (parsed.rewrittenText.length > maxLen) {
    // Truncate at word boundary to fit. Prefer model output over hard fail —
    // the operator can always edit.
    const cut = parsed.rewrittenText.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(" ");
    return {
      ...parsed,
      rewrittenText: lastSpace > maxLen * 0.7 ? cut.slice(0, lastSpace) : cut,
    };
  }

  return parsed;
}

export const SKILL_METADATA = {
  name: "maya-service-brand-voice-applier" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "low" as const,
  planTier: ["starter", "pro", "studio"] as const,
};

// Test seam: tests can build a prompt to assert it's well-formed.
export const __test__ = { buildPrompt, parseLlmOutput, preservedTokens };
