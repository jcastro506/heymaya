/**
 * maya-gmail-read — pure-logic Gmail read helpers.
 *
 * Sprint 7 Slice A. This script is pure: no Convex imports, no network. It
 * is called from Convex actions (which wrap `convex/integrations/composio/
 * actions/gmail.ts`) and from skill-bundle tests directly.
 *
 * Three responsibilities:
 *   1. Compose Gmail-search-syntax queries for the cron pull paths
 *      (`buildSearchQuery`)
 *   2. Flatten a fetched thread into a deterministic summary the deal-card
 *      preview can render without a model round-trip (`summarizeThread`)
 *   3. Extract heuristic-only deal signals as evidence — never a verdict —
 *      and a citation firewall that constrains Maya to facts present in
 *      the thread body / subject / from-header
 *      (`extractDealSignals`, `citationFirewall`)
 *
 * The verdict (real-deal / cold-pitch / spam / partnership / press) lives
 * in `maya-brand-deal-triager`. This skill returns evidence, not labels.
 */

import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Types — match maya-brand-deal-triager's GmailThread shape                  */
/* -------------------------------------------------------------------------- */

export interface GmailAttachmentRef {
  readonly kind: "pdf" | "docx";
  readonly url: string;
  readonly filename: string;
}

export interface GmailThread {
  readonly threadId: string;
  readonly from: {
    readonly email: string;
    readonly name?: string;
    readonly domain: string;
  };
  readonly subject: string;
  readonly bodyText: string;
  readonly receivedMs: number;
  readonly attachments: ReadonlyArray<GmailAttachmentRef>;
}

/** Defensive zod parser for thread payloads coming from external boundaries. */
export const GmailThreadParser = z
  .object({
    threadId: z.string().min(1),
    from: z.object({
      email: z.string(),
      name: z.string().optional(),
      domain: z.string(),
    }),
    subject: z.string(),
    bodyText: z.string(),
    receivedMs: z.number().int().nonnegative(),
    attachments: z
      .array(
        z.object({
          kind: z.enum(["pdf", "docx"]),
          url: z.string(),
          filename: z.string(),
        })
      )
      .default([]),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* buildSearchQuery                                                            */
/* -------------------------------------------------------------------------- */

export type SearchIntent = "brand-deal-active" | "brand-deal-archive" | "general";

export interface BuildSearchQueryArgs {
  /** Caller passes creatorId so a future per-creator shape can use it; v0 query is creator-agnostic. */
  readonly creatorId: string;
  readonly intent: SearchIntent;
  readonly sinceMs?: number;
}

const DAY_BUCKETS = [7, 14, 30, 90];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function bucketDays(deltaMs: number): number {
  if (deltaMs <= 0) return DAY_BUCKETS[0];
  const days = Math.max(1, Math.round(deltaMs / MS_PER_DAY));
  // Pick the smallest bucket that covers the requested range.
  for (const b of DAY_BUCKETS) {
    if (days <= b) return b;
  }
  return DAY_BUCKETS[DAY_BUCKETS.length - 1];
}

export function buildSearchQuery(args: BuildSearchQueryArgs): string {
  if (!args.creatorId || args.creatorId.trim().length === 0) {
    throw new Error("buildSearchQuery: creatorId is required");
  }

  let dayBucket: number;
  if (typeof args.sinceMs === "number" && Number.isFinite(args.sinceMs)) {
    const delta = Math.max(0, Date.now() - args.sinceMs);
    dayBucket = bucketDays(delta);
  } else {
    dayBucket =
      args.intent === "brand-deal-active"
        ? 7
        : args.intent === "brand-deal-archive"
          ? 90
          : 30;
  }

  switch (args.intent) {
    case "brand-deal-active":
      return `is:unread newer_than:${dayBucket}d (partnership OR campaign OR collab OR rate)`;
    case "brand-deal-archive":
      return `(partnership OR campaign OR collab OR brand) -in:spam newer_than:${dayBucket}d`;
    case "general":
      return `newer_than:${dayBucket}d -category:promotions -category:social`;
  }
}

/* -------------------------------------------------------------------------- */
/* summarizeThread                                                             */
/* -------------------------------------------------------------------------- */

export interface ThreadSummary {
  readonly summary: string;
  readonly lastSenderEmail: string;
  readonly subjectLine: string;
  readonly senderDomain: string;
  readonly firstParagraph: string;
}

const SUMMARY_MAX_CHARS = 280;
const FIRST_PARAGRAPH_MAX_CHARS = 400;

function clipAtSentenceBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  // Prefer the last full sentence within the budget.
  const periodIdx = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?")
  );
  if (periodIdx >= max * 0.5) {
    return slice.slice(0, periodIdx + 1).trim();
  }
  // Fall back to the last word boundary.
  const spaceIdx = slice.lastIndexOf(" ");
  if (spaceIdx >= max * 0.5) {
    return slice.slice(0, spaceIdx).trim() + "…";
  }
  return slice.trim() + "…";
}

