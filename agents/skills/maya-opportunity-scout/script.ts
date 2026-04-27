/**
 * maya-opportunity-scout — pure-logic helpers.
 *
 * Sprint 3.5b. The Convex action that wires this skill to Brave Search +
 * callMaya + opportunityScoutSeen + (Studio) Apollo/Hunter discovery
 * lives in `convex/agents/skills/opportunityScout.ts` (lead pushes). This
 * module is the pure logic the action composes:
 *
 *   - `MARKETPLACE_QUERIES`: the deterministic UGC marketplace site
 *     filters
 *   - `TWITTER_HASHTAG_QUERIES`: the creator-call hashtags
 *   - `buildScoutQueries`: assemble all query strings for a given creator
 *     context, including local-brand-search via locationSoul
 *   - `dropSeen`: filter out URLs already in opportunityScoutSeen
 *   - `parseFitScoreOutput`: tolerant parser for the model's fit-scoring
 *     pipe-delimited output
 *   - `suggestedActionFor`: deterministic action recommendation given fit
 *
 * Stage-aware adaptive product (Agent B, 2026-04-26): `fitScoringPrompt`
 * accepts an optional `growthPlan` and appends a focusAreas/antiPatterns
 * suffix. The orchestrator should call
 * `assertSkillRespectsGrowthPlan("opportunity-scout", growthPlan)` upstream.
 *
 * No Convex imports. No network. Pure TypeScript.
 */
import {
  growthPlanPromptSuffix,
  routeViaGrowthPlan,
  type CareerStage,
  type GrowthPlanForSkill,
} from "../maya-platform/growthPlanGuard";

export type Platform = "tiktok" | "instagram" | "youtube" | "linkedin" | "x";

export type OpportunitySource =
  | "aspire"
  | "grin"
  | "creator-co"
  | "modash"
  | "backstage"
  | "mavrck"
  | "twitter-creator-call"
  | "local-brand-search";

export type SuggestedAction = "pitch" | "apply" | "monitor" | "skip";

export interface LocationSoul {
  readonly city?: string;
  readonly state?: string;
  readonly country?: string;
}

export interface CreatorPictureSubset {
  readonly niche: string;
  readonly audience: {
    readonly topGeos: ReadonlyArray<string>;
    readonly interestTags: ReadonlyArray<string>;
  };
  readonly followerCount: number;
  readonly locationSoul: LocationSoul;
}

export interface OpportunityScoutInput {
  readonly creatorPicture: CreatorPictureSubset;
  readonly platforms: ReadonlyArray<Platform>;
  readonly lookbackHours: number;
  readonly maxResults?: number;
}

export interface BraveScoutResult {
  readonly title: string;
  readonly url: string;
  readonly description: string;
  readonly publishedAt?: string;
  readonly source: OpportunitySource;
}

export interface RateRange {
  readonly low: number;
  readonly high: number;
}

export interface Opportunity {
  readonly source: OpportunitySource;
  readonly title: string;
  readonly brandName?: string;
  readonly fit: number; // 0..1
  readonly suggestedAction: SuggestedAction;
  readonly reasoning: string;
  readonly dueDate?: string;
  readonly estimatedRateRange?: RateRange;
  readonly url: string;
}

export interface OpportunityCitation {
  readonly kind: "event" | "metric";
  readonly id: string;
  readonly fact: string;
}

export interface OpportunityScoutOutput {
  readonly opportunities: ReadonlyArray<Opportunity>;
  readonly dedupedAgainst: number;
  readonly citations: ReadonlyArray<OpportunityCitation>;
}

/* -------------------------------------------------------------------------- */
/* Query construction                                                          */
/* -------------------------------------------------------------------------- */

export interface MarketplaceSpec {
  readonly source: OpportunitySource;
  readonly siteOperator: string;
  readonly extraTerms: string;
}

/** Site-restricted Brave queries for the UGC marketplaces. */
export const MARKETPLACE_QUERIES: ReadonlyArray<MarketplaceSpec> = [
  { source: "aspire", siteOperator: "site:aspire.io", extraTerms: "creator OR brand brief" },
  { source: "grin", siteOperator: "site:grin.co", extraTerms: "creator opportunities" },
  { source: "creator-co", siteOperator: "site:creator.co", extraTerms: "briefs" },
  { source: "modash", siteOperator: "site:modash.io", extraTerms: "campaign listings" },
  { source: "backstage", siteOperator: "site:backstage.com", extraTerms: "(sponsored OR ugc)" },
  { source: "mavrck", siteOperator: "site:mavrck.io", extraTerms: "brand opportunities" },
];

