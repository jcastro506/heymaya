/**
 * maya-platform-algo-researcher — pure-logic helpers.
 *
 * Sprint 3.5. The actual Convex action that wires this skill to Brave +
 * `callMaya` + `platformAlgoCache` lives in `convex/agents/skills/algoResearcher.ts`
 * (lead pushes that file). This module is the pure logic the action composes:
 *
 *   - `ALLOWED_SOURCE_DOMAINS`: the curated allowlist (mirrors SKILL.md)
 *   - `buildBraveQuery`: deterministic query string for a given platform/topic
 *   - `filterAndDedupeResults`: drop non-allowlist results, dedupe by canonical URL
 *   - `pickTtlDays`: per-plan freshness policy
 *   - `synthesisPrompt`: the fixed prompt fed to `callMaya`
 *
 * No Convex imports. No network. Pure TypeScript so the unit tests can run
 * fast and so the action can be re-tested with stubbed inputs.
 */

export type Platform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "linkedin"
  | "x";

/**
 * Curated allowlist of creator-economy publication domains. Mirrors
 * SKILL.md § "Sources monitored". Sibling-scan asserts these stay in sync.
 *
 * Note on YouTube channels (ColinAndSamir, Hank Green): Brave returns video
 * pages or transcript-aggregator pages on these queries, which land on
 * `youtube.com` or `tumblr.com`. We allowlist those domains conditionally
 * via `isAllowedSource`, scoped to the channel handle / username substring.
 */
export const ALLOWED_SOURCE_DOMAINS = [
  "tubefilter.com",
  "variety.com",
  "modernretail.com",
  "thedailydot.com",
  "theinformation.com",
  "morningbrew.com",
  "adweek.com",
  "digiday.com",
] as const;

/** YouTube channels whose video pages count as in-allowlist sources. */
export const ALLOWED_YOUTUBE_CHANNELS = ["colinandsamir"] as const;

/** Substrings on tumblr.com that count as in-allowlist (Hank Green's blog). */
export const ALLOWED_TUMBLR_SUBSTRINGS = ["hankgreen"] as const;

export interface BraveSearchResult {
  readonly title: string;
  readonly url: string;
  readonly description: string;
  readonly publishedAt?: string;
}

export interface AlgoSignal {
  readonly signal: string;
  readonly evidence: string;
  readonly dateLearned: string;
}

export interface AlgoResearcherOutput {
  readonly algoSignals: ReadonlyArray<AlgoSignal>;
  readonly whatsHotNow: string;
  readonly whatsCoolingOff: string;
  readonly sourcesUsed: ReadonlyArray<string>;
  readonly cachedAt: number;
  readonly ttlDays: number;
}

/** Maya's plan tier — duplicated locally to keep this module Convex-free. */
export type Plan = "starter" | "pro" | "studio";

/**
 * Build the Brave query for a given platform/topic. Deterministic.
 *
 * The site filter uses Brave's `OR` syntax. The year suffix narrows results to
 * recent commentary; we re-tune yearly.
 */
export function buildBraveQuery(
  platform: Platform,
  topic: string | undefined,
  year: number
): string {
  const sites = ALLOWED_SOURCE_DOMAINS.map((d) => `site:${d}`).join(" OR ");
  const platformPhrase = `"${platform} algorithm"`;
  const topicSuffix = topic ? ` "${topic}"` : "";
  return `(${sites}) ${platformPhrase}${topicSuffix} ${year}`;
}

/**
 * Returns true when a search-result URL is on the curated allowlist. Used to
 * drop drive-by Reddit/Twitter/Tumblr results from the synthesis pool.
 */
export function isAllowedSource(url: string): boolean {
  let host: string;
  let pathLower: string;
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "").toLowerCase();
    pathLower = u.pathname.toLowerCase();
  } catch {
    return false;
  }

  for (const allowed of ALLOWED_SOURCE_DOMAINS) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }

  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    for (const channel of ALLOWED_YOUTUBE_CHANNELS) {
      if (pathLower.includes(channel)) return true;
    }
    return false;
  }

  if (host === "tumblr.com" || host.endsWith(".tumblr.com")) {
    for (const sub of ALLOWED_TUMBLR_SUBSTRINGS) {
      if (host.includes(sub) || pathLower.includes(sub)) return true;
    }
    return false;
  }

  return false;
}

/**
 * Drop non-allowlist results, dedupe by canonical URL (strip query +
 * trailing slash, lowercase host). Returns at most `limit` survivors,
 * preserving Brave's relevance ranking.
 */
export function filterAndDedupeResults(
  results: ReadonlyArray<BraveSearchResult>,
  limit: number
): BraveSearchResult[] {
  const seen = new Set<string>();
  const out: BraveSearchResult[] = [];
  for (const r of results) {
    if (!isAllowedSource(r.url)) continue;
    const canonical = canonicalize(r.url);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

function canonicalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    let path = u.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${path}`;
  } catch {
    return url.toLowerCase();
  }
}

/** Per-plan TTL policy. Studio's faster cadence yields fresher cache. */
export function pickTtlDays(plan: Plan): number {
  switch (plan) {
    case "starter":
      // Starter never triggers research; the value is informational only,
      // surfaced when Starter reads global cache.
      return 14;
    case "pro":
      return 7;
    case "studio":
      return 3;
  }
}

/**
 * Build the synthesis prompt fed to `callMaya`. Pure string assembly; the
 * model call lives in the Convex action.
 *
 * The prompt is intentionally rigid: we want JSON that conforms to
 * `AlgoResearcherOutput`, with mandatory citation URLs on every signal. The
 * downstream citation firewall enforces this; the prompt makes the model
 * less likely to fail the firewall in the first place.
 */
export function synthesisPrompt(
  platform: Platform,
  topic: string | undefined,
  passages: ReadonlyArray<{ url: string; text: string; publishedAt?: string }>
): string {
  const today = new Date().toISOString().slice(0, 10);
  const passageBlock = passages
    .map(
      (p, i) =>
        `[${i + 1}] ${p.url}${p.publishedAt ? ` (${p.publishedAt})` : ""}\n${p.text}`
    )
    .join("\n\n---\n\n");
  const topicLine = topic ? `Topic narrowing: ${topic}\n` : "";

  return [
    `You are Maya researching the ${platform} algorithm as of ${today}.`,
    topicLine,
    "Read the passages below. Each passage is from a curated creator-economy publication.",
    "",
    passageBlock,
    "",
    "Output STRICTLY a JSON object matching this TypeScript shape:",
    "{",
    '  "algoSignals": Array<{ "signal": string, "evidence": string, "dateLearned": string }>,',
    '  "whatsHotNow": string,',
    '  "whatsCoolingOff": string,',
    '  "sourcesUsed": string[]',
    "}",
    "",
    "Rules:",
    "1. Every signal MUST include the source URL inline in `evidence` (e.g. 'per [URL]: ...').",
    "2. Drop any signal you cannot back to a passage above. No fabrication.",
    "3. `dateLearned` is the ISO date of the source's publishedAt (or today if unknown).",
    "4. `sourcesUsed` is the deduplicated list of URLs you actually cited.",
    "5. If passages do not support any signal, return algoSignals: [] and say so in whatsHotNow / whatsCoolingOff.",
  ].join("\n");
}