export function summarizeThread(thread: GmailThread): ThreadSummary {
  const subject = (thread.subject ?? "").trim();
  const fromEmail = (thread.from.email ?? "").trim().toLowerCase();
  const senderDomain = (thread.from.domain ?? "").trim().toLowerCase();

  // Pull the first non-empty paragraph from bodyText.
  const paragraphs = (thread.bodyText ?? "")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
  const firstParagraphRaw = paragraphs[0] ?? "";
  const firstParagraph = clipAtSentenceBoundary(
    firstParagraphRaw,
    FIRST_PARAGRAPH_MAX_CHARS
  );

  // Summary is deterministic: subject + sender + first paragraph clip.
  // We do NOT inject any judgment / classification language here.
  const senderLabel = thread.from.name?.trim() || fromEmail || senderDomain;
  const head = subject.length > 0 ? `"${subject}" — ${senderLabel}` : senderLabel;
  const tail = firstParagraph.length > 0 ? `: ${firstParagraph}` : "";
  const summary = clipAtSentenceBoundary(head + tail, SUMMARY_MAX_CHARS);

  return {
    summary,
    lastSenderEmail: fromEmail,
    subjectLine: subject,
    senderDomain,
    firstParagraph,
  };
}

/* -------------------------------------------------------------------------- */
/* extractDealSignals                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Substring patterns matched case-insensitively against `bodyText`. The list
 * is documented in SKILL.md; keep them in sync. We use plain RegExp here
 * (rather than a substring set) so we can guard against incidental word
 * boundaries — e.g. "rate" must not match inside "rated". Each pattern is
 * keyed by the canonical phrase so the returned `signals` array is stable
 * across runs.
 */
