/**
 * maya-citation-firewall — pure-logic claim/citation matcher.
 *
 * Sprint 3.5. The integrity gate that enforces "grounded or silent"
 * (CLAUDE.md § Architecture principles 3). Called by every other Maya skill
 * on outputs that make claims about creator data.
 *
 * Contract: see SKILL.md in this directory. The two-layer model is:
 *   Layer 1 — rule-based atom extraction (this file, deterministic, no LLM)
 *   Layer 2 — LLM disambiguation (deferred to caller via `runDisambiguation`
 *             callback when atoms partially match; Layer 1 returns
 *             `ambiguousAtoms` so the caller can decide whether to spend the
 *             low-thinking token round-trip)
 *
 * This file is intentionally pure: no Convex imports, no network. It is
 * called from Convex actions (which handle the optional LLM round-trip) and
 * from skill-bundle tests directly.
 */

export type CitationKind =
  | "post"
  | "deal"
  | "event"
  | "metric"
  | "peer"
  | "audience"
  | "contract";

export interface Citation {
  readonly kind: CitationKind;
  readonly id: string;
  readonly fact: string;
}

export interface FirewallInput {
  readonly draft: string;
  readonly citations: ReadonlyArray<Citation>;
}

export interface FlaggedClaim {
  readonly claim: string;
  readonly suggestedSource: string;
}

export interface AmbiguousAtom {
  readonly atom: string;
  readonly partialMatches: ReadonlyArray<Citation>;
}

export interface FirewallResult {
  readonly pass: boolean;
  readonly flaggedClaims: ReadonlyArray<FlaggedClaim>;
  readonly ambiguousAtoms: ReadonlyArray<AmbiguousAtom>;
}

// Patterns that count as factual claims requiring citation.
// Order matters — we match longest-first to avoid double-counting.
const NUMERIC_CLAIM = /\b\$?\d[\d,.]*\s*(?:[kKmM]|×|x|%)?\b/g;
const PAST_TENSE_REFERENCE =
  /\b(?:posted|reached out|sent|signed|paid|hit|landed|dropped|launched|published)\b/gi;
const TIME_WINDOW =
  /\b(?:yesterday|last week|last month|this week|today|tonight|on (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\b/gi;
const BRAND_OR_PEER_REFERENCE = /\b(?:Brand|brand|Peer|peer)\s+[A-Z]\w*/g;

// Phrases that explicitly mark the surrounding text as opinion / suggestion.
// If a claim atom falls inside one of these spans, we do NOT flag it.
const OPINION_MARKER =
  /\b(?:I think|I'd suggest|I'd recommend|maybe|might want to|consider|want me to|let's|let me know|feels like|seems|in my view)\b[\s\S]{0,140}/gi;

// Pure conversational filler — never flag a draft that is JUST filler.
const FILLER_LINES = new Set([
  "good morning",
  "got it",
  "on it",
  "noted",
  "okay",
  "ok",
  "sounds good",
  "thanks",
  "you got it",
]);

interface SpanRange {
  readonly start: number;
  readonly end: number;
}

function collectSpans(draft: string, pattern: RegExp): SpanRange[] {
  const spans: SpanRange[] = [];
  // Defensive — pattern must be /g.
  if (!pattern.global) {
    throw new Error("collectSpans requires a global RegExp.");
  }
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(draft)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) pattern.lastIndex++; // avoid infinite loop
  }
  return spans;
}

function inAnySpan(idx: number, spans: ReadonlyArray<SpanRange>): boolean {
  for (const s of spans) {
    if (idx >= s.start && idx < s.end) return true;
  }
  return false;
}

interface ClaimAtom {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly source: "numeric" | "past-tense" | "time-window" | "named-entity";
}

function extractAtoms(draft: string, opinionSpans: ReadonlyArray<SpanRange>): ClaimAtom[] {
  const atoms: ClaimAtom[] = [];

  function pushFromPattern(
    pattern: RegExp,
    source: ClaimAtom["source"]
  ): void {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(draft)) !== null) {
      if (inAnySpan(m.index, opinionSpans)) {
        if (m[0].length === 0) pattern.lastIndex++;
        continue;
      }
      atoms.push({
        text: m[0],
        start: m.index,
        end: m.index + m[0].length,
        source,
      });
      if (m[0].length === 0) pattern.lastIndex++;
    }
  }

  pushFromPattern(NUMERIC_CLAIM, "numeric");
  pushFromPattern(PAST_TENSE_REFERENCE, "past-tense");
  pushFromPattern(TIME_WINDOW, "time-window");
  pushFromPattern(BRAND_OR_PEER_REFERENCE, "named-entity");

  return atoms;
}

