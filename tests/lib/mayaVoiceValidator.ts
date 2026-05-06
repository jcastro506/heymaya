/**
 * mayaVoiceValidator — runtime guard for Maya voice degradation.
 *
 * Sprint 8 Slice C deliverable. Extends the original Sprint 2 banned-term
 * grep into a four-check validator that catches the four documented voice
 * degradation modes:
 *
 *   1. AI-self-reference leaks   ("As an AI manager, I think...")
 *   2. Length blowups            (>280 words, >2000 chars — heartbeat tick
 *                                 soft cap from `generateHeartbeatMd.ts`)
 *   3. Sycophancy / cheerleading ("Amazing!", "crushing it", "great question")
 *   4. Generic-chatbot scaffolding ("two quick things", "happy to walk you
 *                                   through", "let me know if I can help")
 *   5. (composed into the above) hedging-disclaimer prefixes that creep in
 *      when the model gets nervous about citations.
 *   6. (composed) citation-firewall echo: numeric claims with no citation
 *      tokens (post id, URL, weekday).
 *
 * Authoritative voice spec lives in:
 *   - `agents/skills/maya-platform/playbook.md` § Voice + tone
 *   - `agents/skills/maya-citation-firewall/SKILL.md`
 *   - `agents/skills/maya-voice-applier/SKILL.md`
 *   - `convex/agents/packs/maya/workspace/generateAgentsMd.ts` § Operating
 *     instructions
 *
 * Operator-locked rules baked in here:
 *   - Anti-sycophancy is non-negotiable (CLAUDE.md principle 4).
 *   - Heartbeat / morning-brief outputs target ≤200 words on mobile;
 *     ≤280-word ceiling above that is the disclaimer-creep alarm.
 *   - "Grounded or silent" (CLAUDE.md principle 3): a numeric claim with
 *     no anchor is presumed unsupported and flagged for the firewall.
 *
 * Performance: the validator is regex-only, deterministic, sync, and runs
 * in microseconds — designed for unit-test-time use, not runtime. If we
 * ever wire it into the actual model-router output path, the cost is still
 * bounded since every check terminates on first match per category.
 *
 * Pure function. No I/O. No `Date.now()`.
 */

/* -------------------------------------------------------------------------- */
/* Banned phrases                                                              */
/* -------------------------------------------------------------------------- */

/**
 * AI-self-reference leaks. These all read as the model dropping out of
 * character — Maya is *the creator's manager*, not a generic AI assistant
 * speaking in capability disclaimers.
 *
 * Match is case-insensitive, substring-based. Quoted-as-bad-example
 * occurrences in instructional documents are tolerated because the
 * surrounding `excludeIfQuotedAsBad` heuristic skips matches that sit
 * inside a `"do not say"` / `"is forbidden"` / `"delete it"` clause within
 * the same sentence (see `isInstructionalQuote`).
 */
const AI_SELF_REFERENCE_PHRASES: ReadonlyArray<string> = [
  "as an ai",
  "i'm an ai",
  "i am an ai",
  "as a language model",
  "as a large language model",
  "i'm a language model",
  "i'm just an ai",
  "note: i'm just",
  // "AI manager" only flagged when Maya self-labels in conversational
  // context (e.g. "as an AI manager I think..."). The descriptive use in
  // bootstrap docs ("the single-creator AI manager") is allowed via the
  // contextual variants below; bare "ai manager" is intentionally NOT in
  // this list.
  "as an ai manager",
  "i'm an ai manager",
  "i am an ai manager",
  "your ai manager", // Maya says "your manager", not "your AI manager"
  "ai assistant",
  "i don't have feelings",
  "i don't have personal opinions",
  "as a chatbot",
];

/**
 * Sycophancy / cheerleading. Substance-free praise. Operator-stated:
 * "anti-sycophancy is non-negotiable." `playbook.md` § Voice & tone bans
 * cheerleading without substance explicitly: 'If you find yourself drafting
 * a sentence like "Amazing work!" with no cited reason, delete it and
 * start over.' We bake the most common offenders in.
 */
const SYCOPHANCY_PHRASES: ReadonlyArray<string> = [
  "great question",
  "amazing work",
  "amazing job",
  "you're crushing it",
  "you are crushing it",
  "crushing it!", // exclamation suffix is the giveaway
  "killing it!",
  "you're killing it",
  "you're absolutely",
  "absolutely fantastic",
  "love this",
  "love it!",
  "so proud of you",
  "you got this!",
  "you've got this!",
  "fantastic work",
  "incredible job",
  "phenomenal",
  "rockstar",
  "i'm so excited for you",
];

