/**
 * No-CRM NER extractor — turn an operator's free-form text into a structured
 * `NormalizedJobEvent` so we can upsert `serviceJobs` + `serviceCustomers`
 * without a CRM webhook.
 *
 * Wave C / Sprint 4 — primary path for Persona A (Mike, 1-truck HVAC, no
 * FSM). Operator texts Maya: "just finished the Johnson kitchen sink at 432
 * Oak" → we extract `{customer_last_name: "Johnson", service_type: "kitchen
 * sink", address: "432 Oak", completedAt: now}`.
 *
 * Routing decision (per service plan § 7 dual-model architecture):
 *   - Task class: ROUTINE — short text, narrow output, no multi-hop reasoning.
 *   - Model:      Gemini 3.1 Flash Lite (`google/gemini-3.1-flash-lite` via
 *                  OpenRouter — the `.1` matters; `google/gemini-3-flash-lite`
 *                  returns 400 not-a-valid-model-id).
 *   - Thinking:   `none` — sub-300ms target on the in-thread message reply.
 *   - routedReason: "ner-routine-text-extraction"
 *
 * Service product breaks creator-product principle 7 (single brain). Every
 * action that calls the LLM tags itself with `modelTarget` + `thinkingBudget`
 * + `routedReason` so downstream cost/quality dashboards can attribute
 * regression to the routing decision.
 *
 * Why JSON-mode + a strict schema:
 *   - Operator text is messy (typos, abbreviations, partial info).
 *   - We need NULLABLE output for every field — never invent data.
 *   - The LLM is asked to return an explicit `{}` empty object when none of
 *     the fields can be confidently extracted.
 *
 * Hallucination guard: we apply a post-LLM substring check for the extracted
 * customer_last_name + service_type — if neither appears in the source text
 * (case-insensitive, fuzzy whitespace), we return `null` for that field.
 */

import {
  callOpenRouter,
  OpenRouterError,
} from "../../agents/modelRouter/openRouterClient";

/** Model id we route routine text-extraction tasks through. */
export const NER_MODEL_ID = "google/gemini-3.1-flash-lite";
export const NER_ROUTED_REASON = "ner-routine-text-extraction";

export interface NerExtractedFields {
  customer_last_name: string | null;
  customer_first_name: string | null;
  service_type: string | null;
  address: string | null;
  /** Epoch ms — defaults to "now" if the text says "just finished". Null if no time hint. */
  completed_at: number | null;
  /** Free-form notes the operator added beyond the 4 main fields. */
  notes: string | null;
}

export interface NerExtractorResult {
  fields: NerExtractedFields;
  /** Routing observability — written into the action's mayaActionLog row. */
  modelTarget: typeof NER_MODEL_ID;
  thinkingBudget: "none";
  routedReason: typeof NER_ROUTED_REASON;
  /** Latency in ms — used to assert the 1-second budget on the message-reply path. */
  latencyMs: number;
  /** Raw LLM response content for debugging. */
  rawContent: string;
}

const SYSTEM_PROMPT = `You are an information extractor for a home-service operator's text-message inbox. The operator just texted Maya (an AI assistant) about a job they completed or are working on. Extract structured fields about the customer and the job.

Rules:
- Return ONLY a JSON object. No markdown, no prose, no commentary.
- Use null (not empty string) for any field you cannot extract with confidence.
- Use the most-specific span the operator wrote. Do not paraphrase, do not synthesize, do not infer.
- service_type should be a short noun phrase the operator actually wrote (e.g. "kitchen sink", "AC tune-up", "yard cleanup"). Do NOT invent a category if the operator did not name one.
- customer_last_name should be the family name only. Strip honorifics (Mr/Mrs/Dr).
- address should include street number + street name if present. Do not invent city/zip.
- completed_at: return "now" (literal string) if the operator says "just finished" / "wrapped up" / "done with"; return null if no time hint.

JSON shape:
{
  "customer_last_name": string | null,
  "customer_first_name": string | null,
  "service_type": string | null,
  "address": string | null,
  "completed_at": "now" | null,
  "notes": string | null
}`;

interface RawLlmExtraction {
  customer_last_name?: string | null;
  customer_first_name?: string | null;
  service_type?: string | null;
  address?: string | null;
  completed_at?: string | null;
  notes?: string | null;
}

