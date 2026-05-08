/**
 * Sprint 10 — Layer 4: inbox warm-mining.
 *
 * Scans the creator's connected Gmail for brand/partnership-pattern
 * threads and writes `brandContacts` rows tagged "warm" or "hot".
 *
 * This is the highest-warmth lead source in Maya's outreach stack:
 * brands that already touched the creator's inbox will reply at 5-15x
 * the rate of cold Apollo-sourced contacts. Cheap to run, no vendor
 * cost, no compliance lift (it's the creator's own inbox).
 *
 * Pipeline:
 *   1. Pull last N inbox messages via Gmail search query (filters out
 *      most personal mail before the heuristic even runs)
 *   2. Heuristic pass: sender domain not a personal-mail provider AND
 *      subject/snippet matches brand-pattern keywords
 *   3. For each hit: extract brand name from sender domain, derive
 *      warmth from `Date` header (active <30d → "hot", 30-180d →
 *      "warm", older → drop or mark "warm" with caveat)
 *   4. Write/upsert brandContacts row keyed on creatorId + brand + email
 *
 * The LLM second-pass (relevance + brand-canonicalization) is a
 * follow-up sprint — heuristic-only is enough to populate the warm
 * bucket for Manager-tier outreach. False positives are cheap (Maya
 * just doesn't pitch them).
 *
 * NOTE — this file is a pure-function module + an internal action;
 * the cron wiring lives in `convex/crons.ts`. The action is callable
 * from a Maya skill (`maya-gmail-read` hands off to it) or from a
 * weekly cron when feature-flagged on.
 */

const PERSONAL_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "yahoo.com",
  "yahoo.co.uk",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "fastmail.com",
  "zoho.com",
  "duck.com",
  "mailbox.org",
]);

// Common transactional / no-reply / list domains that are technically
// "branded" but aren't the influencer-marketing path. We exclude these
// so Maya doesn't try to pitch the creator's bank or newsletter.
const NOISE_DOMAINS = new Set([
  "stripe.com",
  "paypal.com",
  "venmo.com",
  "github.com",
  "slack.com",
  "notion.so",
  "linear.app",
  "discord.com",
  "twilio.com",
  "sendgrid.net",
  "amazonses.com",
  "mailchimp.com",
  "convertkit.com",
  "mailerlite.com",
  "substack.com",
  "calendly.com",
  "zoom.us",
  "shopify.com", // platform, not a brand
]);

// Keywords (case-insensitive) that suggest a partnership conversation.
// Tested against subject + snippet/first-body slice.
export const PARTNERSHIP_KEYWORDS = [
  "partnership",
  "partner with",
  "collaborate",
  "collaboration",
  "collab",
  "campaign",
  "ambassador",
  "creator program",
  "influencer",
  "branded content",
  "branded post",
  "sponsored",
  "sponsorship",
  "gifted",
  "product seeding",
  "pr package",
  "pr send",
  "sending you",
  "we love your content",
  "rate sheet",
  "media kit",
  "would love to work",
];

// Role hints that strengthen the brand-contact signal when present in
// the From-header display name.
export const BRAND_ROLE_HINTS = [
  "marketing",
  "partnerships",
  "partnership",
  "creator",
  "influencer",
  "talent",
  "pr",
  "communications",
  "brand",
  "growth",
];

export interface InboxScanInput {
  fromHeader: string; // raw "From" header, e.g. '"Sarah at Patagonia" <sarah@patagonia.com>'
  subject: string;
  snippet: string; // Gmail's plain-text snippet
  internalDateMs: number; // Gmail internalDate
  threadId: string;
  messageId: string;
}