/** X / Twitter creator-call hashtags. */
export const TWITTER_HASHTAG_QUERIES: ReadonlyArray<string> = [
  "#creatorcall",
  "#ugccreator",
  "#contentcreatorneeded",
  "#brandpartnership",
];

export interface ScoutQuery {
  readonly source: OpportunitySource;
  readonly query: string;
}

/**
 * Wave 2 — stage-aware brand-size targeting. Different stages get different
 * Brave search query templates so the surfaced opportunities are calibrated
 * to what the creator can actually convert.
 *
 *  - just-starting / building → emphasize LOCAL + SMALL businesses (high
 *    conversion at small follower counts; brand pitches close 60%+ at this
 *    band when the brand is local). Query templates inject "small business"
 *    / "local" / "startup" / "indie" qualifiers and bias toward city + state
 *    geo modifiers.
 *  - monetizing / scaling → emphasize REGIONAL + NATIONAL (big enough audience
 *    to convert national-tier deals; pitches need to read as professional
 *    rather than spec). Query templates strip the "small" hedges and add
 *    "national" / "regional" hints.
 *
 * Pure data — `buildScoutQueries` calls this to pick the local query mix
 * per stage. Stage is read from `input.growthPlan?.currentStage` if present,
 * else inferred from `input.creatorPicture.followerCount` (graceful fallback
 * for pre-Wave-2 creators).
 */
export function stageAwareLocalBrandQueries(
  niche: string,
  city: string,
  state: string | null,
  stage: CareerStage
): ScoutQuery[] {
  const localChunk = state ? `${city} ${state}` : city;
  if (stage === "just-starting" || stage === "building") {
    // Foundational creators: tight local + small-business focus.
    return [
      {
        source: "local-brand-search",
        query: `"best ${niche} brands ${localChunk}"`,
      },
      {
        source: "local-brand-search",
        query: `"${niche} small business ${localChunk} looking for content creator"`,
      },
      {
        source: "local-brand-search",
        query: `"${niche} startup ${localChunk}"`,
      },
      {
        source: "local-brand-search",
        query: `"${niche} indie brand ${localChunk}"`,
      },
    ];
  }
  // Senior creators: regional + national tier focus. Local is still useful
  // (location-matched campaigns convert) but we widen the geo and drop the
  // small-business qualifiers.
  return [
    {
      source: "local-brand-search",
      query: `"top ${niche} brands ${localChunk} regional"`,
    },
    {
      source: "local-brand-search",
      query: `"${niche} brand partnerships national" "${localChunk}"`,
    },
    {
      source: "local-brand-search",
      query: `"${niche} agency ${localChunk}"`,
    },
    {
      source: "local-brand-search",
      query: `"established ${niche} brands looking for creator"`,
    },
  ];
}

export function buildScoutQueries(
  input: OpportunityScoutInput,
  /** Wave 2 — optional growthPlan; when present we route via stage. */
  growthPlan?: GrowthPlanForSkill | null
): ScoutQuery[] {
  const niche = input.creatorPicture.niche.trim().toLowerCase() || "creator";
  const queries: ScoutQuery[] = [];

  // 1. Marketplace queries — niche-narrowed.
  for (const m of MARKETPLACE_QUERIES) {
    queries.push({
      source: m.source,
      query: `${m.siteOperator} ${m.extraTerms} "${niche}"`,
    });
  }

  // 2. Twitter creator-call hashtags — niche-narrowed.
  for (const tag of TWITTER_HASHTAG_QUERIES) {
    queries.push({
      source: "twitter-creator-call",
      query: `${tag} "${niche}" site:twitter.com OR site:x.com`,
    });
  }

  // 3. Local brand search — stage-aware (Wave 2). Skip if we have no city.
  const city = input.creatorPicture.locationSoul.city?.trim();
  const state = input.creatorPicture.locationSoul.state?.trim() ?? null;
  if (city && city.length > 0) {
    // Stage source priority: explicit growthPlan → graceful follower-count
    // inference. Pre-Wave-2 callers (no growthPlan) still get local queries
    // because just-starting / building is the default for sub-100K creators.
    const stage: CareerStage =
      growthPlan?.currentStage ??
      inferStageFromFollowers(input.creatorPicture.followerCount);
    queries.push(...stageAwareLocalBrandQueries(niche, city, state, stage));
  }

  return queries;
}

