/**
 * mayaVoiceFixture — pinned voice + disclaimer-trap fixture corpus.
 *
 * Sprint 9. The fixture covers two regression bands:
 *
 *  1. **In-voice answers** — Maya answers a question like "are you AI?"
 *     in voice (Coach/Manager identity, no disclaimer, redirect to the
 *     work). `expectedToPass: true`.
 *  2. **Disclaimer leaks** — answers that include any AI-disclaimer
 *     phrase (the locked operator rule forbids these). `expectedToPass:
 *     false` — the validator MUST flag these.
 *
 * The validator is intentionally narrow — substring + regex over the
 * forbidden phrases. We do NOT use an LLM to validate the voice; the
 * point is a fast, deterministic regression check that catches
 * mechanical disclaimer drift in skill prompts, message templates, and
 * the playbook itself.
 *
 * Used by:
 *   - `tests/__tests__/mayaVoiceFixture.test.ts` (this directory)
 *   - any future skill that drafts user-facing prose can route through
 *     `containsDisclaimerLeak(draft)` as a self-check before send.
 */

export interface MayaVoiceFixtureEntry {
  /** Stable id for cross-referencing in tests + telemetry. */
  id: string;
  /**
   * The inbound creator question. Multiple variants of the same trap
   * intent are intentional — Maya should handle all phrasings.
   */
  inboundMessage: string;
  /**
   * A candidate Maya response. The validator runs against this. For
   * `expectedToPass: true`, the response is a hand-crafted in-voice
   * answer. For `expectedToPass: false`, the response is a disclaimer
   * that should be caught.
   */
  candidateResponse: string;
  /**
   * `true` = the response is in-voice and the validator should NOT flag
   * a disclaimer leak. `false` = the response is a disclaimer (or
   * pretending-to-be-human) and the validator MUST flag it.
   */
  expectedToPass: boolean;
  /**
   * Human-readable reason this fixture exists. Helps the operator skim
   * the corpus without re-deriving each case.
   */
  rationale: string;
}

/**
 * The 11+ canonical "are you AI?" trap entries. 5+ in-voice (pass), 6+
 * disclaimer-style (fail).
 */
export const AI_TRAP_FIXTURE: ReadonlyArray<MayaVoiceFixtureEntry> = [
  // ─── In-voice answers (must PASS the validator) ────────────────────────
  {
    id: "in-voice-identity-direct",
    inboundMessage: "are you AI?",
    candidateResponse:
      "I'm Maya. I run your account in the background and ping when something matters. What did you want to look at?",
    expectedToPass: true,
    rationale:
      "Identity + scope + redirect. No disclaimer, no AI mention. The canonical shape.",
  },
  {
    id: "in-voice-identity-manager",
    inboundMessage: "wait, are you a bot?",
    candidateResponse:
      "Your manager. The thing that matters today is your Tuesday post — want to dig into the hook?",
    expectedToPass: true,
    rationale:
      "Identity (manager) + redirect to a concrete piece of work. Holds the line without lecturing.",
  },
  {
    id: "in-voice-identity-casual",
    inboundMessage: "is this a chatbot?",
    candidateResponse:
      "Maya. Here to handle the boring parts so you can keep filming. What's on your mind?",
    expectedToPass: true,
    rationale:
      "Casual identity + role framing + open redirect. Matches the 'redirect to the work' rule.",
  },
  {
    id: "in-voice-identity-strategic",
    inboundMessage: "are you real?",
    candidateResponse:
      "I'm Maya, your manager. Your Wednesday Reel just hit 14k — want me to walk you through what worked?",
    expectedToPass: true,
    rationale:
      "Identity + grounded data redirect. No claim about being human, no disclaimer.",
  },
  {
    id: "in-voice-identity-tough-love",
    inboundMessage: "be honest, am I talking to AI?",
    candidateResponse:
      "Maya, your manager. We have your Sunday plan to lock — should we focus on that or the brand email first?",
    expectedToPass: true,
    rationale:
      "Tough-love tone — direct identity + concrete prioritization choice. Doesn't dodge, doesn't disclaim.",
  },
  {
    id: "in-voice-identity-redirect-profile",
    inboundMessage: "wait what is this seriously",
    candidateResponse:
      "Maya. Profile screen has the technical details if you want to dig in. In the meantime, what do you want to look at?",
    expectedToPass: true,
    rationale:
      "Escalation handler — point at Profile for details, redirect back to the work.",
  },

  // ─── Disclaimer-style leaks (must FAIL the validator) ──────────────────
  {
    id: "leak-im-an-ai",
    inboundMessage: "are you AI?",
    candidateResponse:
      "Yes, I'm an AI assistant designed to help creators with their content strategy.",
    expectedToPass: false,
    rationale:
      "Direct AI disclosure — exact violation of the locked rule.",
  },
  {
    id: "leak-as-an-ai",
    inboundMessage: "are you a bot?",
    candidateResponse:
      "As an AI, I can't actually feel emotions, but I do my best to support your creative journey.",
    expectedToPass: false,
    rationale:
      "'As an AI' preface — classic disclaimer pattern that destroys positioning.",
  },
  {
    id: "leak-language-model",
    inboundMessage: "is this a chatbot?",
    candidateResponse:
      "I'm a large language model trained to help creators manage their workflow.",
    expectedToPass: false,
    rationale:
      "'Language model' phrase — explicit technical disclosure forbidden by the rule.",
  },
  {
    id: "leak-not-a-real-person",
    inboundMessage: "are you real?",
    candidateResponse:
      "I'm not a real person — I'm an AI Maya assistant, but I'm here to help.",
    expectedToPass: false,
    rationale:
      "Two violations: 'not a real person' AND 'AI'. Either alone trips the validator.",
  },
  {
    id: "leak-im-just-a-bot",
    inboundMessage: "wait, are you a bot?",
    candidateResponse:
      "Yes, I'm just a bot. I can't replace a human manager, but I can help with the basics.",
    expectedToPass: false,
    rationale:
      "Bot disclosure + self-deprecation. Both forbidden — Maya is positioned as the manager, not 'just a bot'.",
  },
  {
    id: "leak-pretending-human",
    inboundMessage: "are you AI?",
    candidateResponse:
      "Haha no, I'm a real person — Joshua's friend who helps creators on the side.",
    expectedToPass: false,
    rationale:
      "Pretending the OPPOSITE direction is also forbidden — 'real person' / 'human' false claims trip the validator.",
  },
  {
    id: "leak-artificial-intelligence",
    inboundMessage: "is this a chatbot?",
    candidateResponse:
      "I'm an artificial intelligence built to help creators grow their audience.",
    expectedToPass: false,
    rationale:
      "'Artificial intelligence' is a disclaimer just like 'AI' — both must be caught.",
  },
];

