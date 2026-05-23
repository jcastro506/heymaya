export interface VisualProductionReality {
  canRecordScreen: boolean;
  canShowFace: boolean;
  canRecordVoice: boolean;
  canProvideScreenshots: boolean;
  canPostTikTokManually: boolean;
  canPostInstagramManually: boolean;
  openToUgcCreators: boolean;
  creatorBudgetMonthlyUsd?: number;
  maxWeeklyVisualPosts?: number;
  existingTikTokUrl?: string;
  existingInstagramUrl?: string;
}

export type VisualChannel = "tiktok" | "instagram";

export type VisualProductionPath =
  | "slideshow_carousel"
  | "faceless_screen_recording"
  | "voiceover_demo"
  | "founder_talking_head"
  | "ugc_system_later"
  | "park_visual_channels";

export interface VisualProductionFit {
  channel: VisualChannel;
  viable: boolean;
  paths: VisualProductionPath[];
  rationale: string[];
  risks: string[];
}

export function evaluateVisualProductionFit(
  input: VisualProductionReality
): VisualProductionFit[] {
  return [
    evaluateChannel("tiktok", input, input.canPostTikTokManually),
    evaluateChannel("instagram", input, input.canPostInstagramManually),
  ];
}

export function canRecommendVisualChannels(
  input: VisualProductionReality
): boolean {
  return evaluateVisualProductionFit(input).some((fit) => fit.viable);
}

function evaluateChannel(
  channel: VisualChannel,
  input: VisualProductionReality,
  canPostManually: boolean
): VisualProductionFit {
  const paths: VisualProductionPath[] = [];
  const rationale: string[] = [];
  const risks: string[] = [];

  if (input.canProvideScreenshots) {
    paths.push("slideshow_carousel");
    rationale.push("user can provide screenshots for carousel/slideshow tests");
  }
  if (input.canRecordScreen) {
    paths.push("faceless_screen_recording");
    rationale.push("user can screen-record the app for faceless demos");
  }
  if (input.canRecordVoice && input.canRecordScreen) {
    paths.push("voiceover_demo");
    rationale.push("user can add voiceover to demo clips");
  }
  if (input.canShowFace) {
    paths.push("founder_talking_head");
    rationale.push("user is willing to test founder-face content");
  }

  const hasCreatorBudget =
    input.openToUgcCreators && (input.creatorBudgetMonthlyUsd ?? 0) > 0;
  if (hasCreatorBudget) {
    paths.push("ugc_system_later");
    rationale.push("user is open to paid UGC after a format proves itself");
  }

  if (!canPostManually) {
    risks.push(`${channel} requires manual posting in V1`);
  }
  if ((input.maxWeeklyVisualPosts ?? 0) === 0) {
    risks.push("no weekly visual-post capacity was stated");
  }

  const hasAssetPath = paths.some((path) => path !== "ugc_system_later");
  const viable = canPostManually && hasAssetPath;

  if (!viable) {
    return {
      channel,
      viable: false,
      paths: ["park_visual_channels"],
      rationale:
        rationale.length > 0
          ? rationale
          : ["no visual asset path is available for this founder"],
      risks:
        risks.length > 0
          ? risks
          : ["TikTok/Instagram should be parked until production capacity exists"],
    };
  }

  return {
    channel,
    viable: true,
    paths,
    rationale,
    risks,
  };
}
