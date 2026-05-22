import type { GtmChannelEvaluation } from "./channelScoring";

export interface GtmStrategyPlan {
  primaryChannel: string;
  secondaryChannel?: string;
  parkedChannels: string[];
  confidence: "low" | "medium" | "high";
  thesis: string;
  firstWeekTests: Array<{
    channel: string;
    test: string;
    successMetric: string;
    evidenceCardIds: string[];
  }>;
}

export function buildStrategyPlan(
  evaluations: ReadonlyArray<GtmChannelEvaluation>
): GtmStrategyPlan {
  const primary = evaluations.find((row) => row.decision === "primary");
  if (!primary) {
    throw new Error("strategy requires one primary channel");
  }
  const secondary = evaluations.find((row) => row.decision === "secondary");
  const parkedChannels = evaluations
    .filter((row) => row.decision === "parked" || row.decision === "blocked")
    .map((row) => row.channel);

  const active = [primary, secondary].filter(
    (row): row is GtmChannelEvaluation => Boolean(row)
  );
  return {
    primaryChannel: primary.channel,
    secondaryChannel: secondary?.channel,
    parkedChannels,
    confidence: confidenceFrom(active),
    thesis: `Start with ${primary.channel}${
      secondary ? ` and support it with ${secondary.channel}` : ""
    } because those channels have the strongest cited evidence and executable first-week tests.`,
    firstWeekTests: active.map((row) => ({
      channel: row.channel,
      test: row.firstWeekTest ?? "",
      successMetric: successMetricFor(row.channel),
      evidenceCardIds: row.evidenceCardIds,
    })),
  };
}

export function validateStrategyPlan(input: {
  plan: GtmStrategyPlan;
  evaluations: ReadonlyArray<GtmChannelEvaluation>;
}): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  const activeChannels = [
    input.plan.primaryChannel,
    input.plan.secondaryChannel,
  ].filter((channel): channel is string => Boolean(channel));
  const evaluationChannels = input.evaluations.map((row) => row.channel);

  if (activeChannels.length === 0) failures.push("plan has no active channel");
  if (activeChannels.length > 2) failures.push("plan has too many active channels");
  for (const channel of activeChannels) {
    const evaluation = input.evaluations.find((row) => row.channel === channel);
    if (!evaluation) failures.push(`${channel} lacks channel evaluation`);
    if (evaluation && !evaluation.qualityGate.passed) {
      failures.push(`${channel} did not pass quality gate`);
    }
    if (evaluation && evaluation.evidenceCardIds.length < 2) {
      failures.push(`${channel} lacks enough evidence references`);
    }
  }

  const parkedSet = new Set(input.plan.parkedChannels);
  for (const channel of evaluationChannels) {
    if (!activeChannels.includes(channel) && !parkedSet.has(channel)) {
      failures.push(`${channel} missing from parked channels`);
    }
  }

  for (const test of input.plan.firstWeekTests) {
    if (!test.test.trim()) failures.push(`${test.channel} missing first-week test`);
    if (!test.successMetric.trim()) {
      failures.push(`${test.channel} missing success metric`);
    }
    if (test.evidenceCardIds.length < 2) {
      failures.push(`${test.channel} test lacks cited evidence`);
    }
  }

  if (looksGeneric(input.plan.thesis)) {
    failures.push("plan thesis is generic");
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

function confidenceFrom(
  active: ReadonlyArray<GtmChannelEvaluation>
): GtmStrategyPlan["confidence"] {
  if (active.every((row) => row.confidence === "high")) return "high";
  if (active.some((row) => row.confidence === "low")) return "low";
  return "medium";
}

function successMetricFor(channel: string): string {
  switch (channel) {
    case "reddit":
      return "qualified replies, DMs, or signups from reply-first threads";
    case "x":
      return "profile clicks, replies from target users, and tracked signups";
    case "linkedin":
      return "buyer replies, demo requests, and tracked signups";
    case "tiktok":
      return "demo completion, profile clicks, comments asking for link, and signups";
    case "product_hunt":
      return "qualified comments, referral clicks, and signup conversion";
    default:
      return "qualified customer movement";
  }
}

function looksGeneric(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    "post consistently",
    "engage with your audience",
    "build brand awareness",
    "leverage social media",
  ].some((phrase) => lower.includes(phrase));
}
