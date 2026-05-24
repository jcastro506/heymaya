import { z } from "zod";

/**
 * Sprint 3 — Research query builder.
 *
 * Per CLAWLAUNCH_GTM_MVP_EXECUTION_SPRINT.md § Sprint 3: takes a
 * `ProductDiagnosis` (from maya-app-inspector) + `IcpHypotheses` (from
 * maya-icp-hypothesis) + optional competitor data + walkthrough, and
 * generates per-platform `PlatformQueryPack`s. Sprint 4 platform workers
 * consume these to know what to search for + how many evidence cards to
 * require.
 *
 * Doctrine source: PLAYBOOK § 1.2 (positioning sentence), § 3 (channel
 * tree), § 4 (BUILD/ENGAGE/OFFER triad — query intent must match mode),
 * plus the per-platform playbooks (reddit.md § 4, x.md § 3, tiktok.md
 * § 7, linkedin.md § 5, instagram.md § 4). Output is structured so
 * Sprint 4 workers can fire queries in parallel + dedupe results.
 *
 * Non-goals: this module does NOT call ScrapeCreators. It does NOT spend
 * any budget. It's pure synthesis from already-collected diagnosis +
 * ICPs. Output is consumed by Sprint 4 workers which apply per-call
 * budget gates.
 */

export const PlatformSchema = z.enum([
  "reddit",
  "twitter",
  "tiktok",
  "instagram",
  "linkedin",
  "google",
]);
export type GtmQueryPlatform = z.infer<typeof PlatformSchema>;

/**
 * Per-platform query bundle Sprint 4 workers fire against ScrapeCreators.
 * Each query is a bare string ready to feed into the wrapper.
 */
export const PlatformQueryPackSchema = z.object({
  platform: PlatformSchema,
  /** Queries that surface pain expression — "how do I X", "anyone using",
   *  "frustrated with", "alternative to". Highest signal. */
  painQueries: z.array(z.string()),
  /** Queries that surface solution discussion — adjacent tools, category
   *  shopping, recommendation requests. Buyer-intent signal. */
  solutionQueries: z.array(z.string()),
  /** Queries that surface competitor mentions + switcher signals. */
  competitorQueries: z.array(z.string()),
  /** Queries that surface format mining (TikTok hook patterns, X thread
   *  formats, IG carousel anatomies). Empty for text-only platforms. */
  formatQueries: z.array(z.string()),
  /** Negation set — queries we use to detect off-niche noise. Workers
   *  drop results matching these. */
  exclusionQueries: z.array(z.string()),
  /** Minimum evidence cards a worker must produce to call this platform
   *  research "successful". Below = worker returns insufficient_evidence
   *  and channel-judge demotes the platform. */
  minimumEvidenceCards: z.number().int().nonnegative(),
  /** Hard per-platform call budget. Workers stop after spending this
   *  even if more queries are queued. */
  maxCalls: z.number().int().nonnegative(),
});
export type PlatformQueryPack = z.infer<typeof PlatformQueryPackSchema>;

/**
 * The result Sprint 3 returns. Workers iterate this map. Platforms that
 * have been parked by channel-judge are absent from the map (Sprint 3
 * doesn't decide channel selection — channel-judge does — but it WILL
 * skip platforms the ICP can't be located on).
 */
export interface ResearchQueryPlan {
  packs: PlatformQueryPack[];
  /** Platforms intentionally skipped + why (passed to channel-judge as
   *  hints for the parked-channel rationale). */
  skipped: Array<{ platform: GtmQueryPlatform; reason: string }>;
  /** Inputs hash — workers stamp this on evidence cards so we can trace
   *  which query plan produced which evidence. */
  planFingerprint: string;
}

/**
 * Minimum shape this module needs from ProductDiagnosis (the
 * maya-app-inspector output). Kept narrow on purpose so the query
 * builder isn't coupled to internal app-inspector implementation.
 */