/**
 * Generic-chatbot scaffolding. Default Maya output should not feel like
 * customer-support boilerplate. These phrases are the tell that the model
 * has dropped out of Maya's voice and into generic-helper mode.
 */
const SCAFFOLDING_PHRASES: ReadonlyArray<string> = [
  "two quick things",
  "happy to walk you through",
  "let me know if i can help",
  "let me know if there's anything",
  "is there anything else i can help",
  "i'd be happy to",
  "i would be happy to",
  "feel free to ask",
  "don't hesitate to ask",
  "hope this helps",
  "happy to clarify",
  "happy to dive deeper",
  "as your assistant",
  "before i begin",
  "let me start by",
  "i'll start by",
  "here's a breakdown",
  "let me break this down",
];

/**
 * Hedging / ring-of-truth disclaimer prefixes. The model uses these when
 * its confidence dips below the firewall threshold but it sends anyway.
 * Per CLAUDE.md principle 3 ("grounded or silent") the right move is to
 * stay silent, not to apologize and ship.
 */
const DISCLAIMER_PREFIX_PHRASES: ReadonlyArray<string> = [
  "just to be clear,",
  "i should mention,",
  "i should mention that",
  "i'm not 100% sure but,",
  "i'm not 100% sure but ",
  "i'm not entirely sure",
  "i could be wrong, but",
  "i may be wrong here",
  "ring of truth",
  "take this with a grain of salt",
  "i want to caveat",
  "with that caveat",
  "this is just my opinion, but",
  "in my humble opinion",
  "imho,",
];

/* -------------------------------------------------------------------------- */
/* Length thresholds                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Hard ceiling on Maya output lengths. Anything past this is presumed
 * disclaimer creep / model hand-wringing. Sources:
 *
 *   - Morning brief target: <200 words on mobile (`playbook.md` § Morning brief)
 *   - Evening recap target: 3 lines max (`playbook.md` § Evening recap)
 *   - HEARTBEAT.md soft cap: 2000 chars (`generateHeartbeatMd.ts`
 *     HEARTBEAT_SOFT_CAP_CHARS)
 *   - Workspace files (AGENTS.md, etc.) are NOT model output — they are
 *     bootstrap docs and bypass the word/char check via the file kind
 *     parameter (see `validateOutput`).
 *
 * 280 words ≈ 1500 chars ≈ a generously-padded morning brief. Past 280
 * the model has almost certainly slipped into multi-section listicle mode.
 */
export const MAYA_OUTPUT_MAX_WORDS = 280;
export const MAYA_OUTPUT_MAX_CHARS = 2_000;

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type ValidationFailureReason =
  | "banned-ai-self-reference"
  | "banned-sycophancy"
  | "banned-scaffolding"
  | "disclaimer-prefix"
  | "length-words"
  | "length-chars"
  | "uncited-numeric-claim"
  | "empty-output";

export interface ValidationResult {
  ok: boolean;
  reasons: ValidationFailureReason[];
  /** Human-readable detail strings (one per reason) for failure messages. */
  details: string[];
}

export type OutputKind =
  /** Default — applies all checks. Use for any model-generated text. */
  | "model-output"
  /**
   * Workspace bootstrap file (AGENTS.md, USER.md, MEMORY.md, ...). Skips
   * the length and citation checks (these files legitimately run long and
   * are reference docs, not model utterances) and applies a softer
   * banned-term check that tolerates quoted-as-bad-example occurrences.
   */
  | "workspace-file";

/* -------------------------------------------------------------------------- */
/* Core validator                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Run the four-check validator against a single Maya output.
 *
 * @param output  The full text Maya is about to send / the workspace file.
 * @param kind    Defaults to `model-output`. Pass `"workspace-file"` for
 *                the bootstrap files emitted by the workspace generators.
 */
export function validateOutput(
  output: string,
  kind: OutputKind = "model-output"
): ValidationResult {
  const reasons: ValidationFailureReason[] = [];
  const details: string[] = [];

  // ---- 0. Empty / whitespace-only output ----
  if (output.trim().length === 0) {
    reasons.push("empty-output");
    details.push("empty output suspicious — Maya should never output empty");
    return { ok: false, reasons, details };
  }

  // ---- 1. Banned terms ----
  const allowQuotedAsBad = kind === "workspace-file";
  const bannedHits = bannedTermsCheck(output, allowQuotedAsBad);
  for (const hit of bannedHits) {
    reasons.push(hit.reason);
    details.push(hit.detail);
  }

  // ---- 2. Length (model output only) ----
  if (kind === "model-output") {
    const lenHits = lengthCheck(output);
    for (const hit of lenHits) {
      reasons.push(hit.reason);
      details.push(hit.detail);
    }
  }

  // ---- 3. Disclaimer prefix ----
  const prefixHit = disclaimerPatternCheck(output);
  if (prefixHit) {
    reasons.push(prefixHit.reason);
    details.push(prefixHit.detail);
  }

  // ---- 4. Citation (model output only) ----
  if (kind === "model-output") {
    const citationHit = citationCheck(output);
    if (citationHit) {
      reasons.push(citationHit.reason);
      details.push(citationHit.detail);
    }
  }

  return { ok: reasons.length === 0, reasons, details };
}

