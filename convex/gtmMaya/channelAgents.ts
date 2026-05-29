import type { GtmAppContext, GtmChannel, GtmEvidenceCard } from "./channelScoring";

export interface ChannelAgentInput {
  channel: GtmChannel;
  app: GtmAppContext & {
    productType:
      | "b2b_workflow"
      | "developer_tool"
      | "consumer_visual"
      | "prosumer"
      | "unknown";
  };
  evidence: ReadonlyArray<GtmEvidenceCard>;
}

export interface ChannelAgentVerdict {
  channel: GtmChannel;
  eligible: boolean;
  rationale: string[];
  risks: string[];
  requiredNextEvidence: string[];
}

export function evaluateChannelAgent(
  input: ChannelAgentInput
): ChannelAgentVerdict {
  switch (input.channel) {
    case "tiktok":
      return evaluateTikTok(input);
    case "youtube":
      // YouTube Shorts are the same short-form video eligibility shape as
      // TikTok (Brief-only, hook-driven). The real per-platform judgment now
      // lives in maya-youtube-researcher (OpenClaw-native); this legacy
      // heuristic path is migration-bound (#8). Reuse the video analog.
      return evaluateTikTok(input);
    case "linkedin":
      return evaluateLinkedIn(input);
    case "reddit":
      return evaluateReddit(input);
    case "x":
      return evaluateX(input);
    case "product_hunt":
      return evaluateProductHunt(input);
  }
}

export function evaluateAllChannelAgents(
  input: Omit<ChannelAgentInput, "channel">
): ChannelAgentVerdict[] {
  return (
    ["reddit", "x", "linkedin", "tiktok", "youtube", "product_hunt"] as const
  ).map((channel) => evaluateChannelAgent({ ...input, channel }));
}

function evaluateTikTok(input: ChannelAgentInput): ChannelAgentVerdict {
  const visualEvidence = evidenceFor(input.evidence, "tiktok").filter(
    (card) => card.recommendedUse !== "avoid"
  );
  const hasUserMadeVisualPath =
    input.app.canRecordScreen ||
    input.app.canShowFace ||
    input.app.canRecordVoice ||
    input.app.canProvideScreenshots;
  const hasPaidCreatorPath =
    input.app.openToUgcCreators &&
    (input.app.creatorBudgetMonthlyUsd ?? 0) > 0;
  const visualCapacity = Boolean(
    input.app.canPostTikTokManually &&
      (hasUserMadeVisualPath || hasPaidCreatorPath)
  );
  const goodFit =
    input.app.productType === "consumer_visual" ||
    input.app.productType === "prosumer";
  const eligible = visualCapacity && goodFit && visualEvidence.length >= 2;
  return {
    channel: "tiktok",
    eligible,
    rationale: eligible
      ? ["visual product/demo capacity exists", "TikTok format evidence exists"]
      : ["TikTok is parked unless the product can be shown and posted manually"],
    risks: visualCapacity ? [] : ["user cannot currently provide video assets"],
    requiredNextEvidence: eligible
      ? []
      : [
          "two visual format examples",
          "manual posting commitment",
          "screen recording, screenshots, face-camera, or paid UGC path",
        ],
  };
}

function evaluateLinkedIn(input: ChannelAgentInput): ChannelAgentVerdict {
  const cards = evidenceFor(input.evidence, "linkedin");
  const professionalFit =
    input.app.productType === "b2b_workflow" ||
    input.app.productType === "developer_tool";
  const eligible = professionalFit && cards.length >= 2;
  return {
    channel: "linkedin",
    eligible,
    rationale: eligible
      ? ["professional buyer context exists", "LinkedIn evidence is present"]
      : ["LinkedIn needs professional buyer context"],
    risks: professionalFit ? [] : ["audience may not be in a professional feed"],
    requiredNextEvidence: eligible
      ? []
      : ["two buyer-context LinkedIn posts", "clear professional pain language"],
  };
}

function evaluateReddit(input: ChannelAgentInput): ChannelAgentVerdict {
  const cards = evidenceFor(input.evidence, "reddit");
  const highRisk = cards.some((card) => card.promotionRisk === "high");
  const eligible = cards.length >= 2 && !highRisk;
  return {
    channel: "reddit",
    eligible,
    rationale: eligible
      ? ["fresh pain threads exist", "reply-first motion is possible"]
      : ["Reddit requires pain threads and safe community rules"],
    risks: highRisk
      ? ["at least one source has high promotion risk"]
      : ["must avoid drive-by promotion"],
    requiredNextEvidence: eligible
      ? []
      : ["subreddit rules", "two fresh pain threads", "reply angle per thread"],
  };
}

function evaluateX(input: ChannelAgentInput): ChannelAgentVerdict {
  const cards = evidenceFor(input.evidence, "x");
  const eligible = cards.length >= 2;
  return {
    channel: "x",
    eligible,
    rationale: eligible
      ? ["founder-led conversation evidence exists"]
      : ["X needs proof of relevant conversations, not generic founder posts"],
    risks: ["easy to create vanity engagement without signups"],
    requiredNextEvidence: eligible
      ? []
      : ["two recent X conversations", "format examples that map to the product"],
  };
}

function evaluateProductHunt(input: ChannelAgentInput): ChannelAgentVerdict {
  const cards = input.evidence.filter(
    (card) => card.source === "competitor" || card.recommendedUse === "competitor"
  );
  const eligible = input.app.stage !== "idea" && cards.length >= 2;
  return {
    channel: "product_hunt",
    eligible,
    rationale: eligible
      ? ["launch surface can be prepared from competitor evidence"]
      : ["Product Hunt is parked until the app is launchable and competitor evidence exists"],
    risks: input.app.stage === "idea" ? ["too early for launch directory"] : [],
    requiredNextEvidence: eligible
      ? []
      : ["two competitor launches", "clear launch promise", "maker comment plan"],
  };
}

function evidenceFor(
  evidence: ReadonlyArray<GtmEvidenceCard>,
  source: GtmEvidenceCard["source"]
): GtmEvidenceCard[] {
  return evidence.filter((card) => card.source === source);
}