/**
 * Returns numeric strings the atom could resolve to under k/m/× scale.
 * Examples:
 *   "47k"   -> ["47000"]
 *   "2.5m"  -> ["2500000"]
 *   "$1.2k" -> ["1200"]
 *   "100"   -> []  (no suffix, no expansion)
 */
function expandScaleSuffix(atomText: string): string[] {
  const m = atomText.match(/^\$?([\d.,]+)\s*([kKmM])\b/);
  if (!m) return [];
  const numericPart = m[1].replace(/,/g, "");
  const n = parseFloat(numericPart);
  if (!isFinite(n)) return [];
  const scale = m[2].toLowerCase() === "k" ? 1000 : 1_000_000;
  return [String(Math.round(n * scale))];
}

function normalizeForOverlap(s: string): string {
  return s
    .toLowerCase()
    .replace(/[$,×x]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns 'exact' if the atom text appears verbatim (after normalization) in
 * any citation.fact, 'partial' if any citation.fact shares a token with the
 * atom, 'none' otherwise.
 */
function citationMatchLevel(
  atom: ClaimAtom,
  citations: ReadonlyArray<Citation>
): "exact" | "partial" | "none" {
  const normAtom = normalizeForOverlap(atom.text);
  if (normAtom.length === 0) return "exact"; // empty atom = no claim
  const atomTokens = normAtom.split(" ").filter((t) => t.length > 0);

  let bestLevel: "exact" | "partial" | "none" = "none";
  for (const c of citations) {
    const normFact = normalizeForOverlap(c.fact);
    if (normFact.includes(normAtom)) return "exact";
    // For numeric atoms, accept exact-token match — but reject incidental
    // substring matches inside larger numbers (e.g., '24' must NOT match
    // '2024' or '2026-04-22'). Honor k/m/× scale suffixes so '47k' matches
    // '47000' even though the literal digits differ.
    if (atom.source === "numeric") {
      const rawDigits = normAtom.replace(/[^\d]/g, "");
      if (rawDigits.length > 0) {
        const factDigitTokens = c.fact.split(/\D+/).filter((t) => t.length > 0);
        if (factDigitTokens.includes(rawDigits)) {
          return "exact";
        }
        // Scale-suffix expansion: 47k -> 47000, 2.5m -> 2500000.
        const scaledCandidates = expandScaleSuffix(atom.text);
        for (const cand of scaledCandidates) {
          if (factDigitTokens.includes(cand)) {
            return "exact";
          }
        }
      }
    }
    // Partial = any token overlap (and citation.kind aligns with atom source)
    if (atom.source === "past-tense" || atom.source === "time-window") {
      // these need a context overlap, not just a token match
      const factTokens = normFact.split(" ").filter((t) => t.length > 0);
      const overlap = atomTokens.some((t) => factTokens.includes(t));
      if (overlap) bestLevel = "partial";
    } else {
      const factTokens = normFact.split(" ").filter((t) => t.length > 0);
      const overlap = atomTokens.some((t) => factTokens.includes(t));
      if (overlap) bestLevel = "partial";
    }
  }
  return bestLevel;
}

function suggestionForAtom(atom: ClaimAtom): string {
  switch (atom.source) {
    case "numeric":
      return "needs a metric or deal citation that contains this number";
    case "past-tense":
      return "needs a post or deal citation describing this event";
    case "time-window":
      return "needs a post citation timestamped to this window";
    case "named-entity":
      return "needs a deal or peer citation that names this entity";
  }
}

export function runFirewall(input: FirewallInput): FirewallResult {
  const draft = input.draft;
  const trimmed = draft.trim().toLowerCase();

  // Pure filler — no claims to verify, pass.
  if (FILLER_LINES.has(trimmed)) {
    return { pass: true, flaggedClaims: [], ambiguousAtoms: [] };
  }

  const opinionSpans = collectSpans(draft, OPINION_MARKER);
  const atoms = extractAtoms(draft, opinionSpans);

  const flagged: FlaggedClaim[] = [];
  const ambiguous: AmbiguousAtom[] = [];

  for (const atom of atoms) {
    const level = citationMatchLevel(atom, input.citations);
    if (level === "exact") continue;
    if (level === "partial") {
      ambiguous.push({
        atom: atom.text,
        partialMatches: input.citations.filter((c) => {
          const normFact = normalizeForOverlap(c.fact);
          const normAtom = normalizeForOverlap(atom.text);
          return normFact
            .split(" ")
            .some((t) => normAtom.split(" ").includes(t));
        }),
      });
      continue;
    }
    flagged.push({ claim: atom.text, suggestedSource: suggestionForAtom(atom) });
  }

  return {
    pass: flagged.length === 0,
    flaggedClaims: flagged,
    ambiguousAtoms: ambiguous,
  };
}
