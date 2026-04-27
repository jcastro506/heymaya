/**
 * maya-contract-redflag — pattern-based contract red-flag scanner.
 *
 * Sprint 3.5. The Anthropic `pdf` skill (delegated upstream by the
 * orchestrating Convex action) returns parsed page text. This skill
 * runs deterministic regex/keyword rules over the text, attaches verbatim
 * clause citations, then asks the citation firewall to confirm every flag's
 * cite resolves to the parsed PDF before returning.
 *
 * Detection is intentionally conservative: false positives (an over-flag)
 * cost the creator a 2-minute "this is fine" conversation; false negatives
 * (a missed perpetual IP grant) cost them their next 18 months of work.
 * We bias toward flagging.
 *
 * The summary string is the only LLM-touched output — synthesized at the
 * orchestrating-action layer using the model router with high thinking,
 * after this skill's flags are grounded.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type RedFlagSeverity = "high" | "medium" | "low";

export type RedFlagCategory =
  | "exclusivity-duration"
  | "ip-grant-perpetual"
  | "ip-grant-broad"
  | "payment-net-days"
  | "missing-kill-fee"
  | "ftc-disclosure-absent"
  | "morality-clause-overreach"
  | "unilateral-term-extension"
  | "content-approval-bottleneck";

export type Recommendation = "sign" | "negotiate" | "walk";

export interface ParsedPdfPage {
  pageNumber: number;
  text: string;
}

export interface ParsedPdf {
  pages: ParsedPdfPage[];
}

export interface RedFlag {
  severity: RedFlagSeverity;
  category: RedFlagCategory;
  /** Verbatim clause text from the parsed PDF (≤ 500 chars). */
  clause: string;
  page: number;
  concern: string;
  suggestion: string;
  citation: { pageNumber: number; clauseHash: string };
}

export interface ScanResult {
  redFlags: RedFlag[];
  recommendation: Recommendation;
  summary: string;
  counts: { high: number; medium: number; low: number };
  parsedPageCount: number;
}

export interface CitationFirewall {
  check(input: {
    text: string;
    citations: string[];
  }): Promise<{ passed: boolean; unsupportedClaims: string[] }>;
}

/* -------------------------------------------------------------------------- */
/* Detection rules                                                             */
/* -------------------------------------------------------------------------- */

interface RuleMatch {
  category: RedFlagCategory;
  severity: RedFlagSeverity;
  concern: string;
  suggestion: string;
  /** The matched clause excerpt (≤500 chars). */
  excerpt: string;
}

interface Rule {
  category: RedFlagCategory;
  /** Detector — receives a normalized lowercase text + raw text + page text length. */
  detect(normalized: string, raw: string): RuleMatch | null;
}

/** Truncate clause text to a reasonable display size, preserving the first match window. */
function excerpt(raw: string, matchIndex: number, len: number, maxLen = 400): string {
  const start = Math.max(0, matchIndex - 80);
  const end = Math.min(raw.length, matchIndex + len + 200);
  let out = raw.slice(start, end).replace(/\s+/g, " ").trim();
  if (out.length > maxLen) out = out.slice(0, maxLen) + "…";
  return out;
}

const PERPETUAL_IP_RE =
  /\b(in\s+perpetuity|perpetual(ly)?|works?\s+made\s+for\s+hire|in\s+any\s+(and\s+all\s+)?media\s+now\s+known\s+or\s+(here|there)after\s+(invented|devised|created))\b/i;

const BROAD_IP_RE =
  /\b(sublicens(e|able|ing)|world(-|\s)?wide\s+royalty(-|\s)?free|all\s+(rights|media)\s+including\s+derivative)\b/i;

// Non-greedy gap so we match the FIRST number+unit after "exclusivity",
// not the last one within 200 chars.
const EXCLUSIVITY_RE =
  /\bexclusiv(?:ity|e)\b[\s\S]{0,200}?\b(\d{1,3})[-\s]+(day|month|year|week)s?\b/i;

const NET_DAYS_RE =
  /\bnet\s+(\d{1,3})\b/i;

const KILL_FEE_RE = /\bkill\s+fee\b/i;
const PAID_SHOOT_RE = /\b(shoot|filming|production|in[-\s]?person)\b/i;

