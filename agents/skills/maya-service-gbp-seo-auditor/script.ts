/**
 * maya-service-gbp-seo-auditor — Wave C.6 implementation (judgment-driven).
 *
 * Per `agents/skills/maya-service-gbp-seo-auditor/SKILL.md` AND the operator's
 * 2026-04-27 directive: NO HARDCODED THRESHOLDS. Maya looks at the bundle
 * holistically and produces a 0-100 score + reasoning + 1-3 nudges. The
 * script is a thin wrapper around the LLM call; the only deterministic logic
 * is policy/safety scrubs that the LLM cannot reason around (Google policy
 * violations, prompt-injection neutralization, citation-firewall plumbing).
 *
 * Routing: Gemini 3 Flash MEDIUM thinking — multi-document grounding +
 * judgment without HIGH cost. Per § 3 routing matrix.
 *
 * Plan-tier: ALL tiers (north star — drives jobs + 5-stars).
 *
 * Test seam: `llmCaller` is injectable. When omitted AND no
 * OPENROUTER_API_KEY is present, the script returns a deterministic
 * SAFE-FALLBACK output (low score, generic reasoning, empty nudges) — used
 * for unit tests asserting the orchestration shape without spinning an LLM.
 */

export const SKILL_METADATA = {
  name: "maya-service-gbp-seo-auditor" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "medium" as const,
  routedReason:
    "holistic GBP local-pack judgment over multi-document context (own + competitors + insights + wiki learnings); MEDIUM thinking is the right cost/quality point per § 3 routing matrix",
  planTier: ["starter", "pro", "studio"] as const,
} as const;

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

export interface OwnProfile {
  primaryCategory: string | null;
  secondaryCategories: ReadonlyArray<string>;
  hoursDescribed: boolean;
  sundayHoursSet: boolean;
  holidayHoursSet: boolean;
  servicesList: ReadonlyArray<string>;
  qAndA: { totalQuestions: number; unansweredQuestions: number };
  primaryPhotosSet: boolean;
  photoCount: number;
  daysSinceLatestPhoto: number | null;
  starRating: number | null;
  reviewCount: number | null;
}

export interface RecentPost {
  postedAtIsoDate: string;
  text: string;
  callsClicked?: number;
  directionsClicked?: number;
  websiteClicked?: number;
  postViews?: number;
}

export interface RecentReview {
  receivedAtIsoDate: string;
  starRating: number;
  bodyExcerpt: string;
  replied: boolean;
}

export interface CompetitorProfile {
  name: string;
  primaryCategory: string | null;
  servicesList: ReadonlyArray<string>;
  recentPostsCount30d: number;
  starRating: number | null;
  reviewCount: number | null;
}

export interface InsightsTotals {
  calls30d: number;
  directions30d: number;
  messages30d: number;
}

export interface WikiLearning {
  vaultPath: string;
  claim: string;
  sampleSize: number;
  jobsAttributed: number;
  fiveStarsAttributed: number;
}

export interface AuditorInputs {
  business: {
    businessId: string;
    serviceTypes: ReadonlyArray<string>;
    nameForOperator: string;
  };
  ownProfile: OwnProfile;
  recentPosts: ReadonlyArray<RecentPost>;
  recentReviews: ReadonlyArray<RecentReview>;
  competitors: ReadonlyArray<CompetitorProfile>;
  insightsTotals: InsightsTotals;
  wikiLearnings: ReadonlyArray<WikiLearning>;
}

/* -------------------------------------------------------------------------- */
/* Outputs                                                                     */
/* -------------------------------------------------------------------------- */

export interface AuditorNudge {
  headline: string;
  body: string;
  suggestedAction: "operator-fix" | "maya-draft" | "maya-queue";
  rationale: string;
}

export interface AuditorOutput {
  score: number;
  reasoning: string;
  nudges: ReadonlyArray<AuditorNudge>;
}

export interface LlmCaller {
  (prompt: { system: string; user: string }): Promise<string>;
}

const MAX_NUDGES = 3;
const REASONING_HARD_CAP = 500;
const HEADLINE_HARD_CAP = 80;
const BODY_HARD_CAP = 320;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

/* -------------------------------------------------------------------------- */
/* Policy scrub — the SMALL set of rules the LLM cannot reason around          */
/* -------------------------------------------------------------------------- */

const SPAMMY_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(.+?)\s*\|\s*\1\s*[A-Za-z]+\s*\|\s*\1\b/i, // "Lincoln HVAC | Lincoln HVAC repair"
  /\bask\s+(?:friends|family)\s+to\s+(?:review|leave\s+a\s+review)/i,
  /\bsolicit\s+reviews?\s+from\s+(?:non[-\s]?customers|anyone)/i,
  /\bbuy\s+(?:fake|paid)\s+reviews/i,
];

