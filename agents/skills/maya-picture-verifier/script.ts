/**
 * maya-picture-verifier — pure-logic confirmation/correction loop for the
 * Sprint 5 creator-picture verification pass.
 *
 * Contract: see SKILL.md in this directory.
 *
 * Three deterministic phases:
 *   1. buildVerificationQuestion(item, picture) → string
 *   2. parseVerificationAnswer(rawReply, item) → ParsedAnswer
 *   3. applyAnswerToDraft(draft, item, answer) → CreatorPicture
 *
 * One pre-send guard:
 *   citationFirewall(question, item) → { ok, reason? }
 *
 * This file is intentionally pure: no Convex imports, no network. It is
 * called from the onboarding pipeline (which handles the optional LLM
 * disambiguation round-trip when the parser returns ambiguous) and from
 * skill-bundle tests directly.
 *
 * Composes with `agents/skills/maya-citation-firewall/script.ts` — the
 * broader firewall runs on the final question + citations after this
 * skill's local firewall passes. The local firewall here is stricter
 * (literal-excerpt-required) because the verifier is the only pipeline
 * where Maya is allowed to surface uncertain claims at all.
 */

// ─── types ──────────────────────────────────────────────────────────────────

export type CitationKind =
  | "post"
  | "comment"
  | "audience"
  | "bio"
  | "handle"
  | "metric";

export interface VerificationCitation {
  readonly kind: CitationKind;
  readonly id: string;
  readonly excerpt: string;
  readonly platform: string;
}

export interface NeedsVerificationItem {
  /** Dotted path into creatorPicture, e.g. "audience.topGeos[0]" or "niche". */
  readonly field: string;
  readonly inferredValue: unknown;
  /**
   * Synthesis self-rated 0..1. NOT used as a threshold by this skill — the
   * verifier's job is to ask, not to decide. Stored only so calling skills
   * can decide ordering / batching.
   */
  readonly confidence: number;
  readonly citations: ReadonlyArray<VerificationCitation>;
}

/**
 * Minimal shape of the creator-picture draft this skill mutates. Real Convex
 * `creatorPicture` row has many more fields (see `convex/schema.ts`); this
 * skill only requires `creatorId` for cross-tenant safety + the dotted-path
 * fields it actually writes through. Other fields pass through untouched.
 */
export interface CreatorPictureDraft {
  readonly creatorId: string;
  readonly niche?: string;
  readonly audience?: {
    readonly ageRanges?: ReadonlyArray<string>;
    readonly topGeos?: ReadonlyArray<string>;
    readonly interestTags?: ReadonlyArray<string>;
  };
  readonly voiceFingerprint?: string;
  readonly namedPeers?: ReadonlyArray<string>;
  readonly boundaries?: ReadonlyArray<string>;
  readonly verificationLog?: ReadonlyArray<VerificationLogEntry>;
  readonly sourceCitations?: ReadonlyArray<{
    readonly platform: string;
    readonly postId: string;
    readonly usedFor: string;
  }>;
  // Any other field the synthesizer wrote stays passthrough.
  readonly [extra: string]: unknown;
}

export interface VerificationLogEntry {
  readonly field: string;
  readonly source: "verifier-confirmed" | "verifier-corrected";
  readonly before?: unknown;
  readonly after: unknown;
  readonly at: number;
}

export interface ParsedAnswer {
  readonly confirmed: boolean;
  readonly correctedValue?: unknown;
  readonly ambiguous: boolean;
}

export interface FirewallResult {
  readonly ok: boolean;
  readonly reason?: string;
}

// ─── 1. buildVerificationQuestion ───────────────────────────────────────────

/**
 * Renders the iMessage-shaped verification question. Voice rules (see
 * SKILL.md § Question shape):
 *   - terse, anti-sycophancy
 *   - no "great question", no "I'd love to confirm", no Maya self-description
 *   - always carries at least one literal excerpt from item.citations
 *   - always phrased as a question, never as a statement of fact
 *
 * Throws if `item.citations` is empty — calling skill is responsible for
 * filtering empty-citation items out before reaching here. This is a defensive
 * invariant; the local citationFirewall is the soft gate, this throw is the
 * hard one (programmer error, not creator-facing).
 */