const SIGNAL_PATTERNS: ReadonlyArray<{ phrase: string; re: RegExp }> = [
  { phrase: "partnership", re: /\bpartnership\b/i },
  { phrase: "partner with", re: /\bpartner\s+with\b/i },
  { phrase: "campaign", re: /\bcampaign\b/i },
  { phrase: "collab", re: /\bcollab(?:oration)?\b/i },
  { phrase: "rate", re: /\b(?:rate|rates|rate\s+card|your\s+rates)\b/i },
  { phrase: "we'd love to", re: /\bwe(?:'|’)?d\s+love\s+to\b/i },
  { phrase: "would love to work with", re: /\bwould\s+love\s+to\s+work\s+with\b/i },
  { phrase: "usage rights", re: /\busage\s+rights\b/i },
  { phrase: "whitelisting", re: /\bwhitelist(?:ing)?\b/i },
  { phrase: "paid amplification", re: /\bpaid\s+amplification\b/i },
  { phrase: "deliverable", re: /\bdeliverables?\b/i },
];

const DOLLAR_SIGNAL_RE = /\$\s?\d{3,}(?:[,.\d]*)?(?:\s*[kKmM])?/;
const K_SHORTHAND_RE = /\b\d+\s*[kK]\b/;

export interface DealSignalResult {
  readonly isLikelyBrandDeal: boolean;
  readonly signals: ReadonlyArray<string>;
}

export function extractDealSignals(thread: GmailThread): DealSignalResult {
  // Subject + body are both treated as the deal-signal corpus — brand
  // outreach often puts the headline ("Partnership opportunity") in the
  // subject and the offer in the body.
  const corpus = `${thread.subject ?? ""}\n${thread.bodyText ?? ""}`;
  const signals: string[] = [];

  for (const { phrase, re } of SIGNAL_PATTERNS) {
    if (re.test(corpus)) signals.push(phrase);
  }
  if (DOLLAR_SIGNAL_RE.test(corpus)) signals.push("explicit dollar amount");
  if (K_SHORTHAND_RE.test(corpus)) signals.push("k-shorthand amount");

  // "Likely" requires either a dollar mention or two narrative phrases —
  // a single mention of "rate" or "campaign" alone is too thin to flip.
  const hasDollar =
    signals.includes("explicit dollar amount") ||
    signals.includes("k-shorthand amount");
  const narrativeCount = signals.filter(
    (s) => s !== "explicit dollar amount" && s !== "k-shorthand amount"
  ).length;
  const isLikelyBrandDeal = hasDollar || narrativeCount >= 2;

  return { isLikelyBrandDeal, signals };
}

/* -------------------------------------------------------------------------- */
/* citationFirewall                                                            */
/* -------------------------------------------------------------------------- */

export interface CitationFirewallResult {
  readonly ok: boolean;
}

const NUMERIC_TOKEN_RE = /\$?\d[\d,.]*\s*(?:[kKmM]|%)?/g;
// Quoted phrases (single, double, smart) that the claim attributes to the thread.
const QUOTED_PHRASE_RE = /["“](.{2,200}?)["”]|'(.{2,200}?)'/g;
// Named-entity heuristic: capitalized 2-4 word phrases that could be brand names.
const NAMED_ENTITY_RE = /\b[A-Z][A-Za-z0-9&]+(?:\s+[A-Z][A-Za-z0-9&]+){0,3}\b/g;

function normalizeForOverlap(s: string): string {
  return s.toLowerCase().replace(/[\s,]+/g, " ").trim();
}

function digitTokensOf(s: string): ReadonlyArray<string> {
  return s.split(/\D+/).filter((t) => t.length > 0);
}

function expandKShorthand(token: string): string | null {
  const m = token.match(/^\$?([\d.]+)\s*([kKmM])$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const scale = m[2].toLowerCase() === "k" ? 1000 : 1_000_000;
  return String(Math.round(n * scale));
}

function threadCorpus(thread: GmailThread): {
  normalizedBody: string;
  digitTokens: ReadonlyArray<string>;
  raw: string;
} {
  const raw = [
    thread.subject ?? "",
    thread.bodyText ?? "",
    thread.from.email ?? "",
    thread.from.domain ?? "",
    thread.from.name ?? "",
  ].join(" \n ");
  const normalizedBody = normalizeForOverlap(raw);
  return { normalizedBody, digitTokens: digitTokensOf(raw), raw };
}

const COMMON_NAMED_ENTITIES = new Set([
  "I",
  "I'll",
  "I've",
  "I'm",
  "We",
  "You",
  "They",
  "Your",
  "Hi",
  "Hello",
  "Thanks",
  "Thank You",
  "Thanks Again",
  "Best",
  "Cheers",
  "Sincerely",
  "Regards",
  "Best Regards",
  "Brand",
  "The",
  "Re",
  "Reply",
]);

export function citationFirewall(
  claim: string,
  thread: GmailThread
): CitationFirewallResult {
  if (typeof claim !== "string" || claim.trim().length === 0) {
    return { ok: true };
  }
  const corpus = threadCorpus(thread);

  // 1. Numeric tokens — every number in the claim must appear in the corpus.
  const numericMatches = claim.match(NUMERIC_TOKEN_RE) ?? [];
  for (const tok of numericMatches) {
    const trimmed = tok.trim();
    if (trimmed.length === 0) continue;
    const rawDigits = trimmed.replace(/[^\d]/g, "");
    if (rawDigits.length === 0) continue;
    if (corpus.digitTokens.includes(rawDigits)) continue;
    const expanded = expandKShorthand(trimmed);
    if (expanded && corpus.digitTokens.includes(expanded)) continue;
    return { ok: false };
  }

  // 2. Quoted phrases — verbatim strings the claim attributes to the thread
  //    must appear (case-insensitively, whitespace-normalized) in the body.
  QUOTED_PHRASE_RE.lastIndex = 0;
  let qm: RegExpExecArray | null;
  while ((qm = QUOTED_PHRASE_RE.exec(claim)) !== null) {
    const phrase = (qm[1] ?? qm[2] ?? "").trim();
    if (phrase.length < 3) continue;
    const norm = normalizeForOverlap(phrase);
    if (!corpus.normalizedBody.includes(norm)) {
      return { ok: false };
    }
  }

  // 3. Named-entity heuristic — capitalized brand-shaped strings should
  //    appear in the corpus. We allow common conversational starters
  //    (I, We, You, Hi, Thanks, Best, etc.) without citation.
  NAMED_ENTITY_RE.lastIndex = 0;
  let nm: RegExpExecArray | null;
  while ((nm = NAMED_ENTITY_RE.exec(claim)) !== null) {
    const ent = nm[0].trim();
    if (ent.length < 3) continue;
    if (COMMON_NAMED_ENTITIES.has(ent)) continue;
    // Skip single-word entities at the very start of the claim — that's
    // most likely "Maya thinks…" prefixing, not a citation claim.
    if (nm.index === 0 && !ent.includes(" ")) continue;
    const norm = normalizeForOverlap(ent);
    if (!corpus.normalizedBody.includes(norm)) {
      return { ok: false };
    }
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Defensive parse                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Parses an unknown thread payload into a `GmailThread`. Returns `null` if
 * the payload is malformed instead of throwing — the calling action can log
 * and skip rather than crash the cron run.
 */
export function safeParseThread(input: unknown): GmailThread | null {
  const parsed = GmailThreadParser.safeParse(input);
  if (!parsed.success) return null;
  return parsed.data;
}
