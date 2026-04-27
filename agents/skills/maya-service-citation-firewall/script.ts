/**
 * maya-service-citation-firewall — pure-logic claim/citation matcher.
 *
 * Service-product mirror of `maya-citation-firewall` (creator-side) with two
 * additions:
 *   1. Service-business citation kinds (`job` | `review` | `customer` |
 *      `competitor` | `gbp-post` | `inbound-lead` | `revenue-snapshot` |
 *      `local-positioning`).
 *   2. **Local-first sub-rule** (§ 7 hard rule): when `requireLocalHook=true`,
 *      the draft must contain at least one match against the operator's
 *      `localPositioningSnapshot`. Generic phrasing ("in your area", "in our
 *      community") flags fail.
 *
 * The Layer-1 match logic is deterministic and identical in spirit to the
 * creator-side firewall — same regex atom extraction, same opinion-marker
 * suppression, same scale-suffix expansion. Layer-2 (LLM disambiguation) is
 * deferred to the caller via the `ambiguousAtoms` return field; the caller
 * may spend a Flash Lite LOW round-trip if cost allows.
 *
 * Pure: no Convex imports, no network. Called from skill orchestrators
 * AND from skill-bundle tests directly.
 */

export type ServiceCitationKind =
  | "job"
  | "review"
  | "customer"
  | "competitor"
  | "gbp-post"
  | "inbound-lead"
  | "revenue-snapshot"
  | "local-positioning";

export interface ServiceCitation {
  kind: ServiceCitationKind;
  id: string;
  fact: string;
}

export interface ServiceFirewallInputs {
  draft: string;
  citations: ReadonlyArray<ServiceCitation>;
  requireLocalHook?: boolean;
  localPositioningSnapshot?: {
    servedNeighborhoods: ReadonlyArray<string>;
    namedCompetitors: ReadonlyArray<{ name: string }>;
    recurringLocalHooks: ReadonlyArray<{ kind: string; text: string }>;
  };
}

export type LocalHookFlag =
  | "no-local-reference"
  | "generic-in-your-area"
  | "generic-in-our-community"
  | "hook-not-in-localPositioning";

export interface ServiceFirewallOutput {
  pass: boolean;
  flaggedClaims: ReadonlyArray<{
    claim: string;
    suggestedSource: string;
  }>;
  ambiguousAtoms: ReadonlyArray<{
    atom: string;
    partialMatches: number;
  }>;
  localHookPresent: boolean | null;
  localHookFlags: ReadonlyArray<LocalHookFlag>;
}

// ─── Atom extraction patterns ───────────────────────────────────────────────

const NUMERIC_CLAIM = /\$?\d[\d,.]*\s*(?:[kKmM]|×|x|%)?/g;
const PAST_TENSE_REFERENCE =
  /\b(?:installed|repaired|completed|serviced|tuned|cleaned|replaced|inspected|delivered|finished|posted|reached out|sent|signed|paid|hit|published)\b/gi;
const TIME_WINDOW =
  /\b(?:yesterday|last week|last month|this week|today|tonight|on (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\b/gi;
// Capitalized multi-word names: technicians, customers, competitor brand names.
// Match runs of 1-3 capitalized tokens, requiring at least one uppercase token.
const NAMED_ENTITY = /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}\b/g;

// "Generic-in-your-area" lint: these patterns indicate a non-grounded local
// reference and fail the local-hook sub-rule even if other regions of the
// draft contain valid hooks.
const GENERIC_AREA = /\bin your area\b/gi;
const GENERIC_COMMUNITY = /\bin our community\b/gi;

const OPINION_MARKER =
  /\b(?:I think|I'd suggest|I'd recommend|maybe|might want to|consider|want me to|let's|let me know|feels like|seems|in my view)\b[\s\S]{0,140}/gi;

// Common English starter words / words that often start a sentence but aren't
// proper nouns. We exclude these from named-entity claims to avoid false
// positives like "Thanks", "Your", "We", etc.
const NAMED_ENTITY_STOPLIST = new Set([
  "thanks",
  "thank",
  "your",
  "you",
  "we",
  "i",
  "the",
  "this",
  "that",
  "today",
  "tomorrow",
  "yesterday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "hi",
  "hello",
  "hey",
  "good",
  "great",
  "nice",
  "well",
  "ok",
  "okay",
  "sure",
  "yes",
  "no",
  "maya",
]);

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
  start: number;
  end: number;
}

function collectSpans(draft: string, pattern: RegExp): SpanRange[] {
  if (!pattern.global) {
    throw new Error("collectSpans requires a global RegExp.");
  }
  const spans: SpanRange[] = [];
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(draft)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) pattern.lastIndex++;
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
  text: string;
  start: number;
  end: number;
  source: "numeric" | "past-tense" | "time-window" | "named-entity";
}

