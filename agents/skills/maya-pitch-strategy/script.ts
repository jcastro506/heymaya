/**
 * maya-pitch-strategy — pure-logic decision engine.
 *
 * Sprint 3.5b. The tier-aware free-vs-gifted-vs-paid-vs-decline matrix.
 * Encoded as deterministic TypeScript so the wrapping Convex action can
 * call this at zero cost on every opportunity surfaced (no LLM round-trip).
 *
 * The decision rules MUST stay in sync with SKILL.md § "Decision rules".
 * Sibling-file scan asserts both directions.
 *
 * No Convex imports. No network. Pure TypeScript so the unit tests can pin
 * exact recommendations against canned inputs.
 *
 * Stage-aware adaptive product (Agent B, 2026-04-26): this is a deterministic
 * decision matrix — no LLM prompt to suffix. The orchestrator
 * (convex/agents/skills/pitchStrategy.ts) MUST call
 * `assertSkillRespectsGrowthPlan("brand-pitch-strategy", growthPlan)` BEFORE
 * invoking this skill — when blocked (e.g. just-starting creators with
 * "pitching brands cold" in antiPatterns), the orchestrator surfaces the
 * deferral message instead of running the matrix.
 */

export type Recommendation =
  | "pitch-paid"
  | "pitch-free-build-book"
  | "pitch-gifted"
  | "decline";

export type Urgency = "low" | "medium" | "high";

export type RiskLevel = "low" | "medium" | "high";

export interface BrandDeal {
  readonly amountUsd: number;
  readonly date: string; // ISO date
}

export interface CreatorPictureSubset {
  readonly followerCount: number;
  readonly monthlyRevenueUsd: number;
  readonly brandDealHistory: ReadonlyArray<BrandDeal>;
}

export interface Opportunity {
  readonly brandName: string;
  readonly estimatedRateRange?: { low: number; high: number };
  readonly deliverables: string;
  readonly urgency: Urgency;
}

export interface PitchStrategyInput {
  readonly creatorPicture: CreatorPictureSubset;
  readonly opportunity: Opportunity;
  readonly creatorGoals: string;
}

export interface PitchCitation {
  readonly kind: "metric" | "deal";
  readonly id: string;
  readonly fact: string;
}

export interface PitchStrategyResult {
  readonly recommendation: Recommendation;
  readonly reasoning: string;
  readonly suggestedRateUsd?: number;
  readonly expectedConversionLikelihood: number; // 0..1
  readonly riskOfMisaligningCreator: RiskLevel;
  readonly citations: ReadonlyArray<PitchCitation>;
}

type SizeBucket = "hobbyist" | "emerging" | "established" | "pro";

function bucketFor(picture: CreatorPictureSubset): SizeBucket {
  const f = picture.followerCount;
  const r = picture.monthlyRevenueUsd;
  // The OR rule: if EITHER followers or revenue lands in a smaller bucket,
  // the creator is treated as the smaller bucket. This protects the
  // hobbyist who briefly spiked followers via one viral post but isn't yet
  // monetizing.
  if (f < 10_000 || r < 2_000) return "hobbyist";
  if (f < 50_000 || r < 10_000) return "emerging";
  if (f < 500_000 || r < 50_000) return "established";
  return "pro";
}

const RECENT_DEAL_WINDOW_DAYS = 90;