export function buildVerificationQuestion(
  item: NeedsVerificationItem,
  picture: CreatorPictureDraft
): string {
  if (!item.citations || item.citations.length === 0) {
    throw new Error(
      "buildVerificationQuestion called with no citations — refusing to assert."
    );
  }

  const sample = pickRepresentativeExcerpts(item.citations, 2);
  const platformLabel = describeCitationOrigin(item.citations);
  const evidence = sample.map((s) => `"${s}"`).join(", ");
  const fieldDescriptor = describeField(item.field, item.inferredValue);
  const inferredAsText = renderInferredValue(item.inferredValue);

  // Cite, then ask. Keep it under ~2 short iMessage lines. No greeting.
  // The "(your X still says Y)" rider is added when the picture has a
  // contradicting prior signal worth surfacing — e.g. handle says NYC but
  // posts reference London.
  const contradiction = findContradictionRider(item, picture);
  const trailer = contradiction ? ` (${contradiction})` : "";

  return `${platformLabel} ${evidence} — ${fieldDescriptor} ${inferredAsText}?${trailer}`.trim();
}

function pickRepresentativeExcerpts(
  citations: ReadonlyArray<VerificationCitation>,
  cap: number
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of citations) {
    const e = c.excerpt.trim();
    if (e.length === 0) continue;
    if (seen.has(e.toLowerCase())) continue;
    seen.add(e.toLowerCase());
    out.push(e);
    if (out.length >= cap) break;
  }
  // If everything was empty, fall back to id references — but this should
  // never happen given the firewall guard.
  if (out.length === 0 && citations.length > 0) {
    out.push(citations[0].excerpt);
  }
  return out;
}

