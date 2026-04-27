/**
 * maya-brand-deal-triager — inbound brand-email triage.
 *
 * Sprint 3.5. Pro+ only — Starter has no Gmail in allowedProviders and
 * upstream gating must reject before this skill is invoked.
 *
 * The skill:
 *   1. Classifies the email (rule-based first, model-fallback for ambiguous)
 *   2. Extracts the offer (brand, deliverables, dollar amount, deadline, exclusivity)
 *   3. Computes urgency from deadline language + brand recognition
 *   4. Invokes maya-rate-calculator (injected) for a suggested counter-rate
 *   5. Invokes maya-contract-redflag (injected) for any PDF attachments
 *   6. Drafts 4 reply variants — voice-applied + firewalled per variant
 *   7. Returns the bundle
 *
 * Heavy LLM lifting (variant drafting + classification fallback) lives at
 * the model-router layer with task tag `brand_email_draft` (high thinking).
 * This script wires the deterministic rules + the orchestration around the
 * other skills.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type Classification =
  | "real-deal"
  | "cold-pitch"
  | "spam"
  | "partnership-not-deal"
  | "press-inquiry";

export type Urgency = "high" | "medium" | "low";
export type ReplyVariantKind = "enthusiastic" | "neutral" | "firm" | "pass";

export interface PdfRef {
  kind: "pdf";
  url: string;
  filename: string;
}
export interface DocxRef {
  kind: "docx";
  url: string;
  filename: string;
}
export type Attachment = PdfRef | DocxRef;

export interface GmailThread {
  threadId: string;
  from: { email: string; name?: string; domain: string };
  subject: string;
  bodyText: string;
  receivedMs: number;
  attachments: Attachment[];
}

export interface CreatorPictureSubset {
  niche: string;
  voiceFingerprint: string;
  followerCountByPlatform: Array<{ platform: string; count: number }>;
}

export interface CreatorContext {
  creatorId: string;
  picture: CreatorPictureSubset;
  floorRate: number;
  recentDeals: Array<{ brand: string; valueUsd: number; deliverables: string }>;
}

export interface TriageInputs {
  gmailThread: GmailThread;
  creatorContext: CreatorContext;
  brandContextLookupEnabled: boolean;
}

export interface ParsedOffer {
  brand: string;
  deliverables: string;
  proposedValueUsd: number | null;
  deadlineMs: number | null;
  exclusivityMentioned: boolean;
}

export interface RateSuggestion {
  low: number;
  target: number;
  stretch: number;
  reasoning: string;
}

export interface ContractRedFlagSummary {
  high: number;
  medium: number;
  low: number;
  recommendation: "sign" | "negotiate" | "walk";
  summary: string;
}

export interface ReplyVariant {
  variant: ReplyVariantKind;
  draft: string;
  citations: string[];
}

export interface TriageResult {
  classification: Classification;
  urgency: Urgency;
  parsedOffer: ParsedOffer | null;
  suggestedRate?: RateSuggestion;
  redFlags?: ContractRedFlagSummary;
  replyVariants: ReplyVariant[];
}

/* -------------------------------------------------------------------------- */
/* Dependencies                                                                */
/* -------------------------------------------------------------------------- */

export interface RateCalculatorSkill {
  suggest(input: {
    followerMix: Array<{ platform: string; count: number }>;
    niche: string;
    deliverables: string;
    floorRate: number;
    recentDeals: CreatorContext["recentDeals"];
  }): Promise<RateSuggestion>;
}

export interface ContractRedFlagSkill {
  scan(input: { contractPdfUrl: string }): Promise<ContractRedFlagSummary>;
}

export interface VoiceApplierSkill {
  apply(input: {
    draft: string;
    soulVoiceFingerprint: string;
    toneSlider: "supportive" | "strategic" | "tough-love";
  }): Promise<{ adjustedDraft: string; unchanged: boolean }>;
}

export interface CitationFirewall {
  check(input: {
    text: string;
    citations: string[];
  }): Promise<{ passed: boolean; unsupportedClaims: string[] }>;
}

export interface ClassifierModel {
  /** Fallback when rule-based classification is ambiguous. */
  classifyAmbiguous(input: { thread: GmailThread }): Promise<Classification>;
}

export interface VariantDrafterModel {
  /** Drafts the 4 reply variants — invoked once with the full context. */
  draftVariants(input: {
    thread: GmailThread;
    classification: Classification;
    parsedOffer: ParsedOffer | null;
    suggestedRate?: RateSuggestion;
    voiceFingerprint: string;
  }): Promise<Record<ReplyVariantKind, string>>;
}

export interface TriageDeps {
  rateCalculator: RateCalculatorSkill;
  contractRedflag: ContractRedFlagSkill;
  voiceApplier: VoiceApplierSkill;
  firewall: CitationFirewall;
  classifierModel: ClassifierModel;
  variantDrafter: VariantDrafterModel;
}

/* -------------------------------------------------------------------------- */
/* Classification (rule-based)                                                 */
/* -------------------------------------------------------------------------- */

const FREE_WEBMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "live.com",
  "aol.com",
]);