export interface ProductDiagnosisInput {
  productName: string;
  productCategoryKeywords: string[]; // 2-5 phrases describing the category
  oneSentencePromise: string;        // "<product> helps <buyer> <verb-outcome>"
  showability: "screen-recordable" | "screenshot-only" | "unshowable";
  competitorMentions: string[];
  unverifiable: boolean;
}

/**
 * Minimum shape from maya-icp-hypothesis. We pull the top N hypotheses
 * and craft queries per ICP.
 */
export interface IcpHypothesisInput {
  id: string;
  buyer: string;
  currentPain: string;
  currentWorkaround: string;
  locatableOn: GtmQueryPlatform;
}

export interface BuildResearchQueryPlanInput {
  diagnosis: ProductDiagnosisInput;
  icpHypotheses: IcpHypothesisInput[];
  /** Optional substitute set from maya-competitor-researcher. Empty is
   *  fine — we'll still craft "alternative to <competitor>" queries
   *  from diagnosis.competitorMentions. */
  substitutes?: string[];
  /** Operator-stated audiences to EXCLUDE — e.g. "enterprise procurement". */
  excludedAudiences?: string[];
  /** Per-platform call budget (defaults match PLAYBOOK § 2 + research-doc
   *  call-budget sketch). */
  budgetOverrides?: Partial<Record<GtmQueryPlatform, number>>;
}

const DEFAULT_BUDGETS: Record<GtmQueryPlatform, number> = {
  // Matches the original sprint plan's per-platform call-budget sketch.
  reddit: 8,
  tiktok: 12,
  twitter: 8,
  instagram: 8,
  linkedin: 4,
  google: 4,
};

const DEFAULT_MIN_EVIDENCE: Record<GtmQueryPlatform, number> = {
  // Sprint 4 worker contract: below these, return insufficient_evidence.
  reddit: 5,
  tiktok: 5,
  twitter: 5,
  instagram: 3,
  linkedin: 3,
  google: 3,
};

const STOP_PHRASES = new Set(
  [
    "the",
    "and",
    "or",
    "but",
    "with",
    "for",
    "to",
    "of",
    "in",
    "on",
    "at",
    "an",
    "a",
    "is",
    "be",
    "this",
    "that",
    "by",
    "as",
    "from",
  ].map((w) => w.toLowerCase())
);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOP_PHRASES.has(t));
}

