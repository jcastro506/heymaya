/**
 * ⚠ LEGACY / TEST-SCAFFOLDING ONLY
 *
 * The weighted-formula channel scoring in this file (scoreEvidenceCard,
 * evaluateChannel, evaluateChannelSet, decideChannel, confidenceFor,
 * etc.) was replaced by the LLM channel-judge in Sprint 2.13b. Live
 * N=3 validation (2026-05-24) showed the formula produced wrong-shape
 * decisions on non-dev-tools products (Beehiiv → LinkedIn parked
 * 0.00, Bezel → X parked 0.00). The LLM judge fixed both.
 *
 * What's still used:
 *   - Types (GtmChannel, GtmEvidenceCard, etc.) — imported across the
 *     codebase including by judgeChannel.ts
 *   - evaluateChannelSet — only by runBudgetedResearchSkeleton, the
 *     deterministic test-scaffolding mutation that provides "research
 *     without external spend" for tests. Skeleton is NOT the
 *     production research path. Production goes through
 *     runBudgetedResearchJob → judgeAllChannels.
 *
 * DO NOT IMPORT scoreEvidenceCard / evaluateChannelSet INTO NEW
 * PRODUCTION CODE. Use judgeChannel.ts. The functions are kept here
 * only because deleting them would break the skeleton tests.
 *
 * Per [[feedback-trust-llm-judgment-no-hardcoded-rules]] — weighted
 * heuristics are the wrong shape for "would this thread convert."
 * Only LLM judgment with grounded product context produces useful
 * channel decisions.
 */

export type GtmChannel =
  | "reddit"
  | "x"
  | "linkedin"
  | "tiktok"
  | "product_hunt";

export type GtmChannelDecision = "primary" | "secondary" | "parked" | "blocked";
export type GtmConfidence = "low" | "medium" | "high";
export type GtmEvidenceSource =
  | "app"
  | "google"
  | "reddit"
  | "x"
  | "linkedin"
  | "tiktok"
  | "instagram"
  | "competitor";
export type GtmEvidenceUse =
  | "strategy"
  | "reply"
  | "content_format"
  | "avoid"
  | "competitor";
export type GtmPromotionRisk = "low" | "medium" | "high" | "unknown";
export type GtmRecency = "fresh" | "recent" | "old" | "unknown";

export interface GtmEvidenceCard {
  id?: string;
  source: GtmEvidenceSource;
  url: string;
  title?: string;
  snippet: string;
  observedAt: number;
  recency: GtmRecency;
  engagement?: {
    likes?: number;
    comments?: number;
    shares?: number;
    views?: number;
  };
  painMatch: number;
  buyerMatch: number;
  channelFit: number;
  promotionRisk: GtmPromotionRisk;
  recommendedUse: GtmEvidenceUse;
  extractedClaims: string[];
}

export interface GtmAppContext {
  stage: "idea" | "live-beta" | "paid" | "unknown";
  weekGoal: "feedback" | "signups" | "demos" | "revenue" | "unknown";
  canRecordScreen: boolean;
  canShowFace: boolean;
  canRecordVoice?: boolean;
  canProvideScreenshots?: boolean;
  canPostTikTokManually?: boolean;
  tiktokWarmupState?: "unknown" | "new_needs_warmup" | "warming" | "ready" | "restricted";
  tiktokAccountAgeDays?: number;
  tiktokAccountStatusChecked?: boolean;
  canPostInstagramManually?: boolean;
  openToUgcCreators?: boolean;
  creatorBudgetMonthlyUsd?: number;
  excludedAudiences: ReadonlyArray<string>;
}

export interface GtmChannelEvaluation {
  channel: GtmChannel;
  score: number;
  decision: GtmChannelDecision;
  confidence: GtmConfidence;
  reasons: string[];
  risks: string[];
  evidenceCardIds: string[];
  firstWeekTest?: string;
  qualityGate: {
    passed: boolean;
    failures: string[];
  };
}

const CHANNEL_SOURCE: Record<GtmChannel, GtmEvidenceSource> = {
  reddit: "reddit",
  x: "x",
  linkedin: "linkedin",
  tiktok: "tiktok",
  product_hunt: "competitor",
};

export function scoreEvidenceCard(card: GtmEvidenceCard): number {
  if (card.recommendedUse === "avoid") return 0;

  const pain = clamp01(card.painMatch);
  const buyer = clamp01(card.buyerMatch);
  const fit = clamp01(card.channelFit);
  const recency = recencyScore(card.recency);
  const engagement = engagementScore(card.engagement);
  const risk = riskPenalty(card.promotionRisk);
  const claims = clamp01(card.extractedClaims.length / 3);

  return clamp01(
    pain * 0.28 +
      buyer * 0.24 +
      fit * 0.22 +
      recency * 0.1 +
      engagement * 0.08 +
      claims * 0.08 -
      risk
  );
}