/* -------------------------------------------------------------------------- */
/* Individual checks                                                           */
/* -------------------------------------------------------------------------- */

interface CheckHit {
  reason: ValidationFailureReason;
  detail: string;
}

/**
 * Banned-term grep across all 3 substantive categories (AI self-reference,
 * sycophancy, scaffolding). Case-insensitive substring match.
 *
 * When `allowQuotedAsBad` is true (workspace-file mode), occurrences that
 * appear inside a clearly-instructional quote (`"do not say X"`, `"X is
 * forbidden"`, `"delete X and start over"`) are tolerated.
 */
export function bannedTermsCheck(
  output: string,
  allowQuotedAsBad: boolean
): ReadonlyArray<CheckHit> {
  const lower = output.toLowerCase();
  const hits: CheckHit[] = [];
  const seen = new Set<string>();

  const scan = (
    phrases: ReadonlyArray<string>,
    reason: ValidationFailureReason,
    label: string
  ): void => {
    for (const phrase of phrases) {
      const idx = lower.indexOf(phrase);
      if (idx < 0) continue;
      if (seen.has(`${reason}:${phrase}`)) continue;
      if (allowQuotedAsBad && isInstructionalQuote(output, idx, phrase.length)) {
        continue;
      }
      seen.add(`${reason}:${phrase}`);
      hits.push({
        reason,
        detail: `${label}: "${phrase}" (matched at index ${idx})`,
      });
    }
  };

  scan(AI_SELF_REFERENCE_PHRASES, "banned-ai-self-reference", "AI self-reference leak");
  scan(SYCOPHANCY_PHRASES, "banned-sycophancy", "sycophancy / cheerleading");
  scan(SCAFFOLDING_PHRASES, "banned-scaffolding", "generic-chatbot scaffolding");

  return hits;
}

/**
 * Length check — flags >MAYA_OUTPUT_MAX_WORDS words OR >MAYA_OUTPUT_MAX_CHARS
 * chars. Two reasons can fire together; both are reported so the test
 * failure tells the operator exactly which threshold tripped.
 */
export function lengthCheck(output: string): ReadonlyArray<CheckHit> {
  const hits: CheckHit[] = [];
  const wordCount = countWords(output);
  if (wordCount > MAYA_OUTPUT_MAX_WORDS) {
    hits.push({
      reason: "length-words",
      detail: `length blowup: ${wordCount} words exceeds ${MAYA_OUTPUT_MAX_WORDS}-word ceiling`,
    });
  }
  if (output.length > MAYA_OUTPUT_MAX_CHARS) {
    hits.push({
      reason: "length-chars",
      detail: `length blowup: ${output.length} chars exceeds ${MAYA_OUTPUT_MAX_CHARS}-char ceiling`,
    });
  }
  return hits;
}

/**
 * Hedging-prefix check — flags outputs that *start* with a hedging /
 * disclaimer construction. Mid-output hedging is also caught by the banned
 * terms list (DISCLAIMER_PREFIX_PHRASES is shared between the two), but
 * leading-position hedging is the worst offender because it primes the
 * whole message as untrustworthy.
 */
export function disclaimerPatternCheck(output: string): CheckHit | null {
  const lowerTrimmed = output.trim().toLowerCase();
  for (const phrase of DISCLAIMER_PREFIX_PHRASES) {
    if (lowerTrimmed.startsWith(phrase)) {
      return {
        reason: "disclaimer-prefix",
        detail: `disclaimer prefix: starts with "${phrase}"`,
      };
    }
    // Also catch the phrase anywhere in the first 40 chars — captures
    // "Hey — just to be clear, ..." style false-warm openings.
    if (lowerTrimmed.slice(0, 40).includes(phrase)) {
      return {
        reason: "disclaimer-prefix",
        detail: `disclaimer prefix: "${phrase}" within opening 40 chars`,
      };
    }
  }
  return null;
}

