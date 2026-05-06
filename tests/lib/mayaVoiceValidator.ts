/**
 * mayaVoiceValidator — runtime guard for Maya voice degradation.
 *
 * Sprint 8 Slice C deliverable, extended in Sprint 9.7 (2026-05-06) with
 * the per-message length cap, the no-jargon check, and the anti-fabrication
 * pattern check after a real-world test where Maya's first iMessage came
 * out as a 700-char marketing-pitch novel with a fabricated "50/50 UK/US"
 * stat and a pile of creator-jargon.
 *
 * Six checks now:
 *
 *   1. AI-self-reference leaks   ("As an AI manager, I think...")
 *   2. Length blowups            (>280 words OR >400 chars — operator-locked
 *                                 per-message cap, was 2000 pre-9.7)
 *   3. Sycophancy / cheerleading ("Amazing!", "crushing it", "great question")
 *   4. Generic-chatbot scaffolding ("two quick things", "happy to walk you
 *                                   through", "let me know if I can help")
 *   5. (composed into the above) hedging-disclaimer prefixes that creep in
 *      when the model gets nervous about citations.
 *   6. (composed) citation-firewall echo: numeric claims with no citation
 *      tokens (post id, URL, weekday).
 *   7. (Sprint 9.7) jargonCheck — flags creator-jargon and corporate-speak
 *      that read corny in a text. Operator's spec: "Maya doesn't speak in
 *      technical language. Everything she says should sound human."
 *   8. (Sprint 9.7) fabricationCheck — flags invented precision: percentages
 *      attached to ranked-list data ("audience is split 50/50 UK/US"
 *      where the data is `topGeos: ['UK', 'US']`).
 *
 * Authoritative voice spec lives in:
 *   - `agents/skills/maya-platform/playbook.md` § Voice + tone
 *   - `agents/skills/maya-citation-firewall/SKILL.md`
 *   - `agents/skills/maya-voice-applier/SKILL.md`
 *   - `agents/skills/maya-picture-verifier/SKILL.md` § Anti-fabrication
 *   - `convex/agents/packs/maya/workspace/generateSoulMd.ts` § Anti-
 *     fabrication + Human language only
 *   - `convex/agents/packs/maya/workspace/generateAgentsMd.ts` § Operating
 *     instructions
 *
 * Operator-locked rules baked in here:
 *   - Anti-sycophancy is non-negotiable (CLAUDE.md principle 4).
 *   - Per-message cap is 400 chars (Sprint 9.7, operator-locked).
 *     Multi-message arcs send N separate `claw-messenger.sendText` calls,
 *     each ≤400 chars, instead of one 2000-char wall.
 *   - "Grounded or silent" (CLAUDE.md principle 3): a numeric claim with
 *     no anchor is presumed unsupported and flagged for the firewall.
 *   - "Human language only": no creator-jargon, no coach-speak, no
 *     corporate-strategy register.
 *   - "Anti-fabrication": never invent precise numbers. Ranked lists are
 *     not percentages. (The validator catches the obvious patterns; the
 *     load-bearing rule lives in SOUL.md where Maya reads it.)
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
 * Creator-jargon and corporate-speak. Sprint 9.7 — added after a real-world
 * test where Maya's first iMessage included "first-frame visual clarity",
 * "global FYP", "share metrics", "anchor questions", "brand-deal matching",
 * "operational weight", and "lock in your strategy" in a single 700-char
 * message. All of these read corny in a text. Operator's rule: "Maya
 * doesn't speak in technical language. Everything she says should sound
 * human and understandable."
 *
 * The list is intentionally focused — these are the actual offenders from
 * the live test plus the obvious creator-jargon adjacents (KPI, value
 * prop, north star metric, etc.). The load-bearing rule with full prose
 * alternatives lives in SOUL.md "Human language only" — this list is the
 * mechanical-correctness backstop.
 *
 * Match is case-insensitive substring. Workspace-file mode tolerates
 * quoted-as-bad-example occurrences via the same `isInstructionalQuote`
 * heuristic that protects the other banned-term lists — SOUL.md teaches
 * the rule by NAMING the jargon it forbids, so the doc itself contains
 * the substrings.
 */