const SPAM_KEYWORDS = [
  /\bcongratulations[!,. ]/i,
  /\byou(?:'ve| have)\s+(?:been\s+selected|won)\b/i,
  /\bclaim\s+your\s+prize\b/i,
  /\b(?:click|tap)\s+here\s+to\b/i,
  /\b(?:cheap|discount)\s+(?:viagra|crypto|nft)\b/i,
];

const COLD_PITCH_HEURISTICS = [
  /\bhope\s+this\s+(?:email|message)\s+finds\s+you\s+well\b/i,
  /\b(?:love|loved)\s+your\s+(?:content|page|profile)\b/i,
  /\b(?:would\s+love\s+to\s+collab|collaborat\w*\s+with\s+you)\b/i,
];

/** Press inquiry requires a press-specific keyword. "Deadline" alone is not press — brand deals also have deadlines. */
const PRESS_KEYWORDS = [
  /\b(?:quote\s+from|interview|reporter|journalist|writing\s+a\s+(?:piece|story|feature)|covering\s+for|press\s+inquiry)\b/i,
  /\bfeature\s+(?:in|on)\s+(?:our|the)\b/i,
];

const PARTNERSHIP_NOT_DEAL = [
  /\b(?:gift(?:ed|ing)?|free\s+(?:product|sample))\b/i,
  /\b(?:affiliate|commission)\s+(?:program|code|link)\b/i,
  /\bunpaid\b/i,
];

// Order matters: try the comma-separated form first (e.g., 1,234,567), then
// the bare-digit form (e.g., 4500). If we put the bare form first, "1,234"
// would match as just "1".
const DOLLAR_RE = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(k|thousand)?/gi;
const DELIVERABLE_RE =
  /\b(reel|tiktok|tt\b|youtube|yt\b|short|carousel|post|story|integration)\b/i;
const DEADLINE_RE = /\b(by|before|deadline\s+(?:is|of))\s+([A-Za-z]+\s+\d{1,2}|next\s+\w+|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|in\s+\d+\s+(?:days?|weeks?))\b/i;
const URGENT_RE = /\b(asap|urgent|immediately|today|24\s*hours?)\b/i;
const EXCLUSIVITY_RE = /\bexclusiv(?:e|ity)\b/i;

export function classifyByRules(thread: GmailThread): Classification | null {
  const body = thread.bodyText;
  const fromDomain = thread.from.domain.toLowerCase();
  const isFreeWebmail = FREE_WEBMAIL_DOMAINS.has(fromDomain);

  // Spam: free webmail + spam keyword pattern
  for (const re of SPAM_KEYWORDS) {
    if (re.test(body) && (isFreeWebmail || /https?:\/\//.test(body))) {
      return "spam";
    }
  }

  // Press inquiry: press keywords win even if dollar amounts present (interview fee != deal)
  for (const re of PRESS_KEYWORDS) {
    if (re.test(body)) return "press-inquiry";
  }

  // Partnership-not-deal: gifting / affiliate / unpaid
  for (const re of PARTNERSHIP_NOT_DEAL) {
    if (re.test(body)) {
      // If body ALSO contains a dollar amount it might be a hybrid; treat as cold-pitch.
      if (DOLLAR_RE.test(body)) return "cold-pitch";
      return "partnership-not-deal";
    }
  }

  // Real deal: explicit deliverable + dollar amount, OR brand domain (non-webmail) + deliverable
  const hasDeliverable = DELIVERABLE_RE.test(body);
  // re-set lastIndex on the global regex
  DOLLAR_RE.lastIndex = 0;
  const hasDollar = DOLLAR_RE.test(body);
  if (hasDeliverable && hasDollar) return "real-deal";
  if (hasDeliverable && !isFreeWebmail) return "real-deal";

  // Cold pitch: heuristic phrases without rate
  for (const re of COLD_PITCH_HEURISTICS) {
    if (re.test(body)) return "cold-pitch";
  }

  // Ambiguous — caller falls back to model.
  return null;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

function parseDollar(match: RegExpExecArray): number | null {
  const raw = match[1].replace(/[\s,]/g, "");
  const n = parseFloat(raw);
  if (isNaN(n)) return null;
  if (match[2] && /^k|thousand$/i.test(match[2])) return n * 1000;
  return n;
}

export function parseOffer(thread: GmailThread): ParsedOffer | null {
  const body = thread.bodyText;
  const brand = thread.from.name ?? thread.from.domain.split(".")[0] ?? "(unknown)";

  // Capture all dollar mentions; pick the largest (typically the deal value vs. fees).
  const dollars: number[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(DOLLAR_RE.source, "gi");
  while ((m = re.exec(body)) !== null) {
    const v = parseDollar(m);
    if (v !== null) dollars.push(v);
  }
  const proposedValueUsd = dollars.length === 0 ? null : Math.max(...dollars);

  // Deliverables: extract the matched deliverable phrase + a tight context window.
  let deliverables = "";
  const dm = DELIVERABLE_RE.exec(body);
  if (dm) {
    const start = Math.max(0, dm.index - 40);
    const end = Math.min(body.length, dm.index + dm[0].length + 80);
    deliverables = body.slice(start, end).replace(/\s+/g, " ").trim();
  }
  if (!deliverables && proposedValueUsd === null) return null;

  let deadlineMs: number | null = null;
  const dlm = DEADLINE_RE.exec(body);
  if (dlm || URGENT_RE.test(body)) {
    // We don't try to fully parse the date string in v0 — that's a model
    // pass at the orchestrating-action layer. Just signal "deadline mentioned"
    // by pinning the deadline to receivedMs + 7 days as a best-effort floor.
    deadlineMs = thread.receivedMs + 7 * 24 * 60 * 60 * 1000;
  }

  return {
    brand,
    deliverables: deliverables || "(unspecified)",
    proposedValueUsd,
    deadlineMs,
    exclusivityMentioned: EXCLUSIVITY_RE.test(body),
  };
}

export function urgencyFromThread(thread: GmailThread, parsed: ParsedOffer | null): Urgency {
  if (URGENT_RE.test(thread.bodyText)) return "high";
  if (parsed?.deadlineMs !== null && parsed?.deadlineMs !== undefined) {
    const hoursOut = (parsed.deadlineMs - thread.receivedMs) / (1000 * 60 * 60);
    if (hoursOut <= 48) return "high";
    if (hoursOut <= 168) return "medium";
  }
  return "low";
}

/* -------------------------------------------------------------------------- */
/* Top-level entry                                                             */
/* -------------------------------------------------------------------------- */

export async function triageBrandEmail(
  inputs: TriageInputs,
  deps: TriageDeps
): Promise<TriageResult> {
  // 1. Classify (rules first; model fallback for ambiguous).
  let classification = classifyByRules(inputs.gmailThread);
  if (classification === null) {
    classification = await deps.classifierModel.classifyAmbiguous({
      thread: inputs.gmailThread,
    });
  }

  // 2. Parse the offer (only meaningful for real-deal / cold-pitch).
  const parsed =
    classification === "real-deal" || classification === "cold-pitch"
      ? parseOffer(inputs.gmailThread)
      : null;

  // 3. Urgency.
  const urgency = urgencyFromThread(inputs.gmailThread, parsed);

  // 4. Suggested rate (real-deal only — no rate for press / partnership / spam).
  let suggestedRate: RateSuggestion | undefined;
  if (classification === "real-deal" && parsed) {
    suggestedRate = await deps.rateCalculator.suggest({
      followerMix: inputs.creatorContext.picture.followerCountByPlatform,
      niche: inputs.creatorContext.picture.niche,
      deliverables: parsed.deliverables,
      floorRate: inputs.creatorContext.floorRate,
      recentDeals: inputs.creatorContext.recentDeals,
    });
  }

  // 5. Contract red-flag scan (parallel for any PDF attachments).
  let redFlags: ContractRedFlagSummary | undefined;
  const pdfAttachments = inputs.gmailThread.attachments.filter(
    (a): a is PdfRef => a.kind === "pdf"
  );
  if (pdfAttachments.length > 0 && classification === "real-deal") {
    // Take the first PDF — most deals attach a single contract.
    redFlags = await deps.contractRedflag.scan({
      contractPdfUrl: pdfAttachments[0].url,
    });
  }

  // 6. Draft 4 reply variants. Voice-apply each. Firewall each.
  const drafts = await deps.variantDrafter.draftVariants({
    thread: inputs.gmailThread,
    classification,
    parsedOffer: parsed,
    suggestedRate,
    voiceFingerprint: inputs.creatorContext.picture.voiceFingerprint,
  });

  const variants: ReplyVariant[] = [];
  const variantKinds: ReplyVariantKind[] = ["enthusiastic", "neutral", "firm", "pass"];
  for (const kind of variantKinds) {
    const raw = drafts[kind];
    if (!raw || raw.trim().length === 0) continue;
    const voiced = await deps.voiceApplier.apply({
      draft: raw,
      soulVoiceFingerprint: inputs.creatorContext.picture.voiceFingerprint,
      toneSlider: kind === "firm" ? "tough-love" : "strategic",
    });
    const citations: string[] = [
      `gmailThread:${inputs.gmailThread.threadId}`,
      `voiceFingerprint:${inputs.creatorContext.creatorId}`,
    ];
    if (suggestedRate) {
      citations.push(`rateCalculator:${kind}`);
    }
    if (parsed?.brand) {
      citations.push(`brand:${parsed.brand}`);
    }
    const verdict = await deps.firewall.check({
      text: voiced.adjustedDraft,
      citations,
    });
    if (!verdict.passed) {
      // Skip this variant rather than ship a hallucination. Caller may
      // receive < 4 variants.
      continue;
    }
    variants.push({
      variant: kind,
      draft: voiced.adjustedDraft,
      citations,
    });
  }

  return {
    classification,
    urgency,
    parsedOffer: parsed,
    ...(suggestedRate ? { suggestedRate } : {}),
    ...(redFlags ? { redFlags } : {}),
    replyVariants: variants,
  };
}
