/**
 * maya-industry-intel — pure-logic helpers.
 *
 * Sprint 3.5. The Convex action that wires this skill to Brave + callMaya +
 * `industryIntelSeen` lives in `convex/agents/skills/industryIntel.ts`
 * (lead pushes). This module is the pure logic the action composes:
 *
 *   - `ALLOWED_SOURCE_DOMAINS`: the curated allowlist (kept in sync with
 *     `maya-platform-algo-researcher` via the sibling-file scan test —
 *     inlined here because vitest's edge-runtime can't resolve sibling-skill
 *     source-to-source imports cleanly. TODO(s7): once we land a shared
 *     `agents/lib/` module, both skills should import from there.)
 *   - `buildNewsQuery`: deterministic Brave query for the cycle window
 *   - `dropSeen`: filter out URLs the creator has already been shown
 *   - `filterAndRank`: apply relevance threshold + sort + cap
 *   - `defaultMaxItems`: per-plan default
 *
 * No Convex imports. No network. Pure TypeScript.
 */

export type Platform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "linkedin"
  | "x";

/**
 * Curated allowlist of creator-economy publication domains. MUST stay in
 * sync with `maya-platform-algo-researcher/script.ts`'s
 * `ALLOWED_SOURCE_DOMAINS`. Sibling-file scan asserts they match.
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
const ALLOWED_YOUTUBE_CHANNELS = ["colinandsamir"] as const;

/** Substrings on tumblr.com that count as in-allowlist (Hank Green's blog). */
const ALLOWED_TUMBLR_SUBSTRINGS = ["hankgreen"] as const;

/**
 * Returns true when a search-result URL is on the curated allowlist.
 * Mirrors `maya-platform-algo-researcher/script.ts:isAllowedSource`.
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

export type Plan = "starter" | "pro" | "studio";

export interface BraveNewsResult {
  readonly title: string;
  readonly url: string;
  readonly description: string;
  readonly publishedAt: string; // ISO date — required for industry-intel
  readonly source: string;
}

export interface ScoredItem {
  readonly headline: string;
  readonly source: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly relevanceToCreator: string;
  readonly relevanceScore: number; // 0-100
}

/** Per-plan default maxItems. Studio gets a richer surface. */
export function defaultMaxItems(plan: Plan): number {
  switch (plan) {
    case "starter":
      return 0; // gated upstream; included for type safety
    case "pro":
      return 5;
    case "studio":
      return 10;
  }
}

/**
 * Build a deterministic Brave Search query for the daily cycle. We narrow by
 * site + the seed phrase "creator economy" + the year so older items don't
 * dominate the result list.
 */
export function buildNewsQuery(year: number): string {
  const sites = ALLOWED_SOURCE_DOMAINS.map((d) => `site:${d}`).join(" OR ");
  return `(${sites}) "creator economy" ${year}`;
}

/**
 * Drop candidates the creator has already been shown. `seenUrls` is the set
 * of URLs from `industryIntelSeen` for this creator (canonical form).
 */
export function dropSeen(
  candidates: ReadonlyArray<BraveNewsResult>,
  seenUrls: ReadonlySet<string>
): BraveNewsResult[] {
  const out: BraveNewsResult[] = [];
  for (const c of candidates) {
    if (!isAllowedSource(c.url)) continue;
    const canonical = canonicalize(c.url);
    if (seenUrls.has(canonical)) continue;
    out.push(c);
  }
  return out;
}

export function canonicalize(url: string): string {
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

export interface FilterAndRankOptions {
  readonly relevanceThreshold: number; // default 50
  readonly maxItems: number;
}

/**
 * Apply relevance threshold + sort by score descending + cap to `maxItems`.
 * The relevance score and `relevanceToCreator` text come from the model's
 * scoring pass; this helper only does the filter/sort/cap.
 */
export function filterAndRank(
  scored: ReadonlyArray<ScoredItem>,
  opts: FilterAndRankOptions
): ScoredItem[] {
  const threshold = opts.relevanceThreshold ?? 50;
  return scored
    .filter((s) => s.relevanceScore >= threshold)
    .slice() // copy before sort
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, Math.max(0, opts.maxItems));
}

/**
 * Build the model prompt that scores candidates against the creator's niche
 * and platforms. The model returns one line per candidate of the form
 * `<idx>|<score>|<one-sentence relevance>` so we can parse without LLM-shaped
 * JSON ambiguity.
 */
export function scoringPrompt(
  niche: string,
  platforms: ReadonlyArray<Platform>,
  candidates: ReadonlyArray<BraveNewsResult>
): string {
  const platformsLine = platforms.length > 0 ? platforms.join(", ") : "(none specified)";
  const candidateBlock = candidates
    .map(
      (c, i) =>
        `[${i}] ${c.source} | ${c.publishedAt} | ${c.title}\n     URL: ${c.url}\n     Snippet: ${c.description}`
    )
    .join("\n");

  return [
    "You are Maya scoring creator-economy news for relevance to ONE creator.",
    `Creator niche: ${niche}`,
    `Creator platforms: ${platformsLine}`,
    "",
    "Candidates:",
    candidateBlock,
    "",
    "Output ONE line per candidate, in this exact pipe-delimited shape:",
    "<idx>|<score 0-100>|<one-sentence why-this-matters-to-this-creator>",
    "",
    "Rules:",
    "- Score 0 if the item touches none of: this niche, these platforms, the creator-economy at large.",
    "- Score 100 only for items that materially change what this creator should DO this week.",
    "- One sentence per item. No fabrication: say only what the headline + snippet support.",
    "- If you cannot score an item with confidence, output `<idx>|0|insufficient signal`.",
  ].join("\n");
}

/** Parse the model's pipe-delimited scoring output. Strict parser. */
export function parseScoredLines(
  raw: string,
  candidates: ReadonlyArray<BraveNewsResult>
): ScoredItem[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const out: ScoredItem[] = [];
  for (const line of lines) {
    // Preserve the relevance text verbatim — including any pipes inside it.
    // We only trim the idx + score fields; the rel text is whatever follows
    // the second pipe.
    const firstPipe = line.indexOf("|");
    if (firstPipe < 0) continue;
    const secondPipe = line.indexOf("|", firstPipe + 1);
    if (secondPipe < 0) continue;
    const idxStr = line.slice(0, firstPipe).trim();
    const scoreStr = line.slice(firstPipe + 1, secondPipe).trim();
    const rel = line.slice(secondPipe + 1).trim();
    if (rel.length === 0) continue;
    const idx = parseInt(idxStr, 10);
    const score = parseInt(scoreStr, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= candidates.length) continue;
    if (Number.isNaN(score) || score < 0 || score > 100) continue;
    const c = candidates[idx];
    out.push({
      headline: c.title,
      source: c.source,
      url: c.url,
      publishedAt: c.publishedAt,
      relevanceToCreator: rel,
      relevanceScore: score,
    });
  }
  return out;
}