/** Local fallback follower→stage inference for pre-Wave-2 callers. */
function inferStageFromFollowers(followers: number): CareerStage {
  if (followers >= 500_000) return "scaling";
  if (followers >= 100_000) return "monetizing";
  if (followers >= 10_000) return "building";
  return "just-starting";
}

/* -------------------------------------------------------------------------- */
/* Deduplication                                                               */
/* -------------------------------------------------------------------------- */

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

export function dropSeen(
  candidates: ReadonlyArray<BraveScoutResult>,
  seenHashes: ReadonlySet<string>
): { kept: BraveScoutResult[]; droppedCount: number } {
  const kept: BraveScoutResult[] = [];
  const seenInCycle = new Set<string>();
  let dropped = 0;
  for (const c of candidates) {
    const canon = canonicalize(c.url);
    if (seenHashes.has(canon)) {
      dropped++;
      continue;
    }
    if (seenInCycle.has(canon)) {
      dropped++;
      continue;
    }
    seenInCycle.add(canon);
    kept.push(c);
  }
  return { kept, droppedCount: dropped };
}

/* -------------------------------------------------------------------------- */
/* Suggested action mapping                                                    */
/* -------------------------------------------------------------------------- */

export function suggestedActionFor(
  fit: number,
  source: OpportunitySource,
  brandContactKnown: boolean
): SuggestedAction {
  if (fit < 0.3) return "skip";
  if (fit < 0.5) return "monitor";
  // 0.5 — 0.6 → marketplaces become 'apply', else monitor
  if (fit < 0.6) {
    if (
      source === "aspire" ||
      source === "grin" ||
      source === "creator-co" ||
      source === "modash" ||
      source === "backstage" ||
      source === "mavrck"
    ) {
      return "apply";
    }
    return "monitor";
  }
  // fit >= 0.6
  if (brandContactKnown) return "pitch";
  if (
    source === "aspire" ||
    source === "grin" ||
    source === "creator-co" ||
    source === "modash" ||
    source === "backstage" ||
    source === "mavrck"
  ) {
    return "apply";
  }
  // Twitter or local-brand-search with no contact yet → monitor until Studio
  // Apollo/Hunter discovery (or creator manually adds the contact).
  return "monitor";
}

/* -------------------------------------------------------------------------- */
/* Fit-scoring prompt                                                          */
/* -------------------------------------------------------------------------- */