function bodyPassesPolicy(body: string): boolean {
  return !SPAMMY_PATTERNS.some((r) => r.test(body));
}

/** Drop any nudge whose body fails the Google-policy scrub. */
function scrubNudges(nudges: ReadonlyArray<AuditorNudge>): AuditorNudge[] {
  return nudges
    .filter((n) => bodyPassesPolicy(n.body))
    .filter((n) => bodyPassesPolicy(n.headline));
}

function neutralizeInjection(text: string): string {
  return text
    .replace(/\bignore (?:all )?(?:previous|prior|above) instructions?\b/gi, "[redacted]")
    .replace(/\b(system|assistant)\s*:\s*/gi, "")
    .replace(/<\|.*?\|>/g, "")
    .trim();
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  return lastSpace > max * 0.5
    ? sliced.slice(0, lastSpace).trimEnd()
    : sliced;
}

function clampScore(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return SCORE_MIN;
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(n)));
}

/* -------------------------------------------------------------------------- */
/* Competitor name verification (drop unverified names)                        */
/* -------------------------------------------------------------------------- */

/**
 * Build the verified competitor-name set the LLM is allowed to cite.
 * Caller passes the full competitor bundle; the orchestrator is responsible
 * for ensuring those names are sourced from `localPositioning.namedCompetitors`.
 */
function verifiedCompetitorSet(inputs: AuditorInputs): Set<string> {
  return new Set(inputs.competitors.map((c) => c.name.toLowerCase()));
}

function nudgeCitesUnverifiedCompetitor(
  body: string,
  verified: Set<string>
): boolean {
  // Heuristic: if the body contains a quoted name with a possessive ('s) or
  // capitalized word run that looks like a business name AND that name isn't
  // in the verified set, drop. We only flag the specific patterns competitors
  // are referenced as ("Joe's HVAC", "Allied Plumbing") — generic words like
  // "Google" or "Yelp" are noise and ignored.
  const proper = body.match(/\b([A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+)+)\b/g);
  if (!proper) return false;
  for (const name of proper) {
    if (verified.has(name.toLowerCase())) continue;
    // Whitelist common non-competitor capitalized phrases.
    if (/\b(?:Google|Yelp|Bing|Facebook|Instagram|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|January|February|March|April|May|June|July|August|September|October|November|December|GBP|HVAC|AC)\b/.test(name)) {
      continue;
    }
    return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Prompt assembly                                                             */
/* -------------------------------------------------------------------------- */

function buildSystemPrompt(): string {
  return [
    "You are Maya, a service-business AI manager and a GBP local-pack SEO expert.",
    "",
    "Your job is to audit the operator's Google Business Profile holistically and produce:",
    "  1) a score 0-100 reflecting your read on local-pack health (your judgment, not a formula);",
    "  2) reasoning prose ≤500 chars explaining the score, citing specific data points;",
    "  3) 1-3 prioritized nudges with cited bodies and suggested actions.",
    "",
    "How to think:",
    "  - Look at all the data holistically: profile completeness, posts cadence + engagement, reviews velocity + ratings, photos recency, Q&A activity, named competitors, GBP Insights signals.",
    "  - When the wikiLearnings array is non-empty, those patterns are evidence of what's worked for THIS business — weight your judgment toward those specifics.",
    "  - When wikiLearnings is empty, fall back to general trade priors but signal lower confidence in your reasoning.",
    "  - Never invent data. If a competitor isn't in the inputs, don't cite one.",
    "  - Never recommend Google-policy violations: keyword-stuffed business names, fake reviews, soliciting non-customers.",
    "  - Cap at 3 nudges. Pick the highest-leverage ones.",
    "",
    "Suggested-action options:",
    '  - "operator-fix": the operator must do this in the GBP dashboard (add service, set hours, claim category).',
    '  - "maya-draft": Maya can draft a reply/post and queue for approval (answer pending Q&A; draft a GBP post from the content library).',
    '  - "maya-queue": Maya can directly enqueue the next-step skill (trigger gbp-post-optimizer; trigger review-request-drafter).',
    "",
    "Output STRICT JSON only — no prose, no code fences. Schema:",
    `{"score": <0-100 int>, "reasoning": "<= 500 chars", "nudges": [{"headline": "<= 80 chars", "body": "<= 320 chars", "suggestedAction": "operator-fix"|"maya-draft"|"maya-queue", "rationale": "1 line"}]}`,
  ].join("\n");
}

function buildUserPrompt(inputs: AuditorInputs): string {
  // Neutralize prompt-injection in any free-text the LLM will read, while
  // keeping the structure intact.
  const safeCompetitors = inputs.competitors.map((c) => ({
    ...c,
    name: neutralizeInjection(c.name).slice(0, 80),
  }));
  const safePosts = inputs.recentPosts.map((p) => ({
    ...p,
    text: neutralizeInjection(p.text).slice(0, 320),
  }));
  const safeReviews = inputs.recentReviews.map((r) => ({
    ...r,
    bodyExcerpt: neutralizeInjection(r.bodyExcerpt).slice(0, 240),
  }));
  const safeWiki = inputs.wikiLearnings.map((w) => ({
    ...w,
    claim: neutralizeInjection(w.claim).slice(0, 240),
  }));
  return JSON.stringify(
    {
      business: inputs.business,
      ownProfile: inputs.ownProfile,
      recentPosts: safePosts,
      recentReviews: safeReviews,
      competitors: safeCompetitors,
      insightsTotals: inputs.insightsTotals,
      wikiLearnings: safeWiki,
    },
    null,
    2
  );
}

/* -------------------------------------------------------------------------- */
/* Parse + validate LLM output                                                 */
/* -------------------------------------------------------------------------- */

interface RawAuditorOutput {
  score?: unknown;
  reasoning?: unknown;
  nudges?: unknown;
}

function parseLlmJson(raw: string): RawAuditorOutput {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* fall through */
      }
    }
    return {};
  }
}