// Affirmative FTC disclosure language. We require a hashtag-style marker
// (#ad / #sponsored), an FTC reference, "endorsement guides", or the
// word "disclosure" qualified by a verb that implies an obligation. The
// bare word "disclosure" alone (e.g. inside "no disclosure language")
// must NOT count as the contract having FTC obligations.
const FTC_DISCLOSURE_RE =
  /(?:#ad\b|#sponsored\b|\bftc\b|\bendorsement\s+guides\b|\bdisclosure\s+(?:required|needed|include|use|is|shall|must|obligation)|\b(?:include[ds]?|use[ds]?|require[ds]?|add[s]?)\s+(?:a\s+)?(?:#?ad|#?sponsored|disclosure)\b|\bper\s+ftc\b|\bclear[-\s]+and[-\s]+conspicuous\s+disclosure\b)/i;

const MORALITY_RE =
  /\b(disrepute|moral\s+(turpitude|character)|conduct\s+(that\s+(brings|reflects))|reputational\s+harm|public\s+image)\b/i;
const MORALITY_DUE_PROCESS_RE = /\b(notice|cure\s+period|opportunity\s+to\s+respond)\b/i;

const UNILATERAL_EXTENSION_RE =
  /\b(brand|company|sponsor|client)\s+may\s+(unilaterally\s+)?(extend|renew|prolong)\s+(this|the)\s+(term|agreement)\b/i;

const APPROVAL_RE = /\b(approval|review)\s+(required|needed|process)\b[\s\S]{0,200}\b(\d{1,2})\s+(round|revision|cycle)s?\b/i;

const RULES: Rule[] = [
  {
    category: "ip-grant-perpetual",
    detect(_norm, raw) {
      const m = PERPETUAL_IP_RE.exec(raw);
      if (!m) return null;
      return {
        category: "ip-grant-perpetual",
        severity: "high",
        concern:
          "Perpetual IP grant detected. Brand may use the content forever, " +
          "across any current or future medium, with no expiry.",
        suggestion:
          "Negotiate a 12-month usage window with renewal at fair-market rate, " +
          "and strike 'in any media now known or hereafter devised' language.",
        excerpt: excerpt(raw, m.index, m[0].length),
      };
    },
  },
  {
    category: "ip-grant-broad",
    detect(_norm, raw) {
      // Don't double-flag if perpetual already matched.
      if (PERPETUAL_IP_RE.test(raw)) return null;
      const m = BROAD_IP_RE.exec(raw);
      if (!m) return null;
      return {
        category: "ip-grant-broad",
        severity: "medium",
        concern:
          "Broad sublicensable IP grant detected. Brand may relicense the " +
          "content to third parties without further compensation.",
        suggestion:
          "Strike sublicensing rights, or limit to a defined affiliate list with notice.",
        excerpt: excerpt(raw, m.index, m[0].length),
      };
    },
  },
  {
    category: "exclusivity-duration",
    detect(_norm, raw) {
      const m = EXCLUSIVITY_RE.exec(raw);
      if (!m) return null;
      const value = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      const days =
        unit.startsWith("year") ? value * 365
          : unit.startsWith("month") ? value * 30
          : unit.startsWith("week") ? value * 7
          : value;
      // Standard 30-or-fewer-day exclusivity = no flag (industry baseline).
      // > 30d → medium; > 90d → high.
      if (days <= 30) return null;
      const severity: RedFlagSeverity = days > 90 ? "high" : "medium";
      return {
        category: "exclusivity-duration",
        severity,
        concern: `Exclusivity window of ${value} ${unit}${value === 1 ? "" : "s"} (~${days} days). Blocks the next deal in this category for that duration.`,
        suggestion:
          "Cap exclusivity at 30 days post-publish unless brand pays a premium. Define category narrowly (not 'all fitness brands').",
        excerpt: excerpt(raw, m.index, m[0].length),
      };
    },
  },
  {
    category: "payment-net-days",
    detect(_norm, raw) {
      const m = NET_DAYS_RE.exec(raw);
      if (!m) return null;
      const days = parseInt(m[1], 10);
      if (days <= 60) return null;
      const severity: RedFlagSeverity = days > 90 ? "high" : "medium";
      return {
        category: "payment-net-days",
        severity,
        concern: `Payment terms are NET-${days}. Cash arrives ${days} days after invoice — meaningful working-capital cost for a creator.`,
        suggestion: "Counter to NET-30. If brand pushes back, add 1.5% / 30 day late fee.",
        excerpt: excerpt(raw, m.index, m[0].length),
      };
    },
  },
  {
    category: "missing-kill-fee",
    detect(_norm, raw) {
      // Only flag missing kill fee on paid-shoot contracts.
      if (!PAID_SHOOT_RE.test(raw)) return null;
      if (KILL_FEE_RE.test(raw)) return null;
      // No clause to cite directly — synthesize a marker citation pointing
      // to the shoot mention so the firewall has *something* to verify.
      const shootMatch = PAID_SHOOT_RE.exec(raw);
      if (!shootMatch) return null;
      return {
        category: "missing-kill-fee",
        severity: "medium",
        concern:
          "Contract references an in-person shoot but does not specify a kill fee. " +
          "If brand cancels after prep, creator absorbs the loss.",
        suggestion:
          "Add a kill fee equal to 50% of the deal value, payable if brand cancels < 7 days from shoot date.",
        excerpt: excerpt(raw, shootMatch.index, shootMatch[0].length),
      };
    },
  },
  {
    category: "ftc-disclosure-absent",
    detect(_norm, raw) {
      if (FTC_DISCLOSURE_RE.test(raw)) return null;
      // Synthesize a citation pointing to the start of page 1 (whole-doc absence).
      return {
        category: "ftc-disclosure-absent",
        severity: "high",
        concern:
          "Contract does not reference FTC #ad / #sponsored disclosure obligations. " +
          "Creator carries regulatory exposure if the post is not labeled.",
        suggestion:
          "Add a clause requiring the creator to use clear-and-conspicuous disclosure ('#ad' or '#sponsored') per FTC Endorsement Guides.",
        excerpt: "(no FTC disclosure language detected anywhere in the contract)",
      };
    },
  },
  {
    category: "morality-clause-overreach",
    detect(_norm, raw) {
      const m = MORALITY_RE.exec(raw);
      if (!m) return null;
      // If the morality clause is paired with notice / cure-period language,
      // it's standard — don't flag.
      if (MORALITY_DUE_PROCESS_RE.test(raw)) return null;
      return {
        category: "morality-clause-overreach",
        severity: "medium",
        concern:
          "Morality / reputation clause without notice or cure-period language. " +
          "Brand may terminate unilaterally on broadly-defined 'disrepute.'",
        suggestion:
          "Require written notice + 14-day cure period before termination. Define triggering conduct narrowly.",
        excerpt: excerpt(raw, m.index, m[0].length),
      };
    },
  },
  {
    category: "unilateral-term-extension",
    detect(_norm, raw) {
      const m = UNILATERAL_EXTENSION_RE.exec(raw);
      if (!m) return null;
      return {
        category: "unilateral-term-extension",
        severity: "high",
        concern:
          "Brand may unilaterally extend the term. Creator has no consent right.",
        suggestion:
          "Require mutual written consent for any term extension. Strike 'unilaterally' / 'in its sole discretion' language.",
        excerpt: excerpt(raw, m.index, m[0].length),
      };
    },
  },
  {
    category: "content-approval-bottleneck",
    detect(_norm, raw) {
      const m = APPROVAL_RE.exec(raw);
      if (!m) return null;
      const rounds = parseInt(m[3], 10);
      if (rounds <= 2) return null;
      return {
        category: "content-approval-bottleneck",
        severity: "medium",
        concern: `Brand approval requires ${rounds} rounds. Risk of timeline slip + creative drag.`,
        suggestion:
          "Cap at 2 rounds of feedback within 5 business days each. After that, deemed approved.",
        excerpt: excerpt(raw, m.index, m[0].length),
      };
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Stable hash for clause citations (FNV-1a 32-bit, hex)                       */
/* -------------------------------------------------------------------------- */

function hashClause(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/* -------------------------------------------------------------------------- */
/* Scanner                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Per-page detection. Runs only page-local rules (skips whole-document
 * rules like FTC absence, which only `detectFlags` knows how to evaluate
 * because it needs the full text). Exposed for tests + for callers that
 * want to surface flags in a per-page UI.
 */
export function detectFlagsInPage(page: ParsedPdfPage): RedFlag[] {
  const raw = page.text;
  const normalized = raw.toLowerCase();
  const out: RedFlag[] = [];
  for (const rule of RULES) {
    if (rule.category === "ftc-disclosure-absent") continue;
    const match = rule.detect(normalized, raw);
    if (!match) continue;
    out.push({
      severity: match.severity,
      category: match.category,
      clause: match.excerpt,
      page: page.pageNumber,
      concern: match.concern,
      suggestion: match.suggestion,
      citation: {
        pageNumber: page.pageNumber,
        clauseHash: hashClause(match.excerpt),
      },
    });
  }
  return out;
}

/**
 * Aggregate flags across all pages. The FTC-disclosure-absent rule needs the
 * full document, so we only emit it once when no page contains the language.
 */
export function detectFlags(parsed: ParsedPdf): RedFlag[] {
  if (parsed.pages.length === 0) {
    throw new Error("maya-contract-redflag: parsed PDF has zero pages");
  }
  const perPageFlags: RedFlag[] = [];
  // Run detection per page, but suppress whole-document rules at the
  // per-page level — handle them after the sweep.
  for (const page of parsed.pages) {
    for (const rule of RULES) {
      // Skip whole-doc rules in per-page loop.
      if (rule.category === "ftc-disclosure-absent") continue;
      const match = rule.detect(page.text.toLowerCase(), page.text);
      if (!match) continue;
      perPageFlags.push({
        severity: match.severity,
        category: match.category,
        clause: match.excerpt,
        page: page.pageNumber,
        concern: match.concern,
        suggestion: match.suggestion,
        citation: {
          pageNumber: page.pageNumber,
          clauseHash: hashClause(match.excerpt),
        },
      });
    }
  }
  // Whole-document FTC check.
  const allText = parsed.pages.map((p) => p.text).join("\n");
  if (!FTC_DISCLOSURE_RE.test(allText)) {
    perPageFlags.push({
      severity: "high",
      category: "ftc-disclosure-absent",
      clause: "(no FTC disclosure language detected anywhere in the contract)",
      page: 1,
      concern:
        "Contract does not reference FTC #ad / #sponsored disclosure obligations. " +
        "Creator carries regulatory exposure if the post is not labeled.",
      suggestion:
        "Add a clause requiring the creator to use clear-and-conspicuous disclosure ('#ad' or '#sponsored') per FTC Endorsement Guides.",
      citation: {
        pageNumber: 1,
        clauseHash: hashClause("(no FTC disclosure language detected)"),
      },
    });
  }
  // Dedup by (category, clauseHash) — same clause matched on multiple pages
  // counts once.
  const seen = new Set<string>();
  const dedup: RedFlag[] = [];
  for (const f of perPageFlags) {
    const k = `${f.category}::${f.citation.clauseHash}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(f);
  }
  return dedup;
}

export function recommendFromFlags(flags: RedFlag[]): Recommendation {
  const highWalkers = flags.filter(
    (f) =>
      f.severity === "high" &&
      (f.category === "ip-grant-perpetual" ||
        f.category === "unilateral-term-extension" ||
        (f.category === "payment-net-days" && /NET-([0-9]+)/.test(f.concern) &&
          parseInt(f.concern.match(/NET-([0-9]+)/)![1], 10) > 90))
  );
  if (highWalkers.length >= 1) return "walk";
  const high = flags.filter((f) => f.severity === "high").length;
  const medium = flags.filter((f) => f.severity === "medium").length;
  if (high >= 1 || medium >= 2) return "negotiate";
  if (medium > 1) return "negotiate";
  return "sign";
}

/**
 * Build the creator-facing summary. The skill emits a deterministic 3-line
 * summary so the orchestrating action can decide whether to escalate to the
 * model router for a longer chat-shape draft. The disclaimer is non-removable
 * per `playbook.md § Contract red-flag scan`.
 */
export function buildSummary(
  flags: RedFlag[],
  recommendation: Recommendation
): string {
  const counts = countSeverities(flags);
  const total = counts.high + counts.medium + counts.low;
  if (total === 0) {
    return [
      "No red flags detected across the categories I scan for (exclusivity, IP, payment, kill fee, FTC, morality, term extension, approval rounds).",
      "Recommendation: sign — but this is a flag scan, not legal advice. Get a lawyer if anything feels off.",
    ].join(" ");
  }
  const lead =
    `Found ${total} red flag${total === 1 ? "" : "s"}: ${counts.high} high, ${counts.medium} medium, ${counts.low} low.`;
  const top = flags
    .slice()
    .sort(severitySort)
    .slice(0, 3)
    .map((f) => `${f.category} (${f.severity}) — ${f.concern}`)
    .join("; ");
  return `${lead} Top: ${top}. Recommendation: ${recommendation}. This is a flag, not legal advice — get a lawyer if anything feels off.`;
}

function severitySort(a: RedFlag, b: RedFlag): number {
  const rank: Record<RedFlagSeverity, number> = { high: 0, medium: 1, low: 2 };
  return rank[a.severity] - rank[b.severity];
}

function countSeverities(flags: RedFlag[]): { high: number; medium: number; low: number } {
  const out = { high: 0, medium: 0, low: 0 };
  for (const f of flags) out[f.severity]++;
  return out;
}

/* -------------------------------------------------------------------------- */
/* Top-level entry — runs detection + firewall                                 */
/* -------------------------------------------------------------------------- */

export interface ScanInputs {
  parsed: ParsedPdf;
}

export interface ScanDeps {
  firewall: CitationFirewall;
}

/**
 * Top-level skill entry. Detects flags, drops any flag whose citation the
 * firewall cannot resolve, computes the recommendation, and returns the
 * summary.
 */
export async function scanContract(
  inputs: ScanInputs,
  deps: ScanDeps
): Promise<ScanResult> {
  const candidate = detectFlags(inputs.parsed);
  // Firewall every flag with its clause as the sole citation.
  const surviving: RedFlag[] = [];
  for (const f of candidate) {
    const verdict = await deps.firewall.check({
      text: f.concern,
      citations: [`pdf:p${f.page}:${f.citation.clauseHash}`],
    });
    if (verdict.passed) surviving.push(f);
  }
  const recommendation = recommendFromFlags(surviving);
  const summary = buildSummary(surviving, recommendation);
  return {
    redFlags: surviving,
    recommendation,
    summary,
    counts: countSeverities(surviving),
    parsedPageCount: inputs.parsed.pages.length,
  };
}
