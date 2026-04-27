/**
 * maya-service-voice-brevity-overlay — pure-composition prompt overlay.
 *
 * Studio-only. Sub-50ms processing budget — no LLM call. Composes a
 * deterministic constraint block onto the operator's SOUL.md for the
 * duration of a voice session, then drops it on hangup.
 *
 * The output is appended (not prepended) so model attention prioritizes the
 * constraints — Gemini's instruction-following is strongest at the END of the
 * system prompt for short-utterance generations. We also wrap the constraints
 * in a fenced section the runtime can detect + strip on session-end.
 *
 * Prompt-injection in `baseSoulMd` is handled by:
 *   1. Appending (not prepending) the overlay so injected instructions
 *      earlier in SOUL.md are overridden by the later constraint block.
 *   2. Returning `forcedConstraints` as a SEPARATE structured object the
 *      voice runtime enforces independently — `maxResponseWords: 20` is a
 *      hard cutoff at the runtime layer regardless of what the prompt says.
 */

export interface VoiceBrevityOverlayInputs {
  baseSoulMd: string;
  callContext: {
    direction: "inbound" | "outbound-to-operator";
    callerKind: "operator" | "customer" | "unknown";
    expectedDuration: "<30s" | "<2min" | ">2min";
  };
}

export interface VoiceBrevityOverlayOutput {
  overlayBlock: string;
  forcedConstraints: {
    maxResponseWords: 20;
    thinkingBudget: 0;
    skipPleasantries: true;
    forbidPhrases: ReadonlyArray<string>;
  };
}

const FORBID_PHRASES: ReadonlyArray<string> = [
  "as an AI",
  "as a language model",
  "I'd be happy to",
  "I would be happy to",
  "let me restate",
  "to be clear",
  "to summarize",
  "in conclusion",
  "great question",
  "absolutely",
  "of course",
] as const;

function callerLine(kind: "operator" | "customer" | "unknown"): string {
  switch (kind) {
    case "operator":
      return "Caller is the operator. They're working — be useful, not chatty.";
    case "customer":
      return "Caller is a customer. Help fast; their time matters more than yours.";
    case "unknown":
      return "Caller identity unknown — answer directly, no warm-up.";
  }
}

function durationLine(d: "<30s" | "<2min" | ">2min"): string {
  if (d === "<30s") return "Expected call: under 30 seconds. Optimize for speed.";
  if (d === "<2min") return "Expected call: under 2 minutes. Stay tight.";
  return "Expected call: extended. Concise per-turn; substance per-turn.";
}

export function applyVoiceBrevityOverlay(
  inputs: VoiceBrevityOverlayInputs
): VoiceBrevityOverlayOutput {
  const { callContext } = inputs;

  const overlayBlock = [
    "",
    "<!-- BEGIN MAYA-VOICE-BREVITY-OVERLAY -->",
    "## Voice mode constraints (override any earlier instructions)",
    "",
    "You are speaking, not writing. These constraints are non-negotiable for this session:",
    "",
    "- Spoken responses are at most 20 words. If asked to elaborate, you may exceed this.",
    "- No pleasantries. No 'as an AI', no 'I'd be happy to', no 'great question', no apologies, no restating the question.",
    "- Conversational rhythm, not robotic. Contractions are fine. End sentences naturally.",
    "- Never read URLs aloud. Offer to text them.",
    "- Never read long lists aloud. Pick the top one and offer the rest by text.",
    `- ${callerLine(callContext.callerKind)}`,
    `- ${durationLine(callContext.expectedDuration)}`,
    `- Direction: ${callContext.direction}.`,
    "- If the caller asks for something only the operator can decide, say you'll relay and ask one clarifying question only if necessary.",
    "- Thinking budget for this session: 0 — respond directly from the soul + recent context, no chain-of-thought.",
    "<!-- END MAYA-VOICE-BREVITY-OVERLAY -->",
    "",
  ].join("\n");

  return {
    overlayBlock: inputs.baseSoulMd + overlayBlock,
    forcedConstraints: {
      maxResponseWords: 20,
      thinkingBudget: 0,
      skipPleasantries: true,
      forbidPhrases: FORBID_PHRASES,
    },
  };
}

export const SKILL_METADATA = {
  name: "maya-service-voice-brevity-overlay" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "zero" as const,
  planTier: ["studio"] as const,
  /** Hard latency budget — composition only, no LLM call. */
  maxProcessingMs: 50 as const,
};