const JARGON_PHRASES: ReadonlyArray<string> = [
  // FYP / For You Page — creator jargon. Maya says "the For You feed" or
  // just "the feed."
  "fyp",
  "for you page",
  "global fyp",
  // Metric-jargon. Maya says "people sharing", "people engaging", "saves".
  "share metric",
  "share metrics",
  "engagement metric",
  "engagement metrics",
  "metric-driven",
  "key driver",
  // Visual / production jargon. Maya says "a strong first second" /
  // "clear visual right at the open."
  "first-frame",
  "first frame visual",
  "visual clarity",
  // Coach-speak / framework labels. Maya just calls them questions.
  "anchor question",
  "anchor questions",
  // Operational / pitch register. Maya says "matching you with brands",
  // "the day-to-day stuff", "figure out the plan."
  "brand-deal matching",
  "operational weight",
  "lock in your strategy",
  "lock in the strategy",
  "strategic alignment",
  // Corporate-deck register.
  "value prop",
  "kpi",
  "kpis",
  "north star metric",
  "north-star metric",
  "optimization",
  "optimisation",
];

/**
 * Internal data-structure / workspace-file names. These are dev-side
 * documentation Maya reads — but if she echoes them to the creator, the
 * human voice shatters. Only banned in `kind: "model-output"` mode;
 * workspace-file mode tolerates them since the workspace files literally
 * have these in their H1 headers and cross-references.
 *
 * Sprint 9.7+ — split out from JARGON_PHRASES after a real-world test
 * surfaced "[source: creatorPicture]" leaking into a creator-facing
 * iMessage. The validator was correctly catching it as banned-jargon, but
 * the workspace generators (AGENTS.md, USER.md, etc.) tripped the same
 * check on their own headers. Scoping these to model-output-only fixes
 * both — creator messages stay clean, generator outputs validate.
 */