const VALID_ACTIONS = new Set([
  "operator-fix",
  "maya-draft",
  "maya-queue",
]);

function normalizeNudges(
  raw: unknown,
  verifiedCompetitors: Set<string>
): AuditorNudge[] {
  if (!Array.isArray(raw)) return [];
  const out: AuditorNudge[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const headlineRaw =
      typeof obj.headline === "string" ? obj.headline.trim() : "";
    const bodyRaw = typeof obj.body === "string" ? obj.body.trim() : "";
    const actionRaw =
      typeof obj.suggestedAction === "string" ? obj.suggestedAction : "";
    const rationaleRaw =
      typeof obj.rationale === "string" ? obj.rationale.trim() : "";
    if (!headlineRaw || !bodyRaw || !VALID_ACTIONS.has(actionRaw)) continue;
    const headline = cap(headlineRaw, HEADLINE_HARD_CAP);
    const body = cap(bodyRaw, BODY_HARD_CAP);
    if (!bodyPassesPolicy(body)) continue;
    if (!bodyPassesPolicy(headline)) continue;
    if (nudgeCitesUnverifiedCompetitor(body, verifiedCompetitors)) continue;
    if (nudgeCitesUnverifiedCompetitor(headline, verifiedCompetitors)) continue;
    out.push({
      headline,
      body,
      suggestedAction: actionRaw as AuditorNudge["suggestedAction"],
      rationale: cap(rationaleRaw, 200),
    });
    if (out.length >= MAX_NUDGES) break;
  }
  return out;
}

function safeFallbackOutput(): AuditorOutput {
  return {
    score: 50,
    reasoning:
      "Maya did not have an LLM available to score this run. Falling back to a neutral score; this row will be replaced on next audit.",
    nudges: [],
  };
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                          */
/* -------------------------------------------------------------------------- */

export interface AuditOptions {
  /** Pass an LLM caller. When omitted, returns a deterministic safe fallback. */
  llmCaller?: LlmCaller | null;
}

export async function auditGbpForBusiness(
  inputs: AuditorInputs,
  options: AuditOptions = {}
): Promise<AuditorOutput> {
  if (!options.llmCaller) {
    return safeFallbackOutput();
  }
  const verifiedCompetitors = verifiedCompetitorSet(inputs);
  let raw: string;
  try {
    raw = await options.llmCaller({
      system: buildSystemPrompt(),
      user: buildUserPrompt(inputs),
    });
  } catch {
    return safeFallbackOutput();
  }
  const parsed = parseLlmJson(raw);
  const score = clampScore(parsed.score);
  const reasoning =
    typeof parsed.reasoning === "string" && parsed.reasoning.trim()
      ? cap(parsed.reasoning.trim(), REASONING_HARD_CAP)
      : "Maya's reasoning was not produced this run.";
  const nudges = scrubNudges(
    normalizeNudges(parsed.nudges, verifiedCompetitors)
  );
  return { score, reasoning, nudges };
}