function daysAgoMs(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function recentPaidDealCount(
  history: ReadonlyArray<BrandDeal>,
  minAmountUsd: number
): number {
  const cutoffMs = daysAgoMs(RECENT_DEAL_WINDOW_DAYS);
  let n = 0;
  for (const d of history) {
    const t = Date.parse(d.date);
    if (Number.isNaN(t)) continue;
    if (t < cutoffMs) continue;
    if (d.amountUsd >= minAmountUsd) n++;
  }
  return n;
}

function trailingThreeAvg(history: ReadonlyArray<BrandDeal>): number {
  if (history.length === 0) return 0;
  const sorted = history.slice().sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const window = sorted.slice(0, 3);
  return window.reduce((s, d) => s + d.amountUsd, 0) / window.length;
}

function trailingThreeHigh(history: ReadonlyArray<BrandDeal>): number {
  if (history.length === 0) return 0;
  const sorted = history.slice().sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const window = sorted.slice(0, 3);
  return Math.max(...window.map((d) => d.amountUsd));
}

/* -------------------------------------------------------------------------- */
/* Risk-of-misaligning-creator                                                 */
/* -------------------------------------------------------------------------- */

const HIGH_RISK_NEGATIVE_KEYWORDS: ReadonlyArray<string> = [
  "no fast fashion",
  "no gambling",
  "no alcohol",
  "no crypto",
  "no mlm",
  "no diet culture",
  "no weight loss",
  "no political",
  "no fossil fuel",
  "no nft",
];

function assessRisk(
  goals: string,
  opportunity: Opportunity,
  picture: CreatorPictureSubset
): RiskLevel {
  const goalLower = goals.toLowerCase();
  const brandLower = opportunity.brandName.toLowerCase();
  const delivLower = opportunity.deliverables.toLowerCase();

  // Hard "no X" overrides — high risk.
  for (const negative of HIGH_RISK_NEGATIVE_KEYWORDS) {
    if (goalLower.includes(negative)) {
      const offending = negative.replace(/^no\s+/, "");
      if (brandLower.includes(offending) || delivLower.includes(offending)) {
        return "high";
      }
    }
  }

  // Mid-risk: stated platform-growth goal vs. deliverables on a different platform.
  const platformGoals: ReadonlyArray<{ keyword: string; deliverableHint: string }> = [
    { keyword: "youtube", deliverableHint: "yt" },
    { keyword: "long-form", deliverableHint: "yt" },
    { keyword: "tiktok", deliverableHint: "tiktok" },
    { keyword: "instagram", deliverableHint: "ig" },
    { keyword: "linkedin", deliverableHint: "linkedin" },
  ];
  for (const pg of platformGoals) {
    if (goalLower.includes(pg.keyword) && goalLower.includes("grow")) {
      // Goal explicitly mentions growing this platform — does the deliverable
      // pull effort away from it?
      if (!delivLower.includes(pg.deliverableHint)) {
        // Unclear — treat as medium when picture suggests focus.
        if (picture.followerCount >= 10_000) return "medium";
      }
    }
  }

  return "low";
}

/* -------------------------------------------------------------------------- */
/* Conversion likelihood heuristic                                             */
/* -------------------------------------------------------------------------- */

const BASE_CONVERSION_BY_REC: Record<Recommendation, number> = {
  "pitch-paid": 0.15,
  "pitch-gifted": 0.3,
  "pitch-free-build-book": 0.4,
  decline: 0.0,
};

function conversionLikelihood(
  rec: Recommendation,
  picture: CreatorPictureSubset,
  opportunity: Opportunity
): number {
  let p = BASE_CONVERSION_BY_REC[rec];
  if (rec === "decline") return 0;

  if (picture.brandDealHistory.length === 0) p -= 0.1;
  if (picture.monthlyRevenueUsd >= 5_000) p += 0.1;

  // Warm relationship — same brand in history.
  const brandLower = opportunity.brandName.toLowerCase();
  let warmHits = 0;
  // brandDealHistory entries don't carry brand name in this skill's input
  // (intentional — kept compact). The wrapping action can pre-augment if it
  // wants warm-relationship credit; here we keep the heuristic conservative.
  // We still add 0.05 per recent-paid-deal as a generic professionalism signal.
  const recentPaidN = recentPaidDealCount(picture.brandDealHistory, 500);
  warmHits = Math.min(2, recentPaidN);
  p += 0.05 * warmHits;

  // Quietly use brandLower as a placeholder so future warm-relationship logic
  // has a hook; for now this is informational only.
  void brandLower;

  return Math.max(0, Math.min(0.95, parseFloat(p.toFixed(2))));
}

/* -------------------------------------------------------------------------- */
/* Decision matrix                                                             */
/* -------------------------------------------------------------------------- */

interface Decision {
  recommendation: Recommendation;
  suggestedRateUsd?: number;
  bucket: SizeBucket;
  reasoningParts: string[];
  citations: PitchCitation[];
}

function decideHobbyist(input: PitchStrategyInput): Decision {
  const { creatorPicture, opportunity } = input;
  const reasoningParts: string[] = [];
  const citations: PitchCitation[] = [];

  citations.push({
    kind: "metric",
    id: "follower-count",
    fact: `Follower count is ${creatorPicture.followerCount.toLocaleString()} (hobbyist bucket).`,
  });
  citations.push({
    kind: "metric",
    id: "monthly-revenue",
    fact: `Monthly revenue is $${creatorPicture.monthlyRevenueUsd.toLocaleString()} (hobbyist bucket).`,
  });

  const recentPaidN = recentPaidDealCount(creatorPicture.brandDealHistory, 500);
  citations.push({
    kind: "deal",
    id: "recent-paid-deals",
    fact: `${recentPaidN} prior deal(s) of $500+ in last ${RECENT_DEAL_WINDOW_DAYS} days.`,
  });

  // Exploitative ask check.
  const delivLower = opportunity.deliverables.toLowerCase();
  const exploitativeAsk =
    /(\b3|\b4|\b5|\b6)\s*(?:posts?|reels?|videos?)/i.test(opportunity.deliverables) &&
    /usage rights|whitelisting|full buyout/i.test(delivLower);
  if (exploitativeAsk) {
    reasoningParts.push(
      "Deliverable ask is exploitative for hobbyist tier (3+ posts plus broad usage rights). Decline."
    );
    return {
      recommendation: "decline",
      bucket: "hobbyist",
      reasoningParts,
      citations,
    };
  }

  // Paid path is permitted only when prior deal history shows a recent paid deal.
  if (recentPaidN >= 1) {
    const anchor =
      opportunity.estimatedRateRange != null
        ? Math.round(
            (opportunity.estimatedRateRange.low + opportunity.estimatedRateRange.high) / 2
          )
        : 500;
    reasoningParts.push(
      `Prior deal history shows ${recentPaidN} compensated deal(s) at $500+ recently — pitching for compensation is grounded.`
    );
    return {
      recommendation: "pitch-paid",
      suggestedRateUsd: anchor,
      bucket: "hobbyist",
      reasoningParts,
      citations,
    };
  }

  // Gifted vs free-build-book — if the brand description indicates a product
  // gift (we can't fully tell from inputs, default to free-build-book for
  // portfolio brands; the calling action can override to gifted).
  reasoningParts.push(
    "No compensated deal history yet — pitching free for the portfolio piece is the higher-conversion ask. Maya will draft a gifted variant if the brand is product-fit."
  );
  return {
    recommendation: "pitch-free-build-book",
    bucket: "hobbyist",
    reasoningParts,
    citations,
  };
}

function decideEmerging(input: PitchStrategyInput): Decision {
  const { creatorPicture, opportunity } = input;
  const reasoningParts: string[] = [];
  const citations: PitchCitation[] = [];

  citations.push({
    kind: "metric",
    id: "follower-count",
    fact: `Follower count is ${creatorPicture.followerCount.toLocaleString()} (emerging bucket).`,
  });
  citations.push({
    kind: "metric",
    id: "monthly-revenue",
    fact: `Monthly revenue is $${creatorPicture.monthlyRevenueUsd.toLocaleString()} (emerging bucket).`,
  });

  // Hybrid default: in-niche brand → paid; stretch brand → gifted; rare free.
  // We can't perfectly classify "in-niche" without the brand dataset; assume
  // in-niche unless the calling action signaled otherwise via opportunity
  // metadata. The conservative default here is paid with a $500 floor.
  const EMERGING_FLOOR = 500;
  const anchor =
    opportunity.estimatedRateRange != null
      ? Math.max(
          EMERGING_FLOOR,
          Math.round(
            (opportunity.estimatedRateRange.low + opportunity.estimatedRateRange.high) / 2
          )
        )
      : Math.max(EMERGING_FLOOR, Math.round(creatorPicture.monthlyRevenueUsd * 0.15));

  citations.push({
    kind: "metric",
    id: "emerging-floor",
    fact: `Emerging-tier minimum floor is $${EMERGING_FLOOR} per pitch (Maya internal heuristic).`,
  });

  reasoningParts.push(
    `Emerging tier creator — pitching for compensation is the default for in-niche brands. $${EMERGING_FLOOR} floor applies (your time has measurable cost at this size).`
  );
  return {
    recommendation: "pitch-paid",
    suggestedRateUsd: anchor,
    bucket: "emerging",
    reasoningParts,
    citations,
  };
}

function decideEstablished(input: PitchStrategyInput): Decision {
  const { creatorPicture, opportunity } = input;
  const reasoningParts: string[] = [];
  const citations: PitchCitation[] = [];

  const trailingAvg = trailingThreeAvg(creatorPicture.brandDealHistory);
  const floor = Math.round(trailingAvg * 0.75);

  citations.push({
    kind: "metric",
    id: "follower-count",
    fact: `Follower count is ${creatorPicture.followerCount.toLocaleString()} (established bucket).`,
  });
  citations.push({
    kind: "deal",
    id: "trailing-three-avg",
    fact: `Trailing 3-deal average is $${Math.round(trailingAvg).toLocaleString()}; floor is 75% = $${floor.toLocaleString()}.`,
  });

  if (
    opportunity.estimatedRateRange != null &&
    opportunity.estimatedRateRange.high < floor
  ) {
    citations.push({
      kind: "metric",
      id: "brand-estimated-high",
      fact: `Brand's estimated high-end is $${opportunity.estimatedRateRange.high.toLocaleString()}.`,
    });
    reasoningParts.push(
      `Brand's high-end estimate ($${opportunity.estimatedRateRange.high.toLocaleString()}) sits below your floor ($${floor.toLocaleString()}). Decline politely; surface the floor publicly so the brand can come back with a serious number.`
    );
    return {
      recommendation: "decline",
      bucket: "established",
      reasoningParts,
      citations,
    };
  }

  const target =
    opportunity.estimatedRateRange != null
      ? Math.max(
          floor,
          Math.round(
            (opportunity.estimatedRateRange.low + opportunity.estimatedRateRange.high) / 2
          )
        )
      : Math.max(floor, Math.round(trailingAvg));

  reasoningParts.push(
    `Established tier — compensation is the default. Anchor at trailing-3 average; floor is $${floor.toLocaleString()}.`
  );
  return {
    recommendation: "pitch-paid",
    suggestedRateUsd: target,
    bucket: "established",
    reasoningParts,
    citations,
  };
}

function decidePro(input: PitchStrategyInput): Decision {
  const { creatorPicture, opportunity } = input;
  const reasoningParts: string[] = [];
  const citations: PitchCitation[] = [];

  const trailingAvg = trailingThreeAvg(creatorPicture.brandDealHistory);
  const trailingHigh = trailingThreeHigh(creatorPicture.brandDealHistory);
  const floor = Math.round(trailingAvg);

  citations.push({
    kind: "metric",
    id: "follower-count",
    fact: `Follower count is ${creatorPicture.followerCount.toLocaleString()} (pro bucket).`,
  });
  citations.push({
    kind: "deal",
    id: "trailing-three-floor",
    fact: `Trailing 3-deal average is $${Math.round(trailingAvg).toLocaleString()}; high is $${Math.round(trailingHigh).toLocaleString()}.`,
  });

  if (
    opportunity.estimatedRateRange != null &&
    opportunity.estimatedRateRange.high < floor
  ) {
    citations.push({
      kind: "metric",
      id: "brand-estimated-high",
      fact: `Brand's estimated high-end is $${opportunity.estimatedRateRange.high.toLocaleString()}.`,
    });
    reasoningParts.push(
      `Brand's high-end estimate ($${opportunity.estimatedRateRange.high.toLocaleString()}) is below your trailing-3 average floor ($${floor.toLocaleString()}). Decline; the rate signals the brand isn't serious at your tier.`
    );
    return {
      recommendation: "decline",
      bucket: "pro",
      reasoningParts,
      citations,
    };
  }

  const target = Math.max(floor, Math.round(trailingHigh));
  reasoningParts.push(
    `Pro tier — compensation only, anchor at trailing-3 high ($${Math.round(trailingHigh).toLocaleString()}).`
  );
  return {
    recommendation: "pitch-paid",
    suggestedRateUsd: target,
    bucket: "pro",
    reasoningParts,
    citations,
  };
}

/* -------------------------------------------------------------------------- */
/* Entry                                                                       */
/* -------------------------------------------------------------------------- */

export function decidePitchStrategy(input: PitchStrategyInput): PitchStrategyResult {
  if (input.creatorPicture.followerCount < 0) {
    throw new Error("creatorPicture.followerCount must be >= 0");
  }
  if (input.creatorPicture.monthlyRevenueUsd < 0) {
    throw new Error("creatorPicture.monthlyRevenueUsd must be >= 0");
  }
  if (input.opportunity.brandName.trim().length === 0) {
    throw new Error("opportunity.brandName must be non-empty");
  }

  const bucket = bucketFor(input.creatorPicture);
  let decision: Decision;
  switch (bucket) {
    case "hobbyist":
      decision = decideHobbyist(input);
      break;
    case "emerging":
      decision = decideEmerging(input);
      break;
    case "established":
      decision = decideEstablished(input);
      break;
    case "pro":
      decision = decidePro(input);
      break;
  }

  const conversion = conversionLikelihood(
    decision.recommendation,
    input.creatorPicture,
    input.opportunity
  );
  const risk = assessRisk(input.creatorGoals, input.opportunity, input.creatorPicture);

  // If risk is high, escalate to decline regardless of bucket — Maya never
  // knowingly pitches a brand that contradicts a hard "no X" goal.
  let finalRec = decision.recommendation;
  let finalRate = decision.suggestedRateUsd;
  let extraReasoning: string | undefined;
  if (risk === "high" && finalRec !== "decline") {
    extraReasoning = `Creator goals explicitly exclude this brand category — overriding to decline despite size-bucket recommendation.`;
    finalRec = "decline";
    finalRate = undefined;
  }

  const reasoning = [...decision.reasoningParts, extraReasoning]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ");

  return {
    recommendation: finalRec,
    reasoning,
    suggestedRateUsd: finalRate,
    expectedConversionLikelihood:
      finalRec === "decline" ? 0 : conversion,
    riskOfMisaligningCreator: risk,
    citations: decision.citations,
  };
}