/**
 * Strict-parse the LLM's JSON output. Tolerates fenced code blocks (some
 * models wrap output in ```json ... ``` despite instructions).
 */
function parseLlmJson(content: string): RawLlmExtraction | null {
  const trimmed = content.trim();
  // Strip ```json ... ``` fences if present.
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as RawLlmExtraction;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Hallucination guard — case-insensitive substring check against the source
 * text after collapsing whitespace. Returns the value if it appears, else
 * null.
 */
function ensureSubstring(
  value: string | null | undefined,
  source: string
): string | null {
  if (!value || typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0) return null;
  const normSource = source.toLowerCase().replace(/\s+/g, " ");
  const normValue = v.toLowerCase().replace(/\s+/g, " ");
  if (normSource.includes(normValue)) return v;
  return null;
}

/**
 * Last-name special-case: an operator might write "the Johnsons" → we should
 * still resolve to "Johnson". Strip a trailing 's' if the substring check
 * succeeds with it stripped.
 */
function ensureLastName(
  value: string | null | undefined,
  source: string
): string | null {
  const direct = ensureSubstring(value, source);
  if (direct) return direct;
  if (!value) return null;
  const stripped = value.replace(/s$/i, "").trim();
  if (stripped.length === 0) return null;
  return ensureSubstring(stripped, source);
}

export interface ExtractServiceJobOpts {
  /** OpenRouter API key (caller resolves from env). */
  apiKey: string;
  /** Operator's text. Required, must be non-empty. */
  message: string;
  /** Test seam — defaults to global fetch via callOpenRouter. */
  fetchImpl?: typeof fetch;
  /** Test seam — disable retry sleep in tests. */
  retryDelayMs?: (attempt: number) => number;
  /** "Now" override for deterministic tests. */
  nowMs?: number;
}

/**
 * Run the NER extraction. Throws if `apiKey` missing or `message` blank.
 * Otherwise always returns a result — the inner `fields` may be all-null if
 * the operator's text is genuinely unparseable (graceful degradation).
 */
export async function extractServiceJobFromText(
  opts: ExtractServiceJobOpts
): Promise<NerExtractorResult> {
  if (!opts.apiKey) {
    throw new Error("extractServiceJobFromText: apiKey is required.");
  }
  if (!opts.message || opts.message.trim().length === 0) {
    throw new Error("extractServiceJobFromText: message is required.");
  }
  const message = opts.message.trim();

  const start = Date.now();
  let result;
  try {
    result = await callOpenRouter({
      model: NER_MODEL_ID,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
      thinkingBudget: "none",
      maxOutputTokens: 256,
      apiKey: opts.apiKey,
      fetchImpl: opts.fetchImpl,
      retryDelayMs: opts.retryDelayMs,
    });
  } catch (err) {
    if (err instanceof OpenRouterError) throw err;
    throw new Error(
      `extractServiceJobFromText: OpenRouter call failed: ${(err as Error).message}`
    );
  }
  const latencyMs = Date.now() - start;

  const parsed = parseLlmJson(result.content);
  const now = opts.nowMs ?? Date.now();

  const fields: NerExtractedFields = {
    customer_last_name: ensureLastName(parsed?.customer_last_name, message),
    customer_first_name: ensureSubstring(parsed?.customer_first_name, message),
    service_type: ensureSubstring(parsed?.service_type, message),
    address: ensureSubstring(parsed?.address, message),
    completed_at:
      parsed?.completed_at === "now"
        ? now
        : parsed?.completed_at && typeof parsed.completed_at === "string"
          ? (() => {
              const t = Date.parse(parsed.completed_at);
              return Number.isFinite(t) ? t : null;
            })()
          : null,
    // Notes is the only field where we DO accept LLM-synthesized text — it's
    // a free-form paraphrase, not a hallucination-sensitive structured field.
    notes:
      parsed?.notes && typeof parsed.notes === "string"
        ? parsed.notes.trim() || null
        : null,
  };

  return {
    fields,
    modelTarget: NER_MODEL_ID,
    thinkingBudget: "none",
    routedReason: NER_ROUTED_REASON,
    latencyMs,
    rawContent: result.content,
  };
}