const INTERNAL_NAME_PHRASES: ReadonlyArray<string> = [
  "[source:",
  "creatorpicture",
  "memory.md",
  "soul.md",
  "user.md",
  "agents.md",
  "identity.md",
  "heartbeat.md",
  "boot.md",
  "tools.md",
  "dreaming.md",
  "standing-orders.md",
  "voicefingerprint",
  "audience.topgeos",
  "audience.ageranges",
  "boundaries.banned_topics",
  "needsverification",
  "openinganswers",
  "creatorhandles",
  "postmetrics",
  "dailybriefs",
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
 * disclaimer creep / model hand-wringing / multi-message bundling. Sources:
 *
 *   - Operator-locked per-message cap (Sprint 9.7): 400 chars per single
 *     `claw-messenger.sendText` call. iMessage UX is short rapid-fire
 *     messages, not walls of text. A first-boot greet+insight+Q1 arc
 *     becomes THREE separate sends, each ≤400 chars.
 *   - Morning brief target: <200 words on mobile (`playbook.md` § Morning
 *     brief)
 *   - Evening recap target: 3 lines max (`playbook.md` § Evening recap)
 *   - Workspace files (AGENTS.md, etc.) are NOT model output — they are
 *     bootstrap docs and bypass the word/char check via the file kind
 *     parameter (see `validateOutput`).
 *
 * 280-word ceiling stays as a defense-in-depth guardrail (kept from
 * Sprint 8). A single creator-facing iMessage shouldn't be anywhere near
 * 280 words anyway — it would have already tripped the 400-char cap. The
 * word check still catches whitespace-light walls of text that scrape
 * under the char cap by stripping spaces.
 */
export const MAYA_OUTPUT_MAX_WORDS = 280;
export const MAYA_OUTPUT_MAX_CHARS = 400;

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type ValidationFailureReason =
  | "banned-ai-self-reference"
  | "banned-sycophancy"
  | "banned-scaffolding"
  | "banned-jargon"
  | "disclaimer-prefix"
  | "length-words"
  | "length-chars"
  | "uncited-numeric-claim"
  | "fabricated-precision"
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

  // ---- 5. Jargon (Sprint 9.7) ----
  // Workspace-file mode tolerates quoted-as-bad-example occurrences (SOUL.md
  // teaches the rule by naming the forbidden jargon).
  const jargonHits = jargonCheck(output, allowQuotedAsBad);
  for (const hit of jargonHits) {
    reasons.push(hit.reason);
    details.push(hit.detail);
  }

  // ---- 6. Fabrication (Sprint 9.7, model output only) ----
  // Picks up "split 50/50" / "60/40 UK/US" patterns where Maya invents
  // a precision the data doesn't support. Workspace files don't speak
  // about specific creator data so the check is gated on model-output.
  if (kind === "model-output") {
    const fabricationHit = fabricationCheck(output);
    if (fabricationHit) {
      reasons.push(fabricationHit.reason);
      details.push(fabricationHit.detail);
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

/**
 * Jargon check (Sprint 9.7) — flags creator-jargon and corporate-speak
 * substrings. Word-boundary-style matching for short tokens (FYP, KPI,
 * KPIs) so we don't flag legitimate words that happen to contain those
 * letter-sequences ("typify", "skipping"); substring match for the
 * multi-word phrases. Case-insensitive.
 *
 * `allowQuotedAsBad` mirrors `bannedTermsCheck` — workspace files like
 * SOUL.md *teach* the rule by naming the jargon, so the doc itself
 * contains the substrings. `isInstructionalQuote` skips them.
 */
export function jargonCheck(
  output: string,
  allowQuotedAsBad: boolean
): ReadonlyArray<CheckHit> {
  const lower = output.toLowerCase();
  const hits: CheckHit[] = [];
  const seen = new Set<string>();

  for (const phrase of JARGON_PHRASES) {
    const needsBoundary = phrase.length <= 4 || phrase === "kpis";
    let idx: number;
    if (needsBoundary) {
      // Word-boundary regex for short tokens.
      const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "i");
      const m = re.exec(output);
      if (!m) continue;
      idx = m.index;
    } else {
      idx = lower.indexOf(phrase);
      if (idx < 0) continue;
    }
    if (seen.has(phrase)) continue;
    if (allowQuotedAsBad && isInstructionalQuote(output, idx, phrase.length)) {
      continue;
    }
    seen.add(phrase);
    hits.push({
      reason: "banned-jargon",
      detail: `creator-jargon / corporate-speak: "${phrase}" (matched at index ${idx})`,
    });
  }

  // Sprint 9.7+ — internal data-structure / workspace-file names are
  // banned in creator-facing model output ONLY. Workspace files (AGENTS.md,
  // SOUL.md, etc.) legitimately contain these in their headers and
  // cross-references; flagging them there would break every generator.
  if (!allowQuotedAsBad) {
    for (const phrase of INTERNAL_NAME_PHRASES) {
      const idx = lower.indexOf(phrase);
      if (idx < 0) continue;
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      hits.push({
        reason: "banned-jargon",
        detail: `internal data-structure / workspace-file name leaked into creator-facing output: "${phrase}" (matched at index ${idx})`,
      });
    }
  }

  return hits;
}

/**
 * Fabrication check (Sprint 9.7) — flags invented precision: percentages
 * or splits that look like Maya synthesized a precise number out of
 * ranked-list data. The most common offender from the live test:
 * `audience.topGeos: ['UK', 'US']` → "audience is split 50/50 UK/US."
 *
 * The check is mechanical, not semantic — we look for the structural
 * tells:
 *   - "split N/N" with both numbers being "round" splits (50/50, 60/40,
 *     70/30, 75/25, 80/20, 90/10) co-located with audience / geo / age
 *     vocabulary ("audience", "between", "uk", "us", country names).
 *   - "N/N split" same.
 *   - "N% / M%" where N+M = 100 and audience-vocabulary is in the same
 *     sentence.
 *
 * We do NOT flag concrete cited numbers like "47k views" or "2.1x
 * trailing average" — those are anchored claims and `citationCheck`
 * handles them. We DO flag any audience/demographic ratio that isn't
 * cited to an actual percentage source.
 *
 * False-positive direction: if a creator's actual data has a literal
 * 50/50 percentage from a real source, this check still flags it
 * — Maya can either rephrase or cite the source. False-positive is
 * cheap, false-negative ships a fabricated number.
 */
export function fabricationCheck(output: string): CheckHit | null {
  const lower = output.toLowerCase();

  // Pattern 1: "split N/N" or "N/N split" with audience-vocabulary.
  // The split numbers are checked for "obviously synthesized" round splits
  // (multiples of 10 summing to 100; or 75/25, 25/75 — common alternative
  // round splits).
  const splitRegex = /\b(\d{1,3})\s*\/\s*(\d{1,3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = splitRegex.exec(output)) !== null) {
    const a = Number.parseInt(m[1], 10);
    const b = Number.parseInt(m[2], 10);
    if (!isLikelyDemographicSplit(a, b)) continue;
    // Look at a 60-char window around the match for audience-vocabulary.
    const windowStart = Math.max(0, m.index - 60);
    const windowEnd = Math.min(output.length, m.index + m[0].length + 60);
    const window = lower.slice(windowStart, windowEnd);
    if (containsAudienceVocab(window)) {
      return {
        reason: "fabricated-precision",
        detail: `fabricated precision: "${m[0]}" attached to audience/demographic vocabulary — ranked-list data is not a percentage breakdown (see SOUL.md Anti-fabrication rule)`,
      };
    }
  }

  // Pattern 2: "N% UK and M% US" / "N% / M%" — any two %-numbers within
  // ~50 chars of each other summing to 100, attached to audience-vocab.
  // The separator can be slash, comma, whitespace, or short connecting
  // words ("and", "to", "vs").
  const percentRegex = /\b(\d{1,3})\s*%/g;
  const percentMatches: Array<{ value: number; index: number; length: number }> = [];
  while ((m = percentRegex.exec(output)) !== null) {
    percentMatches.push({
      value: Number.parseInt(m[1], 10),
      index: m.index,
      length: m[0].length,
    });
  }
  for (let i = 0; i < percentMatches.length; i++) {
    for (let j = i + 1; j < percentMatches.length; j++) {
      const first = percentMatches[i];
      const second = percentMatches[j];
      const gap = second.index - (first.index + first.length);
      if (gap > 50) continue; // too far apart to be a paired split
      if (first.value + second.value !== 100) continue;
      if (!isLikelyDemographicSplit(first.value, second.value)) continue;
      // Window spans both percentages plus 60 chars on each side.
      const windowStart = Math.max(0, first.index - 60);
      const windowEnd = Math.min(
        output.length,
        second.index + second.length + 60
      );
      const window = lower.slice(windowStart, windowEnd);
      if (containsAudienceVocab(window)) {
        return {
          reason: "fabricated-precision",
          detail: `fabricated precision: "${first.value}% / ${second.value}%" — paired percentages summing to 100 attached to audience/demographic vocabulary suggest synthesized precision (see SOUL.md Anti-fabrication rule)`,
        };
      }
    }
  }

  return null;
}

function isLikelyDemographicSplit(a: number, b: number): boolean {
  // Rule out small numbers (clearly not %): "3/5 hits" etc.
  if (a < 10 || b < 10) return false;
  // Must sum to 100. (50/50, 60/40, 70/30, 75/25, 80/20, 90/10, 25/75, ...)
  if (a + b !== 100) return false;
  return true;
}

function containsAudienceVocab(window: string): boolean {
  // Demographic / audience-shape vocabulary. Intentionally avoids overly
  // general words like "split" or "between" (they show up in unrelated
  // contexts like "split your week 60/40 between filming and editing").
  // The check fires only when the split co-locates with an actual
  // demographic noun. Substring tokens are listed first; word-boundary
  // tokens (short letter-pairs like "uk" / "us") are checked separately
  // to avoid false positives ("trust" contains "us", "ukraine" contains "uk").
  const substringTokens = [
    "audience",
    "geo",
    "geos",
    "follower",
    "followers",
    "demographic",
    "demographics",
    "age range",
    "age split",
    "gender",
    "u.k.",
    "u.s.",
    "united kingdom",
    "united states",
    "north america",
    "male",
    "female",
    "men/women",
    "men to women",
    "women to men",
    "gen z",
    "gen-z",
    "millennial",
    "millennials",
    "boomer",
    "boomers",
  ];
  if (substringTokens.some((t) => window.includes(t))) return true;
  // Word-boundary checks for short country/region acronyms. These would
  // trip on substrings of unrelated words otherwise.
  const wbTokens = ["uk", "us", "eu", "men", "women", "girls", "guys"];
  return wbTokens.some((t) => new RegExp(`\\b${t}\\b`, "i").test(window));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    // Sprint 9.7 — SOUL.md "Human language only" section uses "- Not 'X' —
    // say 'Y'." pattern to teach the rule. Tolerate the negation.
    "- not '",
    "- not \"",
    "not '",
    "not \"",
    "say '",
    'say "',
    // Anti-fabrication uses "does NOT mean" / "ranked list" / "invent"
    "does not mean",
    "does not include",
    "ranked list",
    "invent",
    "made-up",
    "made up",
    "hallucinate",
    "fabricat",
    "fake compliment",
    "fake number",
    "i never",
    "i'd never",
  ];
  return cueWords.some((cue) => window.includes(cue));
}