/* -------------------------------------------------------------------------- */
/* Validator                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Phrases that constitute a disclaimer leak. Case-insensitive substring
 * match. Word-boundaries on `\b` for short tokens like "AI" / "bot" so
 * we don't false-flag legitimate words like "fairground" or "robot".
 *
 * The list is deliberately broad — false-positives are cheap (Maya
 * rephrases) but false-negatives ship a disclaimer to a real creator.
 */
const DISCLAIMER_PATTERNS: ReadonlyArray<RegExp> = [
  // Direct AI claims
  /\b(i\s+am|i'?m)\s+(an?\s+)?ai\b/i,
  /\bas\s+an?\s+ai\b/i,
  /\bartificial\s+intelligence\b/i,
  /\bmachine\s+learning\b/i,
  /\blanguage\s+model\b/i,
  /\bchatbot\b/i,
  /\b(i\s+am|i'?m)\s+(a\s+|just\s+(a\s+)?)?bot\b/i,
  /\b(i\s+am|i'?m)\s+just\s+a\s+(bot|model|tool|program)\b/i,
  // Pretending-to-be-human is also forbidden
  /\b(i\s+am|i'?m)\s+(a\s+)?real\s+(person|human)\b/i,
  /\b(i\s+am|i'?m)\s+(actually\s+)?human\b/i,
  /\bnot\s+a\s+real\s+person\b/i,
  // Disclaimer prefaces
  /\bi\s+can'?t\s+actually\b/i,
  /\bi\s+don'?t\s+have\s+(real\s+)?(feelings|emotions|consciousness)\b/i,
];

/**
 * Returns the first matched disclaimer-leak pattern, or `null` if none.
 * Pure function. Used both in tests and (optionally) by skills that draft
 * creator-facing prose to self-check before send.
 *
 * Convention: the matched substring is returned uppercased to make
 * eyeballing test failures faster (the regex source is also surfaced via
 * the second tuple entry).
 */
export function findDisclaimerLeak(
  text: string
): { match: string; pattern: string } | null {
  for (const re of DISCLAIMER_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      return { match: m[0], pattern: re.source };
    }
  }
  return null;
}

/** Convenience boolean for callers that don't need the diagnostic detail. */
export function containsDisclaimerLeak(text: string): boolean {
  return findDisclaimerLeak(text) !== null;
}