export function fitScoringPrompt(
  picture: CreatorPictureSubset,
  platforms: ReadonlyArray<Platform>,
  candidates: ReadonlyArray<BraveScoutResult>,
  /** Stage-aware growth plan from creatorPicture.growthPlan. Optional. */
  growthPlan?: GrowthPlanForSkill | null
): string {
  const lines: string[] = [];
  lines.push("You are Maya scoring brand-deal opportunities for ONE creator.");
  lines.push(`Creator niche: ${picture.niche}`);
  lines.push(`Creator follower count: ${picture.followerCount.toLocaleString()}`);
  lines.push(`Creator platforms: ${platforms.join(", ")}`);
  if (picture.locationSoul.city) {
    const loc = [picture.locationSoul.city, picture.locationSoul.state].filter(Boolean).join(", ");
    lines.push(`Creator location: ${loc}`);
  }
  if (picture.audience.interestTags.length > 0) {
    lines.push(`Audience interests: ${picture.audience.interestTags.slice(0, 8).join(", ")}`);
  }
  lines.push("");
  lines.push("Candidates:");
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    lines.push(`[${i}] (${c.source}) ${c.title}`);
    lines.push(`     URL: ${c.url}`);
    lines.push(`     Snippet: ${c.description}`);
  }
  lines.push("");
  lines.push("Output ONE line per candidate, in this exact pipe-delimited shape:");
  lines.push("<idx>|<fit 0.0-1.0>|<brand-name-or-NULL>|<one-sentence reasoning>");
  lines.push("");
  lines.push("Score on: niche match, follower-band match, geographic match, platform match.");
  // Wave 2: stage-aware scoring guidance.
  const stage =
    growthPlan?.currentStage ??
    inferStageFromFollowers(picture.followerCount);
  if (stage === "just-starting" || stage === "building") {
    lines.push(
      "STAGE: " +
        stage +
        ". Prioritize LOCAL + SMALL businesses + indie/startup brands. National brands score LOWER for this creator — they close <2% at this size. A local cafe / boutique fit gets a HIGHER score than a national chain even with similar niche match."
    );
  } else {
    lines.push(
      "STAGE: " +
        stage +
        ". Prioritize REGIONAL + NATIONAL brands. Indie/startup brands score lower — at this audience size the rate-floor exceeds what they can afford. Geo match still matters but national fits earn higher fit scores."
    );
  }
  lines.push("Local brands (geo-match) score higher — local pitches convert at multiples of remote.");
  lines.push("Only score what the snippet supports. NULL brand-name is fine when not extractable.");
  lines.push("If you cannot score with confidence, output `<idx>|0.0|NULL|insufficient signal`.");
  // Wave 2 — when the plan flags marketplace prospecting as an antiPattern,
  // route to the matched smartAlternative (e.g. "watch local-brand signal
  // first" + a concrete spec-piece scout action) instead of refusing.
  const route = routeViaGrowthPlan("opportunity-scout", growthPlan);
  const stageSuffix = growthPlanPromptSuffix(growthPlan, {
    smartAlternative: route.smartAlternative,
  });
  if (stageSuffix.length > 0) lines.push(stageSuffix);
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Tolerant parser for fit-scoring output                                      */
/* -------------------------------------------------------------------------- */

export interface ParsedFit {
  readonly idx: number;
  readonly fit: number;
  readonly brandName?: string;
  readonly reasoning: string;
}

export function parseFitScoreOutput(
  raw: string,
  candidateCount: number
): ParsedFit[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const out: ParsedFit[] = [];
  for (const line of lines) {
    const p1 = line.indexOf("|");
    if (p1 < 0) continue;
    const p2 = line.indexOf("|", p1 + 1);
    if (p2 < 0) continue;
    const p3 = line.indexOf("|", p2 + 1);
    if (p3 < 0) continue;
    const idxStr = line.slice(0, p1).trim();
    const fitStr = line.slice(p1 + 1, p2).trim();
    const brandStr = line.slice(p2 + 1, p3).trim();
    const reasoning = line.slice(p3 + 1).trim();
    if (reasoning.length === 0) continue;
    const idx = parseInt(idxStr, 10);
    const fit = parseFloat(fitStr);
    if (Number.isNaN(idx) || idx < 0 || idx >= candidateCount) continue;
    if (Number.isNaN(fit) || fit < 0 || fit > 1) continue;
    out.push({
      idx,
      fit: parseFloat(fit.toFixed(2)),
      brandName: brandStr === "NULL" || brandStr.length === 0 ? undefined : brandStr,
      reasoning,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Citation builder                                                            */
/* -------------------------------------------------------------------------- */

export function buildCitations(
  picture: CreatorPictureSubset,
  surfaced: ReadonlyArray<Opportunity>
): OpportunityCitation[] {
  const cites: OpportunityCitation[] = [
    {
      kind: "metric",
      id: "follower-count",
      fact: `Follower count is ${picture.followerCount.toLocaleString()}.`,
    },
    {
      kind: "metric",
      id: "niche",
      fact: `Niche is ${picture.niche}.`,
    },
  ];
  if (picture.locationSoul.city) {
    const loc = [picture.locationSoul.city, picture.locationSoul.state].filter(Boolean).join(", ");
    cites.push({
      kind: "metric",
      id: "location",
      fact: `Creator location is ${loc}.`,
    });
  }
  for (const o of surfaced) {
    cites.push({
      kind: "event",
      id: `opportunity-${canonicalize(o.url)}`,
      fact: `Opportunity surfaced from ${o.source}: ${o.title} (${o.url}).`,
    });
  }
  return cites;
}