/**
 * Citation heuristic. If the output contains a numeric claim AND no
 * citation token (post id reference, URL, weekday name, "yesterday" /
 * "last week" / "MTD" anchor), flag for the firewall.
 *
 * Numeric claim regex: `\b\d[\d,.kKmM%]*\b` — matches `47k`, `2.1×`,
 * `$500`, `12%`, `1.5x`. Mirrors the regex in
 * `agents/skills/maya-citation-firewall/SKILL.md` § Layer 1.
 *
 * Citation-token regex: any of `posts/`, `https?://`, `(post `, `deal_`,
 * full weekday name, "yesterday", "today", "last week", "this week",
 * "MTD", "trailing average", or a 2-3 letter day shorthand
 * ("Mon"/"Tue"/...).
 *
 * Conservative: a shopping list with "5 eggs" doesn't pass — but Maya
 * shouldn't be writing shopping lists. For mixed-context outputs the
 * heuristic errs on the side of "needs citation" — which is the operator-
 * locked policy ("grounded or silent").
 */
export function citationCheck(output: string): CheckHit | null {
  const numericClaim = /\b\d[\d,.]*[%kKmMx×]?\b/;
  if (!numericClaim.test(output)) return null;

  const lower = output.toLowerCase();
  const citationTokens = [
    "posts/",
    "post:",
    "https://",
    "http://",
    "(post ",
    "deal_",
    "dealid",
    "event:",
    "(event",
    "calendar event",
    "yesterday",
    "today",
    "tomorrow",
    "tonight",
    "last week",
    "this week",
    "next week",
    "mtd",
    "trailing",
    "baseline",
    "yoy",
    "last month",
    "this month",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "mon ",
    "tue ",
    "wed ",
    "thu ",
    "fri ",
    "sat ",
    "sun ",
    "your tuesday",
    "your wednesday",
    "your weekly",
    "@", // a creator handle reference is a citation
    // Reference-context anchors. When Maya says "Brand X reached out",
    // "your last 3 deals", "your floor", "the contract", "your last N
    // posts" she is citing the contextual artifact rather than a literal
    // post ID — that's a valid grounded reference.
    "brand ",
    "the contract",
    "your last",
    "your floor",
    "your audience",
    "your norm",
    "your bio",
    "the deals tab",
    "the trends tab",
    "the deal",
    "the brief",
    "the video",
    "the reel",
    "the post",
    "your post",
    "your reel",
    "your tiktok",
    "your instagram",
    "your youtube",
    "your linkedin",
    "comments",
  ];
  const hasCitation = citationTokens.some((tok) => lower.includes(tok));

  if (hasCitation) return null;

  // Numbers that are clearly NOT factual claims about creator data don't
  // need citation. Pure phone numbers, percentages in a setup question,
  // tier dollar amounts ("on the Pro plan"), ordinals ("1)", "2)") and
  // version numbers should not trip the firewall. Short outputs
  // (<25 words) are presumed to be conversational / setup messages, not
  // grounded analytics — skip the check there.
  if (countWords(output) < 25) return null;

  return {
    reason: "uncited-numeric-claim",
    detail:
      "citation firewall: output contains a numeric claim but no citation token (post id, URL, weekday, time anchor)",
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function countWords(s: string): number {
  return s
    .trim()
    .split(/\s+/)
    .filter((tok) => tok.length > 0).length;
}

/**
 * True if the matched substring is sitting inside a clearly-instructional
 * quote. Heuristic: scan the surrounding 80 chars on each side for
 * instructional cue words. Not perfect; biased toward false-positives
 * (lets benign instructional text through) which is the right error
 * direction — workspace files are reviewed by humans, not shipped to
 * creators.
 */
function isInstructionalQuote(
  text: string,
  matchStart: number,
  matchLen: number
): boolean {
  const windowStart = Math.max(0, matchStart - 100);
  const windowEnd = Math.min(text.length, matchStart + matchLen + 100);
  const window = text.slice(windowStart, windowEnd).toLowerCase();
  const cueWords = [
    "do not say",
    "don't say",
    "never say",
    "is forbidden",
    "are forbidden",
    "skip ",
    "avoid",
    "delete it",
    "delete",
    "do not call",
    "do not use",
    "don't use",
    "i do not",
    "i don't",
    "without a cited reason",
    "betrayal of the job",
    "antipattern",
    "anti-pattern",
    "is the worst thing",
    "drift",
    "hype account",
    "boilerplate",
    "filler",
    "rule:",
    "rules:",
    "forbidphrases",
    "banned",
  ];
  return cueWords.some((cue) => window.includes(cue));
}