export function evaluateChannel(
  channel: GtmChannel,
  cards: ReadonlyArray<GtmEvidenceCard>,
  app: GtmAppContext
): GtmChannelEvaluation {
  const channelCards = cards.filter(
    (card) =>
      card.source === CHANNEL_SOURCE[channel] ||
      (channel === "product_hunt" && card.recommendedUse === "competitor")
  );
  const usableCards = channelCards
    .filter((card) => card.recommendedUse !== "avoid")
    .map((card) => ({ card, score: scoreEvidenceCard(card) }))
    .filter((row) => row.score >= 0.45)
    .sort((a, b) => b.score - a.score);

  const top = usableCards.slice(0, 5);
  const score = top.length
    ? top.reduce((sum, row) => sum + row.score, 0) / top.length
    : 0;
  const failures = qualityFailures(channel, usableCards, app, score);
  const risks = channelRisks(channel, channelCards, app);
  const reasons = channelReasons(channel, usableCards, score);
  const decision = decideChannel(score, usableCards.length, failures, risks);
  const confidence = confidenceFor(score, usableCards.length, failures);

  return {
    channel,
    score: round(score),
    decision,
    confidence,
    reasons,
    risks,
    evidenceCardIds: usableCards
      .map((row) => row.card.id)
      .filter((id): id is string => Boolean(id)),
    firstWeekTest: firstWeekTestFor(channel, decision, usableCards),
    qualityGate: {
      passed: failures.length === 0,
      failures,
    },
  };
}

export function evaluateChannelSet(
  cards: ReadonlyArray<GtmEvidenceCard>,
  app: GtmAppContext
): GtmChannelEvaluation[] {
  const channels: GtmChannel[] = [
    "reddit",
    "x",
    "linkedin",
    "tiktok",
    "product_hunt",
  ];
  const evaluations: GtmChannelEvaluation[] = channels.map((channel) =>
    evaluateChannel(channel, cards, app)
  );

  const eligible = evaluations
    .filter((evaluation) => evaluation.qualityGate.passed)
    .sort((a, b) => b.score - a.score);

  const primary = eligible[0]?.channel;
  const secondary = eligible[1]?.channel;

  return evaluations.map((evaluation) => {
    if (!evaluation.qualityGate.passed) return evaluation;
    if (evaluation.channel === primary) {
      return { ...evaluation, decision: "primary" };
    }
    if (evaluation.channel === secondary) {
      return { ...evaluation, decision: "secondary" };
    }
    return { ...evaluation, decision: "parked" };
  });
}