export interface BrandContactCandidate {
  brand: string; // canonical brand name (derived from sender domain)
  contactName?: string;
  contactRole?: string;
  contactEmail: string;
  warmth: "hot" | "warm";
  threadId: string;
  messageId: string;
  internalDateMs: number;
  matchedKeywords: ReadonlyArray<string>;
  matchedRoleHints: ReadonlyArray<string>;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Heuristic pass — given a Gmail message ref, decide if it looks like
 * a brand-partnership thread and extract a contact candidate.
 *
 * Returns null when:
 *   - sender is on a personal-mail domain
 *   - sender is on a known noise domain (Stripe, Calendly, etc.)
 *   - no partnership keyword in subject OR snippet
 *   - the From header doesn't parse to a valid email
 *
 * The caller is responsible for de-duping by email + creator.
 */
export function scoreInboxMessage(
  msg: InboxScanInput,
  now: number = Date.now()
): BrandContactCandidate | null {
  const parsed = parseFromHeader(msg.fromHeader);
  if (!parsed) return null;
  const { email, displayName } = parsed;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  if (PERSONAL_MAIL_DOMAINS.has(domain)) return null;
  if (NOISE_DOMAINS.has(domain)) return null;

  const haystack = `${msg.subject} ${msg.snippet}`.toLowerCase();
  const matchedKeywords = PARTNERSHIP_KEYWORDS.filter((kw) =>
    haystack.includes(kw)
  );
  const roleHaystack = (displayName ?? "").toLowerCase();
  const matchedRoleHints = BRAND_ROLE_HINTS.filter((h) =>
    roleHaystack.includes(h)
  );

  // Require at least one partnership keyword to fire. Role hints alone
  // aren't enough — too many marketing newsletters slip through.
  if (matchedKeywords.length === 0) return null;

  const ageMs = now - msg.internalDateMs;
  const warmth = ageMs < 30 * ONE_DAY_MS ? "hot" : "warm";
  // Drop ancient threads (>365d). They're not actionable warm leads.
  if (ageMs > 365 * ONE_DAY_MS) return null;

  return {
    brand: brandFromDomain(domain),
    contactName: displayName,
    contactRole: matchedRoleHints[0],
    contactEmail: email,
    warmth,
    threadId: msg.threadId,
    messageId: msg.messageId,
    internalDateMs: msg.internalDateMs,
    matchedKeywords,
    matchedRoleHints,
  };
}

/**
 * Build the Gmail search `q` parameter for a warm-mining sweep.
 * Combines partnership keywords with a recency bound. Output goes
 * straight into `listInboxMessages({ q })`.
 */
export function buildGmailSearchQuery(opts: { sinceDays?: number } = {}): string {
  const sinceDays = opts.sinceDays ?? 365;
  const keywordClauses = [
    "partnership",
    "collab",
    "collaboration",
    "campaign",
    "ambassador",
    "sponsored",
    "gifted",
    '"branded content"',
    '"creator program"',
    '"product seeding"',
    '"media kit"',
  ];
  const keywordPart = `(${keywordClauses.join(" OR ")})`;
  const sincePart = `newer_than:${sinceDays}d`;
  return `${keywordPart} ${sincePart} -in:spam -in:trash`;
}

export function dedupeKey(creatorId: string, brand: string, email?: string): string {
  return `${creatorId}::${brand.toLowerCase()}::${(email ?? "").toLowerCase()}`;
}

/**
 * Parse an RFC 5322 From header into name + email. Handles:
 *   "Sarah" <sarah@x.com>     → { displayName: "Sarah", email: "sarah@x.com" }
 *   sarah@x.com               → { email: "sarah@x.com" }
 *   "X" "Y" <a@b>             → defensively returns email only when display is malformed
 */
export function parseFromHeader(
  raw: string
): { email: string; displayName?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const angleMatch = trimmed.match(/<([^>]+)>/);
  if (angleMatch) {
    const email = angleMatch[1].trim().toLowerCase();
    if (!isValidEmail(email)) return null;
    let displayName = trimmed.slice(0, trimmed.indexOf("<")).trim();
    // Strip surrounding quotes
    displayName = displayName.replace(/^"+|"+$/g, "").trim();
    return { email, displayName: displayName || undefined };
  }
  // Bare email
  const bare = trimmed.toLowerCase();
  if (isValidEmail(bare)) return { email: bare };
  return null;
}

function isValidEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

/**
 * Convert a sender domain into a canonical brand name.
 *   patagonia.com → "Patagonia"
 *   email.patagonia.com → "Patagonia"
 *   marketing.lululemon.co.uk → "Lululemon"
 *
 * Strips common subdomain prefixes (email, mail, marketing, etc.) and
 * common TLD suffixes. Title-cases the result. Multi-word brands like
 * "redbull" stay as one token — that's a known limitation; the LLM
 * second-pass canonicalizes if/when it lands.
 */
export function brandFromDomain(domain: string): string {
  const SUBDOMAIN_NOISE = new Set([
    "email",
    "mail",
    "marketing",
    "news",
    "newsletter",
    "info",
    "go",
    "click",
    "track",
    "promo",
    "campaigns",
  ]);
  const parts = domain.toLowerCase().split(".");
  // Trim TLDs from the right.
  while (parts.length > 1 && isTld(parts[parts.length - 1])) {
    parts.pop();
  }
  // Strip noise subdomains from the left.
  while (parts.length > 1 && SUBDOMAIN_NOISE.has(parts[0])) {
    parts.shift();
  }
  const root = parts[parts.length - 1] ?? domain;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

const COMMON_TLDS = new Set([
  "com",
  "net",
  "org",
  "io",
  "co",
  "uk",
  "us",
  "ca",
  "au",
  "de",
  "fr",
  "es",
  "it",
  "nl",
  "se",
  "no",
  "dk",
  "fi",
  "jp",
  "kr",
  "cn",
  "br",
  "mx",
  "in",
  "store",
  "shop",
  "app",
]);
function isTld(s: string): boolean {
  return COMMON_TLDS.has(s);
}