function extractAtoms(
  draft: string,
  opinionSpans: ReadonlyArray<SpanRange>
): ClaimAtom[] {
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
      // Filter sentence-leading false-positive named entities.
      if (source === "named-entity") {
        const firstWord = m[0].split(/\s+/)[0]?.toLowerCase() ?? "";
        if (NAMED_ENTITY_STOPLIST.has(firstWord)) {
          if (m[0].length === 0) pattern.lastIndex++;
          continue;
        }
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
  pushFromPattern(NAMED_ENTITY, "named-entity");

  return atoms;
}

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

function citationMatchLevel(
  atom: ClaimAtom,
  citations: ReadonlyArray<ServiceCitation>
): "exact" | "partial" | "none" {
  const normAtom = normalizeForOverlap(atom.text);
  if (normAtom.length === 0) return "exact";
  const atomTokens = normAtom.split(" ").filter((t) => t.length > 0);

  let bestLevel: "exact" | "partial" | "none" = "none";
  for (const c of citations) {
    const normFact = normalizeForOverlap(c.fact);
    if (normFact.includes(normAtom)) return "exact";

    if (atom.source === "numeric") {
      const rawDigits = normAtom.replace(/[^\d]/g, "");
      if (rawDigits.length > 0) {
        const factDigitTokens = c.fact.split(/\D+/).filter((t) => t.length > 0);
        if (factDigitTokens.includes(rawDigits)) return "exact";
        const scaled = expandScaleSuffix(atom.text);
        for (const cand of scaled) {
          if (factDigitTokens.includes(cand)) return "exact";
        }
      }
    }

    const factTokens = normFact.split(" ").filter((t) => t.length > 0);
    const overlap = atomTokens.some((t) => factTokens.includes(t));
    if (overlap) bestLevel = "partial";
  }
  return bestLevel;
}

function suggestionForAtom(atom: ClaimAtom): string {
  switch (atom.source) {
    case "numeric":
      return "needs a job, invoice, or revenue-snapshot citation that contains this number";
    case "past-tense":
      return "needs a job, review, or gbp-post citation describing this event";
    case "time-window":
      return "needs a job or gbp-post citation timestamped to this window";
    case "named-entity":
      return "needs a job, customer, or competitor citation that names this entity";
  }
}

// ─── Local-first sub-rule ──────────────────────────────────────────────────

function evaluateLocalHook(
  draft: string,
  snapshot: NonNullable<ServiceFirewallInputs["localPositioningSnapshot"]>
): { present: boolean; flags: LocalHookFlag[] } {
  const flags: LocalHookFlag[] = [];
  const lc = draft.toLowerCase();

  // Generic phrasing fails outright even if a hook is also present —
  // the operator-facing copy bar is "named". A draft mixing a real hook
  // with a generic phrase is still flagged so the rewrite is forced.
  if (GENERIC_AREA.test(draft)) {
    flags.push("generic-in-your-area");
  }
  if (GENERIC_COMMUNITY.test(draft)) {
    flags.push("generic-in-our-community");
  }

  let matchedAny = false;
  for (const n of snapshot.servedNeighborhoods) {
    if (n && lc.includes(n.toLowerCase())) {
      matchedAny = true;
      break;
    }
  }
  if (!matchedAny) {
    for (const c of snapshot.namedCompetitors) {
      if (c.name && lc.includes(c.name.toLowerCase())) {
        matchedAny = true;
        break;
      }
    }
  }
  if (!matchedAny) {
    for (const h of snapshot.recurringLocalHooks) {
      if (h.text && lc.includes(h.text.toLowerCase())) {
        matchedAny = true;
        break;
      }
    }
  }

  if (!matchedAny) {
    flags.push("no-local-reference");
  }

  return { present: matchedAny && flags.length === 0, flags };
}

export function runServiceFirewall(
  inputs: ServiceFirewallInputs
): ServiceFirewallOutput {
  const draft = inputs.draft;
  const trimmed = draft.trim().toLowerCase();

  // Pure filler — no claims to verify.
  if (FILLER_LINES.has(trimmed)) {
    return {
      pass: true,
      flaggedClaims: [],
      ambiguousAtoms: [],
      localHookPresent: inputs.requireLocalHook ? false : null,
      localHookFlags: inputs.requireLocalHook ? ["no-local-reference"] : [],
    };
  }

  const opinionSpans = collectSpans(draft, OPINION_MARKER);
  const atoms = extractAtoms(draft, opinionSpans);

  const flaggedClaims: { claim: string; suggestedSource: string }[] = [];
  const ambiguousAtoms: { atom: string; partialMatches: number }[] = [];

  for (const atom of atoms) {
    const level = citationMatchLevel(atom, inputs.citations);
    if (level === "exact") continue;
    if (level === "partial") {
      let partialCount = 0;
      const normAtom = normalizeForOverlap(atom.text);
      for (const c of inputs.citations) {
        const normFact = normalizeForOverlap(c.fact);
        if (
          normFact
            .split(" ")
            .some((t) => normAtom.split(" ").includes(t))
        ) {
          partialCount++;
        }
      }
      ambiguousAtoms.push({ atom: atom.text, partialMatches: partialCount });
      continue;
    }
    flaggedClaims.push({
      claim: atom.text,
      suggestedSource: suggestionForAtom(atom),
    });
  }

  // Local-first sub-rule.
  let localHookPresent: boolean | null = null;
  let localHookFlags: LocalHookFlag[] = [];
  if (inputs.requireLocalHook === true) {
    if (!inputs.localPositioningSnapshot) {
      localHookPresent = false;
      localHookFlags = ["no-local-reference"];
    } else {
      const ev = evaluateLocalHook(draft, inputs.localPositioningSnapshot);
      localHookPresent = ev.present;
      localHookFlags = ev.flags;
    }
  }

  const pass = flaggedClaims.length === 0 && localHookFlags.length === 0;
  return {
    pass,
    flaggedClaims,
    ambiguousAtoms,
    localHookPresent,
    localHookFlags,
  };
}

export const SKILL_METADATA = {
  name: "maya-service-citation-firewall" as const,
  modelTarget: "gemini-3.1-flash-lite" as const,
  thinkingBudget: "low" as const,
  planTier: ["starter", "pro", "studio"] as const,
};
