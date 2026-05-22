export type TikTokWarmupState =
  | "unknown"
  | "new_needs_warmup"
  | "warming"
  | "ready"
  | "restricted";

export interface TikTokWarmupInput {
  canPostTikTokManually?: boolean;
  existingTikTokUrl?: string;
  tiktokWarmupState?: TikTokWarmupState;
  tiktokAccountAgeDays?: number;
  tiktokAccountStatusChecked?: boolean;
  maxWeeklyVisualPosts?: number;
}

export interface TikTokWarmupPlan {
  shouldWarmUp: boolean;
  postingCapPerWeek: number;
  status: "ready" | "warmup_required" | "blocked";
  rationale: string[];
  checklist: string[];
  firstWeekCalendarTasks: string[];
}

export function planTikTokWarmup(input: TikTokWarmupInput): TikTokWarmupPlan {
  if (!input.canPostTikTokManually) {
    return {
      shouldWarmUp: false,
      postingCapPerWeek: 0,
      status: "blocked",
      rationale: ["TikTok requires manual posting in V1."],
      checklist: ["Confirm whether the user is willing to manually post on TikTok."],
      firstWeekCalendarTasks: [],
    };
  }

  if (input.tiktokWarmupState === "restricted") {
    return {
      shouldWarmUp: false,
      postingCapPerWeek: 0,
      status: "blocked",
      rationale: ["The user reported TikTok account restrictions."],
      checklist: [
        "Ask the user to check TikTok Studio Account Check before scheduling posts.",
        "Do not create TikTok posting tasks until the restriction is resolved.",
      ],
      firstWeekCalendarTasks: [
        "Open TikTok Studio Account Check and confirm posting/comment/profile status.",
      ],
    };
  }

  const accountAgeDays = input.tiktokAccountAgeDays ?? 0;
  const hasProfile = Boolean(input.existingTikTokUrl?.trim());
  const explicitlyReady = input.tiktokWarmupState === "ready";
  const needsWarmup =
    input.tiktokWarmupState === "new_needs_warmup" ||
    input.tiktokWarmupState === "warming" ||
    !hasProfile ||
    accountAgeDays < 7 ||
    !input.tiktokAccountStatusChecked;

  if (!needsWarmup || explicitlyReady) {
    return {
      shouldWarmUp: false,
      postingCapPerWeek: Math.max(1, input.maxWeeklyVisualPosts ?? 3),
      status: "ready",
      rationale: ["TikTok account is reported ready for a normal test cadence."],
      checklist: [
        "Keep posting volume realistic for the founder.",
        "Check account status weekly before increasing cadence.",
      ],
      firstWeekCalendarTasks: [],
    };
  }

  return {
    shouldWarmUp: true,
    postingCapPerWeek: Math.min(2, Math.max(1, input.maxWeeklyVisualPosts ?? 2)),
    status: "warmup_required",
    rationale: [
      "TikTok account is new, unknown, or not yet status-checked.",
      "Maya should build normal account history before asking for a heavier content cadence.",
    ],
    checklist: [
      "Complete profile basics before posting.",
      "Use TikTok normally in the niche: watch relevant videos, follow real accounts, and save examples.",
      "Avoid bulk liking, bulk commenting, fake engagement, or high-volume commercial posting.",
      "Check TikTok Studio Account Check before first real launch post.",
      "Start with one or two low-pressure posts before scaling cadence.",
    ],
    firstWeekCalendarTasks: [
      "Day 1: finish profile and follow/save relevant niche examples.",
      "Day 2: watch niche videos and collect 5 reference posts for Maya.",
      "Day 3: check TikTok Studio Account Check.",
      "Day 4-7: post 1-2 low-pressure demo/slideshow tests if Account Check is clear.",
    ],
  };
}