function describeCitationOrigin(
  citations: ReadonlyArray<VerificationCitation>
): string {
  // Group by platform + kind for the cite lead-in. Picks the dominant one.
  const counts = new Map<string, number>();
  for (const c of citations) {
    const key = `${c.platform}|${c.kind}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bestKey = "";
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestKey = k;
      bestN = n;
    }
  }
  const [platform, kind] = bestKey.split("|");
  const platformWord = platform || "your";
  // Note: we deliberately do NOT include numeric counts ("Your last 3 ..."),
  // because every numeric atom in a creator-facing draft has to be cited
  // through `maya-citation-firewall` and the citation-array length is not
  // a citation. Keeping the lead-in count-free is the cheapest way to stay
  // grounded.
  switch (kind) {
    case "post":
      return `Recent ${platformWord} posts reference`;
    case "comment":
      return `Comments on your ${platformWord} reference`;
    case "audience":
      return `Your ${platformWord} audience signal shows`;
    case "bio":
      return `Your ${platformWord} bio says`;
    case "handle":
      return `Your ${platformWord} handle says`;
    case "metric":
      return `Your ${platformWord} numbers show`;
    default:
      return `Your ${platformWord} data shows`;
  }
}

function describeField(field: string, inferredValue: unknown): string {
  // Best-effort human-readable lead-in for the question half.
  // Dotted-path-aware so "audience.topGeos[0]" and "niche" both render.
  if (field === "niche") return "is your niche";
  if (field.startsWith("audience.topGeos")) return "are you based in";
  if (field.startsWith("audience.ageRanges")) return "is your audience mainly";
  if (field === "voiceFingerprint") return "would you describe your voice as";
  if (field.startsWith("namedPeers")) return "do you consider a peer of yours";
  if (field.startsWith("boundaries")) return "off-limits for you is";
  // Generic fallback. Inferred value still gets rendered after this lead-in
  // so the creator sees the literal value Maya is asking about.
  if (Array.isArray(inferredValue)) return `is ${field} —`;
  return `is your ${field.split(".").pop() ?? field}`;
}

function renderInferredValue(v: unknown): string {
  if (v == null) return "[unknown]";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) {
    const stringy = v.filter((x) => typeof x === "string" || typeof x === "number");
    return stringy.slice(0, 3).join(" / ");
  }
  // Defensive: never throw, just truncate.
  try {
    return JSON.stringify(v).slice(0, 80);
  } catch {
    return "[opaque]";
  }
}

function findContradictionRider(
  item: NeedsVerificationItem,
  picture: CreatorPictureDraft
): string | undefined {
  // Light-touch: surface the most useful "you said X earlier" rider when
  // the picture has a prior signal worth pointing at. We deliberately keep
  // this rule-set tiny — the real contradiction logic lives in the
  // synthesizer; this is just a polish layer.
  if (item.field.startsWith("audience.topGeos")) {
    const handleCitation = item.citations.find((c) => c.kind === "handle" || c.kind === "bio");
    if (handleCitation) {
      return `your handle/bio still says ${handleCitation.excerpt.trim()}`;
    }
  }
  // Prior topGeo on the picture that contradicts the new inference.
  if (item.field === "audience.topGeos[0]" && picture.audience?.topGeos?.[0]) {
    const prior = picture.audience.topGeos[0];
    const inferred = renderInferredValue(item.inferredValue);
    if (prior.toLowerCase() !== inferred.toLowerCase()) {
      return `picture currently has ${prior}`;
    }
  }
  return undefined;
}

// ─── 2. parseVerificationAnswer ─────────────────────────────────────────────

const PLAIN_AFFIRMATIVE = new Set([
  "y", "yes", "yeah", "yea", "yep", "yup", "ya", "yas",
  "confirmed", "correct", "right", "true", "affirmative",
  "sure", "of course",
]);

const PLAIN_DENIAL = new Set([
  "n", "no", "nope", "nah", "negative", "incorrect", "wrong",
  "false", "not really",
]);

const HEDGE_TOKENS = [
  "i guess", "kinda", "kind of", "sort of", "sorta", "maybe",
  "possibly", "i think so", "i suppose", "if you say so",
  "ugh fine", "fine i guess", "whatever",
];

const REJECT_PREFIX = /^(?:no|nope|nah|not really|negative|incorrect|wrong)\b[\s,.\-—:;!?]*/i;

/**
 * Parses the creator's free-text reply.
 *
 * Returns `ambiguous: true` when the parser cannot make a deterministic
 * decision — the calling skill is responsible for re-asking plain or
 * escalating to a low-thinking LLM round-trip. The parser does NOT decide
 * for the creator.
 */
export function parseVerificationAnswer(
  rawReply: string,
  _item: NeedsVerificationItem
): ParsedAnswer {
  if (typeof rawReply !== "string") {
    return { confirmed: false, ambiguous: true };
  }

  const stripped = stripEmojiAndPunctuation(rawReply).toLowerCase().trim();

  // Empty / whitespace / pure-punctuation / pure-emoji.
  if (stripped.length === 0) {
    return { confirmed: false, ambiguous: true };
  }

  // Hedge detection runs FIRST — "i guess maybe" must beat "yes" extraction
  // from a casual sentence with both. Anti-sycophancy means we don't
  // optimistically read hesitation as consent.
  if (containsAny(stripped, HEDGE_TOKENS)) {
    return { confirmed: false, ambiguous: true };
  }

  // Plain affirmative — single-token reply that's just "yes" / "yeah" / etc.,
  // possibly with repeated punctuation or emoji ("yes!!!" / "yes 😍").
  if (PLAIN_AFFIRMATIVE.has(stripped)) {
    return { confirmed: true, ambiguous: false };
  }

  // Plain denial — same shape.
  if (PLAIN_DENIAL.has(stripped)) {
    return { confirmed: false, ambiguous: false };
  }

  // Multi-token affirmative starts ("yes that's right", "yeah confirmed").
  // Require the FIRST token to be affirmative AND no denial elsewhere.
  const tokens = stripped.split(/\s+/);
  const firstToken = tokens[0];
  if (PLAIN_AFFIRMATIVE.has(firstToken)) {
    // Guard: "yes but actually no" → ambiguous (denial token later).
    const hasLaterDenial = tokens.slice(1).some((t) => PLAIN_DENIAL.has(t));
    if (hasLaterDenial) {
      return { confirmed: false, ambiguous: true };
    }
    return { confirmed: true, ambiguous: false };
  }

  // Denial + correction: "no, I'm in Brooklyn" / "nope - Boston" /
  // "not really, it's actually cooking with kids".
  if (REJECT_PREFIX.test(stripped)) {
    const after = rawReply.replace(REJECT_PREFIX, "").trim();
    const correction = extractCorrection(after);
    if (correction !== undefined) {
      return { confirmed: false, correctedValue: correction, ambiguous: false };
    }
    return { confirmed: false, ambiguous: false };
  }

  // No affirmative or denial token at all — treat as ambiguous.
  return { confirmed: false, ambiguous: true };
}

function stripEmojiAndPunctuation(s: string): string {
  // Strip common decorative emoji + repeated punctuation but preserve word
  // boundaries. We don't try to be exhaustive — anything we miss falls to
  // the ambiguous bucket, which is the safe default.
  return s
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, " ")
    .replace(/[!?.,;:""''`~^*_]+/g, " ")
    .replace(/\s+/g, " ");
}