export function validateStrategyGate(
  evaluations: ReadonlyArray<GtmChannelEvaluation>
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  const primaries = evaluations.filter((e) => e.decision === "primary");
  const active = evaluations.filter(
    (e) => e.decision === "primary" || e.decision === "secondary"
  );

  if (primaries.length !== 1) {
    failures.push("strategy must choose exactly one primary channel");
  }
  if (active.length > 2) {
    failures.push("strategy may run at most two active channels in week one");
  }
  for (const evaluation of active) {
    if (!evaluation.qualityGate.passed) {
      failures.push(`${evaluation.channel} is active without passing its gate`);
    }
    if (evaluation.evidenceCardIds.length < minEvidenceFor(evaluation.decision)) {
      failures.push(`${evaluation.channel} has too few cited evidence cards`);
    }
    if (!evaluation.firstWeekTest) {
      failures.push(`${evaluation.channel} is active without a first-week test`);
    }
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

function qualityFailures(
  channel: GtmChannel,
  rows: ReadonlyArray<{ card: GtmEvidenceCard; score: number }>,
  app: GtmAppContext,
  score: number
): string[] {
  const failures: string[] = [];
  if (rows.length < 2) failures.push("needs at least two useful evidence cards");
  if (score < 0.55) failures.push("average evidence score is below threshold");
  if (channel === "tiktok" && !hasTikTokProductionPath(app)) {
    failures.push(
      "TikTok needs manual posting plus screen recording, screenshots, voice/face, or later UGC budget"
    );
  }
  if (channel === "tiktok" && needsTikTokWarmup(app)) {
    failures.push(
      "TikTok account needs warm-up or Account Check before launch cadence"
    );
  }
  if (channel === "linkedin" && app.weekGoal === "feedback" && rows.length < 3) {
    failures.push("LinkedIn feedback strategy needs three buyer-context signals");
  }
  if (channel === "reddit" && rows.some((row) => row.card.promotionRisk === "high")) {
    failures.push("Reddit strategy includes high promotion-risk evidence");
  }
  return failures;
}

function decideChannel(
  score: number,
  evidenceCount: number,
  failures: ReadonlyArray<string>,
  risks: ReadonlyArray<string>
): GtmChannelDecision {
  if (failures.length > 0) return "parked";
  if (risks.includes("channel is unsafe for launch week")) return "blocked";
  if (score >= 0.72 && evidenceCount >= 3) return "primary";
  if (score >= 0.58 && evidenceCount >= 2) return "secondary";
  return "parked";
}

function confidenceFor(
  score: number,
  evidenceCount: number,
  failures: ReadonlyArray<string>
): GtmConfidence {
  if (failures.length > 0 || evidenceCount < 2 || score < 0.58) return "low";
  if (score >= 0.74 && evidenceCount >= 4) return "high";
  return "medium";
}

function channelReasons(
  channel: GtmChannel,
  rows: ReadonlyArray<{ card: GtmEvidenceCard; score: number }>,
  score: number
): string[] {
  if (rows.length === 0) return [`No useful ${channel} evidence yet.`];
  const top = rows[0].card;
  return [
    `${rows.length} useful ${channel} evidence cards`,
    `Average evidence score ${round(score)}`,
    `Top signal: ${top.snippet.slice(0, 120)}`,
  ];
}

function channelRisks(
  channel: GtmChannel,
  cards: ReadonlyArray<GtmEvidenceCard>,
  app: GtmAppContext
): string[] {
  const risks: string[] = [];
  const highRiskCount = cards.filter((card) => card.promotionRisk === "high").length;
  if (highRiskCount > 0) risks.push(`${highRiskCount} high promotion-risk signals`);
  if (channel === "tiktok" && !hasTikTokProductionPath(app)) {
    risks.push("requires user-created visual assets and manual posting in V1");
  }
  if (channel === "tiktok" && needsTikTokWarmup(app)) {
    risks.push("start with TikTok warm-up tasks before posting cadence");
  }
  if (channel === "product_hunt" && app.stage === "idea") {
    risks.push("too early for launch directory traffic");
  }
  if (app.excludedAudiences.length > 0) {
    risks.push(`avoid excluded audiences: ${app.excludedAudiences.join(", ")}`);
  }
  return risks;
}

function firstWeekTestFor(
  channel: GtmChannel,
  decision: GtmChannelDecision,
  rows: ReadonlyArray<{ card: GtmEvidenceCard; score: number }>
): string | undefined {
  if (decision !== "primary" && decision !== "secondary") return undefined;
  const anchor = rows[0]?.card.title ?? rows[0]?.card.snippet ?? "top evidence card";
  switch (channel) {
    case "reddit":
      return `Reply to 10 fresh threads matching: ${anchor}`;
    case "x":
      return `Ship 5 founder-led posts and 15 replies mapped to: ${anchor}`;
    case "linkedin":
      return `Publish 3 practical build-in-public posts and comment on 10 buyer posts about: ${anchor}`;
    case "tiktok":
      return `Create 3 manual TikTok visual tests from the format signal: ${anchor}`;
    case "product_hunt":
      return `Prepare launch copy and 20 qualified maker/community comments around: ${anchor}`;
  }
}

function hasTikTokProductionPath(app: GtmAppContext): boolean {
  const hasVisualAssetPath =
    app.canRecordScreen ||
    app.canShowFace ||
    app.canRecordVoice ||
    app.canProvideScreenshots ||
    Boolean(app.openToUgcCreators && (app.creatorBudgetMonthlyUsd ?? 0) > 0);
  return Boolean(app.canPostTikTokManually && hasVisualAssetPath);
}

function needsTikTokWarmup(app: GtmAppContext): boolean {
  if (!app.canPostTikTokManually) return false;
  if (app.tiktokWarmupState === "restricted") return true;
  if (app.tiktokWarmupState === "ready") return false;
  if (app.tiktokWarmupState === "new_needs_warmup" || app.tiktokWarmupState === "warming") {
    return true;
  }
  return (app.tiktokAccountAgeDays ?? 0) < 7 || !app.tiktokAccountStatusChecked;
}

function minEvidenceFor(decision: GtmChannelDecision): number {
  return decision === "primary" ? 3 : 2;
}

function recencyScore(recency: GtmRecency): number {
  switch (recency) {
    case "fresh":
      return 1;
    case "recent":
      return 0.75;
    case "old":
      return 0.25;
    case "unknown":
      return 0.4;
  }
}

function riskPenalty(risk: GtmPromotionRisk): number {
  switch (risk) {
    case "low":
      return 0;
    case "medium":
      return 0.08;
    case "high":
      return 0.25;
    case "unknown":
      return 0.05;
  }
}

function engagementScore(engagement: GtmEvidenceCard["engagement"]): number {
  if (!engagement) return 0.25;
  const comments = engagement.comments ?? 0;
  const likes = engagement.likes ?? 0;
  const shares = engagement.shares ?? 0;
  const views = engagement.views ?? 0;
  return clamp01((comments * 3 + shares * 2 + likes + views / 100) / 250);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