function uniqueTrimmed(strings: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of strings) {
    const s = raw.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Stable hash of plan inputs — workers stamp this onto evidence cards
 * so we can group evidence by-plan + invalidate stale plans cleanly.
 */
function fingerprint(input: BuildResearchQueryPlanInput): string {
  const canonical = JSON.stringify(
    {
      promise: input.diagnosis.oneSentencePromise,
      categories: input.diagnosis.productCategoryKeywords.slice().sort(),
      icpBuyers: input.icpHypotheses.map((h) => h.buyer).sort(),
      competitors: input.diagnosis.competitorMentions.slice().sort(),
      substitutes: (input.substitutes ?? []).slice().sort(),
    }
  );
  let acc = 0;
  for (let i = 0; i < canonical.length; i++) {
    acc = (acc * 31 + canonical.charCodeAt(i)) | 0;
  }
  return (acc >>> 0).toString(16).padStart(8, "0");
}

// ──────────────────────────────────────────────────────────────────────
// Per-platform pack builders
// ──────────────────────────────────────────────────────────────────────

function buildRedditPack(
  input: BuildResearchQueryPlanInput,
  budget: number
): PlatformQueryPack {
  const cats = input.diagnosis.productCategoryKeywords;
  const icpsOnRedditOrAdjacent = input.icpHypotheses.filter(
    (h) => h.locatableOn === "reddit" || h.locatableOn === "google"
  );
  const painPhrasesFromIcps = icpsOnRedditOrAdjacent
    .map((h) => h.currentPain)
    .filter(Boolean);

  // Reddit reply-mining patterns from reddit.md § 4 + indie-hacker
  // conventions: "how do I", "anyone using", "alternative to", "best
  // tool for", "frustrated with". Higher signal than topic-only.
  const painQueries = uniqueTrimmed([
    ...cats.map((c) => `how do I ${c}`),
    ...cats.map((c) => `best tool for ${c}`),
    ...painPhrasesFromIcps.map((p) => `"${p}"`),
    ...cats.map((c) => `frustrated with ${c}`),
  ]);

  const solutionQueries = uniqueTrimmed([
    ...cats.map((c) => `recommendations for ${c}`),
    ...cats.map((c) => `anyone using ${c}`),
    ...painPhrasesFromIcps.map((p) => `solution for "${p}"`),
  ]);

  const competitorQueries = uniqueTrimmed([
    ...input.diagnosis.competitorMentions.flatMap((c) => [
      `alternative to ${c}`,
      `vs ${c}`,
      `${c} pricing`,
    ]),
    ...(input.substitutes ?? []).map((s) => `replace ${s}`),
  ]);

  const exclusionQueries = uniqueTrimmed([
    ...(input.excludedAudiences ?? []).map((a) => `-${a}`),
    // Reddit-specific noise: avoid "show off your" weekly threads + AMA
    // theater that won't drive product mentions.
    "-AMA",
    "-promotional",
  ]);

  return {
    platform: "reddit",
    painQueries,
    solutionQueries,
    competitorQueries,
    formatQueries: [], // Reddit isn't format-mined; the post format IS the format.
    exclusionQueries,
    minimumEvidenceCards: DEFAULT_MIN_EVIDENCE.reddit,
    maxCalls: budget,
  };
}

function buildTwitterPack(
  input: BuildResearchQueryPlanInput,
  budget: number
): PlatformQueryPack {
  const cats = input.diagnosis.productCategoryKeywords;
  const icpsOnX = input.icpHypotheses.filter(
    (h) => h.locatableOn === "twitter"
  );
  const painPhrasesFromIcps = icpsOnX
    .map((h) => h.currentPain)
    .filter(Boolean);

  // Twitter reply-mining queries per x.md § 3 advanced search operators.
  // Wrap in quotes for exact phrase matching; combine with -filter:retweets.
  const painQueries = uniqueTrimmed([
    ...cats.map((c) => `"looking for a tool that ${c}"`),
    ...cats.map((c) => `"anyone know how to ${c}"`),
    ...painPhrasesFromIcps.map((p) => `"${p}"`),
    ...cats.map((c) => `${c} -filter:retweets`),
  ]);

  const solutionQueries = uniqueTrimmed([
    ...cats.map((c) => `${c} recommendation`),
    ...cats.map((c) => `built a ${c}`),
  ]);

  const competitorQueries = uniqueTrimmed([
    ...input.diagnosis.competitorMentions.flatMap((c) => [
      `"alternative to ${c}"`,
      `"${c} too expensive"`,
      `"replacing ${c}"`,
    ]),
  ]);

  // X founder-led content has loose "hook" patterns; not deeply format-mined.
  const formatQueries: string[] = [];

  return {
    platform: "twitter",
    painQueries,
    solutionQueries,
    competitorQueries,
    formatQueries,
    exclusionQueries: uniqueTrimmed(
      (input.excludedAudiences ?? []).map((a) => `-${a}`)
    ),
    minimumEvidenceCards: DEFAULT_MIN_EVIDENCE.twitter,
    maxCalls: budget,
  };
}

function buildTikTokPack(
  input: BuildResearchQueryPlanInput,
  budget: number
): PlatformQueryPack {
  const cats = input.diagnosis.productCategoryKeywords;
  // tiktok.md § 7 mining: keyword + hashtag searches. Focus on
  // "I built", "tools for", competitor names, and niche pain language.
  const painQueries = uniqueTrimmed([
    ...cats.map((c) => `${c} tool`),
    ...cats.map((c) => `how to ${c}`),
    ...cats.map((c) => `${c} hack`),
  ]);

  const solutionQueries = uniqueTrimmed([
    ...cats.map((c) => `I built a ${c}`),
    ...cats.map((c) => `${c} app demo`),
  ]);

  const competitorQueries = uniqueTrimmed(
    input.diagnosis.competitorMentions.map((c) => `${c} alternative`)
  );

  // tiktok.md § 7: format mining requires niche-keyword + hashtag-keyword
  // probes to discover what format dominates (faceless / talking-head /
  // slideshow) per niche. These feed maya-tiktok-format-researcher's
  // 5-video rule.
  const formatQueries = uniqueTrimmed([
    ...cats.flatMap((c) => [
      `#${tokens(c).join("")}`,
      `${c} POV`,
      `${c} before after`,
    ]),
  ]);

  return {
    platform: "tiktok",
    painQueries,
    solutionQueries,
    competitorQueries,
    formatQueries,
    exclusionQueries: uniqueTrimmed(
      (input.excludedAudiences ?? []).map((a) => `-${a}`)
    ),
    minimumEvidenceCards: DEFAULT_MIN_EVIDENCE.tiktok,
    maxCalls: budget,
  };
}

function buildInstagramPack(
  input: BuildResearchQueryPlanInput,
  budget: number
): PlatformQueryPack {
  // Instagram is reuse-only for most indie products (per linkedin.md +
  // instagram.md). Sprint 3 still emits a sparse pack so workers can
  // confirm whether the niche has IG signal at all.
  const cats = input.diagnosis.productCategoryKeywords;
  return {
    platform: "instagram",
    painQueries: uniqueTrimmed(cats.map((c) => `${c} reel`)),
    solutionQueries: uniqueTrimmed(cats.map((c) => `${c} demo`)),
    competitorQueries: uniqueTrimmed(
      input.diagnosis.competitorMentions.map((c) => `${c}`)
    ),
    formatQueries: uniqueTrimmed(
      cats.flatMap((c) => [`${c} carousel`, `${c} before after`])
    ),
    exclusionQueries: [],
    minimumEvidenceCards: DEFAULT_MIN_EVIDENCE.instagram,
    maxCalls: budget,
  };
}

function buildLinkedInPack(
  input: BuildResearchQueryPlanInput,
  budget: number
): PlatformQueryPack {
  // LinkedIn comment-mining queries — operator + competitor account posts
  // in 8-10am operator-tz window. Sprint 3 emits "find the posts to
  // comment on" probes; workers translate into ScrapeCreators company
  // posts calls (the LinkedIn-personal-feed endpoint isn't in
  // ScrapeCreators).
  const cats = input.diagnosis.productCategoryKeywords;
  return {
    platform: "linkedin",
    painQueries: uniqueTrimmed(cats.map((c) => `${c}`)),
    solutionQueries: uniqueTrimmed(cats.map((c) => `${c} platform`)),
    competitorQueries: uniqueTrimmed(
      input.diagnosis.competitorMentions.map((c) => c)
    ),
    formatQueries: [],
    exclusionQueries: [],
    minimumEvidenceCards: DEFAULT_MIN_EVIDENCE.linkedin,
    maxCalls: budget,
  };
}

function buildGooglePack(
  input: BuildResearchQueryPlanInput,
  budget: number
): PlatformQueryPack {
  // Google probes surface substitutes + workaround patterns. Per the
  // competitor-research SOP, "alternative to X" queries return the
  // highest-intent results.
  const competitors = input.diagnosis.competitorMentions;
  const cats = input.diagnosis.productCategoryKeywords;
  return {
    platform: "google",
    painQueries: uniqueTrimmed(cats.map((c) => `"how do I ${c}"`)),
    solutionQueries: uniqueTrimmed(cats.map((c) => `best ${c} tools 2026`)),
    competitorQueries: uniqueTrimmed([
      ...competitors.flatMap((c) => [
        `alternative to ${c}`,
        `${c} vs`,
        `${c} review reddit`,
      ]),
      ...(input.substitutes ?? []).map((s) => `replace ${s}`),
    ]),
    formatQueries: [],
    exclusionQueries: [],
    minimumEvidenceCards: DEFAULT_MIN_EVIDENCE.google,
    maxCalls: budget,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Main entry
// ──────────────────────────────────────────────────────────────────────

/**
 * Build a complete `ResearchQueryPlan` from the inputs. Pure synthesis,
 * no I/O. Workers consume the returned packs in parallel; each platform's
 * worker is responsible for its own budget enforcement (via cost-cap
 * pre-flight + per-pack `maxCalls`).
 *
 * Skip rules:
 *   - SKIP `tiktok` IF showability === "unshowable" (tiktok.md rule 4).
 *   - SKIP `instagram` IF showability === "unshowable" (mirrors TikTok).
 *   - SKIP `linkedin` IF zero ICPs are locatable on linkedin (LI-10.2
 *     defers to channel-judge for the hard refusal, but we don't burn
 *     budget on a platform no ICP names).
 *   - SKIP a platform IF its category keywords would produce zero
 *     painQueries (defensive — workers wouldn't have anything to call).
 */
export function buildResearchQueryPlan(
  input: BuildResearchQueryPlanInput
): ResearchQueryPlan {
  const skipped: ResearchQueryPlan["skipped"] = [];
  const packs: PlatformQueryPack[] = [];

  const budgetFor = (p: GtmQueryPlatform) =>
    input.budgetOverrides?.[p] ?? DEFAULT_BUDGETS[p];

  const allPlatforms: GtmQueryPlatform[] = [
    "reddit",
    "twitter",
    "tiktok",
    "instagram",
    "linkedin",
    "google",
  ];
  for (const platform of allPlatforms) {
    // Showability gate (tiktok.md rule 4 + IG mirror).
    if (
      (platform === "tiktok" || platform === "instagram") &&
      input.diagnosis.showability === "unshowable"
    ) {
      skipped.push({
        platform,
        reason: "showability=unshowable per maya-app-inspector",
      });
      continue;
    }
    // LinkedIn channel-locatability hint (LI-10.2). If no ICP locates
    // there, don't burn budget — channel-judge confirms.
    if (
      platform === "linkedin" &&
      input.icpHypotheses.length > 0 &&
      !input.icpHypotheses.some((h) => h.locatableOn === "linkedin")
    ) {
      skipped.push({
        platform,
        reason: "no ICP locates on linkedin (LI-10.2 deferred)",
      });
      continue;
    }
    // Empty-category defense.
    if (input.diagnosis.productCategoryKeywords.length === 0) {
      skipped.push({
        platform,
        reason: "productCategoryKeywords empty; nothing to query",
      });
      continue;
    }

    const budget = budgetFor(platform);
    if (budget <= 0) {
      skipped.push({ platform, reason: `budget=${budget}` });
      continue;
    }

    let pack: PlatformQueryPack;
    switch (platform) {
      case "reddit":
        pack = buildRedditPack(input, budget);
        break;
      case "twitter":
        pack = buildTwitterPack(input, budget);
        break;
      case "tiktok":
        pack = buildTikTokPack(input, budget);
        break;
      case "instagram":
        pack = buildInstagramPack(input, budget);
        break;
      case "linkedin":
        pack = buildLinkedInPack(input, budget);
        break;
      case "google":
        pack = buildGooglePack(input, budget);
        break;
    }

    if (pack.painQueries.length === 0 && pack.solutionQueries.length === 0) {
      skipped.push({
        platform,
        reason: "no pain or solution queries generated (input too thin)",
      });
      continue;
    }
    packs.push(pack);
  }

  return {
    packs,
    skipped,
    planFingerprint: fingerprint(input),
  };
}