function containsAny(haystack: string, needles: ReadonlyArray<string>): boolean {
  for (const n of needles) {
    if (haystack.includes(n)) return true;
  }
  return false;
}

function extractCorrection(after: string): string | undefined {
  // Pull a correction out of the post-denial substring. We do NOT free-form
  // NER — we accept exactly the patterns that are unambiguous in the
  // verification-reply genre. Anything more clever is escalated.
  if (after.length === 0) return undefined;

  // Strip leading filler ("actually", "it's", "i'm in", "i live in", etc.).
  const trimmed = after
    .replace(/^[,.\-—:;\s]+/, "")
    .replace(
      /^(?:actually|it'?s|i'?m (?:in|at|from|now in)|i live in|i'?m based in|but i'?m in|now i'?m in|now in)\s+/i,
      ""
    )
    .replace(/[.!?]+$/, "")
    .trim();

  if (trimmed.length === 0) return undefined;

  // If after stripping fillers we're left with a short noun phrase
  // (≤6 tokens, no internal punctuation) treat as the correction.
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0 || tokens.length > 6) return undefined;
  if (/[.,;:!?]/.test(trimmed)) return undefined;

  // Capitalize-first-letter for proper-noun-y corrections so the picture
  // doesn't end up with "brooklyn" lowercased. We only touch the first
  // letter of each token; the creator's casing on later letters wins.
  const titled = tokens
    .map((t) => (t.length === 0 ? t : t[0].toUpperCase() + t.slice(1)))
    .join(" ");
  return titled;
}

// ─── 3. applyAnswerToDraft ──────────────────────────────────────────────────

/**
 * Applies a parsed answer onto the picture draft. Pure: returns a NEW
 * draft, never mutates the input.
 *
 * Rules (see SKILL.md § How applyAnswerToDraft mutates the picture):
 *   - confirmed=true  → write inferredValue to item.field, append confirm log,
 *                       extend sourceCitations with item.citations
 *   - confirmed=false + correctedValue=X → write X, append correction log
 *   - ambiguous=true  → return draft untouched (caller re-asks)
 *
 * Cross-tenant safety: this function does NOT touch creatorId. It is the
 * calling pipeline's job to load the right draft for the right creator —
 * but tests assert the function never reads/writes across drafts.
 */
export function applyAnswerToDraft(
  draft: CreatorPictureDraft,
  item: NeedsVerificationItem,
  answer: ParsedAnswer
): CreatorPictureDraft {
  if (answer.ambiguous) {
    return draft; // caller re-asks; draft unchanged
  }

  const now = Date.now();
  const writeValue: unknown = answer.confirmed
    ? item.inferredValue
    : answer.correctedValue;

  // If denial without a correction, draft is unchanged at the field level.
  // We still log the denial so the calling pipeline knows the field needs
  // a different intake path (usually a plain ask).
  if (!answer.confirmed && writeValue === undefined) {
    const log: VerificationLogEntry = {
      field: item.field,
      source: "verifier-corrected",
      before: item.inferredValue,
      after: undefined,
      at: now,
    };
    return {
      ...draft,
      verificationLog: [...(draft.verificationLog ?? []), log],
    };
  }

  const next = setDottedPath(draft, item.field, writeValue);
  const log: VerificationLogEntry = answer.confirmed
    ? { field: item.field, source: "verifier-confirmed", after: writeValue, at: now }
    : {
        field: item.field,
        source: "verifier-corrected",
        before: item.inferredValue,
        after: writeValue,
        at: now,
      };

  // Extend sourceCitations with the verifier's evidence trail.
  const newSourceCitations = [
    ...(next.sourceCitations ?? []),
    ...item.citations.map((c) => ({
      platform: c.platform,
      postId: c.id,
      usedFor: `verifier:${item.field}`,
    })),
  ];

  return {
    ...next,
    verificationLog: [...(next.verificationLog ?? []), log],
    sourceCitations: newSourceCitations,
  };
}

/**
 * Set a value at a dotted path, supporting `arr[0]`-style indices.
 * Pure / immutable — returns a new draft.
 *
 * Supported paths:
 *   "niche"
 *   "audience.topGeos"
 *   "audience.topGeos[0]"
 *
 * Anything else falls through to a top-level set.
 */
function setDottedPath<T extends Record<string, unknown>>(
  obj: T,
  path: string,
  value: unknown
): T {
  // Split on dots, then split each segment further on `[N]`.
  const segments: Array<{ key: string; index?: number }> = [];
  for (const part of path.split(".")) {
    const m = part.match(/^([^\[]+)(?:\[(\d+)\])?$/);
    if (!m) {
      segments.push({ key: part });
      continue;
    }
    const key = m[1];
    const idx = m[2] !== undefined ? Number(m[2]) : undefined;
    segments.push({ key, index: idx });
  }

  function recurse(current: unknown, depth: number): unknown {
    const seg = segments[depth];
    const isLast = depth === segments.length - 1;
    const baseObj: Record<string, unknown> =
      current && typeof current === "object" && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};

    if (seg.index === undefined) {
      // Plain object key.
      if (isLast) {
        baseObj[seg.key] = value;
        return baseObj;
      }
      baseObj[seg.key] = recurse(baseObj[seg.key], depth + 1);
      return baseObj;
    }

    // Array index segment.
    const existingArr = Array.isArray(baseObj[seg.key])
      ? [...(baseObj[seg.key] as unknown[])]
      : [];
    if (isLast) {
      existingArr[seg.index] = value;
      baseObj[seg.key] = existingArr;
      return baseObj;
    }
    existingArr[seg.index] = recurse(existingArr[seg.index], depth + 1);
    baseObj[seg.key] = existingArr;
    return baseObj;
  }

  return recurse(obj, 0) as T;
}

// ─── 4. citationFirewall (local pre-send guard) ─────────────────────────────

/**
 * Local firewall — STRICTER than the broader `maya-citation-firewall`. The
 * verifier is the only pipeline where Maya is allowed to surface uncertain
 * claims, so we require the question to literally include at least one
 * excerpt from item.citations[*].excerpt before letting it go through.
 *
 * The broader firewall (`agents/skills/maya-citation-firewall/script.ts`)
 * is then called by the orchestrator on the same question — both must
 * pass. See SKILL.md § Citation-firewall composition.
 *
 * Returns `{ ok: true }` on pass, `{ ok: false, reason }` on fail.
 */
export function citationFirewall(
  question: string,
  item: NeedsVerificationItem
): FirewallResult {
  if (typeof question !== "string" || question.trim().length === 0) {
    return { ok: false, reason: "empty question" };
  }
  if (!item.citations || item.citations.length === 0) {
    return { ok: false, reason: "no citations on verification item" };
  }

  // The question MUST contain at least one literal excerpt (case-insensitive,
  // whitespace-collapsed). This is the verifier's grounded-or-silent rule.
  const normalizedQuestion = normalize(question);
  const matchedExcerpt = item.citations.find((c) => {
    const ex = normalize(c.excerpt);
    return ex.length > 0 && normalizedQuestion.includes(ex);
  });
  if (!matchedExcerpt) {
    return {
      ok: false,
      reason: "question does not contain any literal excerpt from item.citations",
    };
  }

  // Statement-of-fact guard — the question must read as a question, not as
  // an assertion. We require a literal "?" somewhere in the rendered text.
  // A trailing parenthetical rider after the "?" is allowed (e.g. "...are
  // you in London? (your handle still says NYC)"). Anything that smells
  // like Maya asserting a fact without a question mark gets rejected so
  // she's forced to phrase it as a question.
  if (!question.includes("?")) {
    return {
      ok: false,
      reason: "question must contain '?' (verifier rule: never assert)",
    };
  }

  return { ok: true };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
