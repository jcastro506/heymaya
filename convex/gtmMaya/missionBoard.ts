import { query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { decideLearningLoop } from "./resultsLoop";

export interface MissionBoardItem {
  label: string;
  detail: string;
  state: "done" | "active" | "blocked" | "waiting";
}

export interface MissionBoardData {
  appName: string;
  appUrl: string | null;
  stage: string;
  weekGoal: string;
  progress: MissionBoardItem[];
  diagnosis: MissionBoardItem[];
  evidenceCards: Array<{
    source: string;
    title: string;
    snippet: string;
    url: string;
    use: string;
  }>;
  channelDecisions: Array<{
    channel: string;
    decision: string;
    confidence: string;
    reasons: string[];
    risks: string[];
    firstWeekTest: string | null;
  }>;
  todayTasks: MissionBoardItem[];
  pendingApprovals: Array<{
    id: string;
    platform: string;
    body: string;
    evidenceCount: number;
  }>;
  results: MissionBoardItem[];
  learnings: MissionBoardItem[];
  nextTests: MissionBoardItem[];
  cost: {
    budgetUsd: number | null;
    spentUsd: number;
  };
}

interface ResultTotals {
  replies: number;
  clicks: number;
  signups: number;
  demos: number;
  feedbackItems: number;
}

export const getMyMissionBoard = query({
  args: {},
  handler: async (ctx): Promise<MissionBoardData | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return null;
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) return null;
    const app = agent.appId ? await ctx.db.get(agent.appId) : null;

    const jobs = await ctx.db
      .query("gtmResearchJobs")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const latestJob = jobs.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    const evidence = latestJob
      ? await ctx.db
          .query("gtmEvidenceCards")
          .withIndex("by_research_job", (q) =>
            q.eq("researchJobId", latestJob._id)
          )
          .collect()
      : [];
    const channelScores = latestJob
      ? await ctx.db
          .query("gtmChannelScores")
          .withIndex("by_research_job", (q) =>
            q.eq("researchJobId", latestJob._id)
          )
          .collect()
      : [];
    const drafts = await ctx.db
      .query("gtmContentDrafts")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const snapshots = await ctx.db
      .query("gtmResultSnapshots")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();

    return projectMissionBoard({
      agent,
      app,
      latestJob,
      evidence,
      channelScores,
      drafts,
      snapshots,
    });
  },
});

export function projectMissionBoard(input: {
  agent: Pick<Doc<"gtmAgents">, "onboardingStep" | "openClawFlyAppId">;
  app: Pick<
    Doc<"gtmApps">,
    "name" | "url" | "stage" | "weekGoal" | "diagnosis"
  > | null;
  latestJob: Pick<
    Doc<"gtmResearchJobs">,
    "status" | "phase" | "budgetUsd" | "spentUsd" | "failureReason"
  > | null;
  evidence: Array<
    Pick<
      Doc<"gtmEvidenceCards">,
      "source" | "title" | "snippet" | "url" | "recommendedUse" | "createdAt"
    >
  >;
  channelScores: Array<
    Pick<
      Doc<"gtmChannelScores">,
      | "channel"
      | "decision"
      | "confidence"
      | "reasons"
      | "risks"
      | "firstWeekTest"
      | "createdAt"
    >
  >;
  drafts: Array<
    Pick<
      Doc<"gtmContentDrafts">,
      "_id" | "platform" | "status" | "body" | "evidenceCardIds" | "createdAt"
    >
  >;
  snapshots: Array<
    Pick<
      Doc<"gtmResultSnapshots">,
      "replies" | "clicks" | "signups" | "demos" | "feedbackItems" | "capturedAt"
    >
  >;
}): MissionBoardData {
  const latestJob = input.latestJob;
  const appName = input.app?.name?.trim() || "Your product";
  const pendingDrafts = input.drafts
    .filter((draft) => draft.status === "drafted")
    .sort((a, b) => b.createdAt - a.createdAt);
  const publishedDrafts = input.drafts.filter(
    (draft) => draft.status === "published"
  );
  const channelScores = [...input.channelScores].sort(
    (a, b) => decisionRank(a.decision) - decisionRank(b.decision)
  );
  const activeChannels = channelScores.filter(
    (row) => row.decision === "primary" || row.decision === "secondary"
  );

  return {
    appName,
    appUrl: input.app?.url ?? null,
    stage: input.app?.stage ?? "not captured",
    weekGoal: input.app?.weekGoal ?? "not captured",
    progress: [
      {
        label: "App profile",
        detail: input.app ? `${appName} is connected.` : "Waiting for onboarding.",
        state: input.app ? "done" : "active",
      },
      {
        label: "Maya runtime",
        detail: input.agent.openClawFlyAppId
          ? `OpenClaw app ${input.agent.openClawFlyAppId}`
          : "OpenClaw deployment has not been recorded yet.",
        state: input.agent.openClawFlyAppId ? "done" : "waiting",
      },
      {
        label: "Research",
        detail: latestJob
          ? `${latestJob.phase} / ${latestJob.status}`
          : "No research job has started.",
        state: stateForJob(latestJob),
      },
      {
        label: "Plan",
        detail:
          activeChannels.length > 0
            ? activeChannels
                .map((row) => `${row.decision}: ${row.channel}`)
                .join(", ")
            : "No channel decision yet.",
        state: activeChannels.length > 0 ? "done" : "waiting",
      },
    ],
    diagnosis: diagnosisItems(input.app?.diagnosis, latestJob),
    evidenceCards: input.evidence
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 6)
      .map((card) => ({
        source: card.source,
        title: card.title ?? card.url,
        snippet: card.snippet,
        url: card.url,
        use: card.recommendedUse,
      })),
    channelDecisions: channelScores.map((row) => ({
      channel: row.channel,
      decision: row.decision,
      confidence: row.confidence,
      reasons: row.reasons,
      risks: row.risks,
      firstWeekTest: row.firstWeekTest ?? null,
    })),
    todayTasks: buildTodayTasks({
      latestJob,
      activeChannels,
      pendingDraftCount: pendingDrafts.length,
    }),
    pendingApprovals: pendingDrafts.slice(0, 6).map((draft) => ({
      id: String(draft._id as Id<"gtmContentDrafts">),
      platform: draft.platform,
      body: draft.body,
      evidenceCount: draft.evidenceCardIds.length,
    })),
    results: resultItems({ snapshots: input.snapshots, publishedDrafts }),
    learnings: learningItems(input.snapshots),
    nextTests: nextTestItems({
      snapshots: input.snapshots,
      activeChannels,
      pendingDraftCount: pendingDrafts.length,
    }),
    cost: {
      budgetUsd: latestJob?.budgetUsd ?? null,
      spentUsd: latestJob?.spentUsd ?? 0,
    },
  };
}

function diagnosisItems(
  diagnosis: unknown,
  latestJob: Pick<
    Doc<"gtmResearchJobs">,
    "status" | "failureReason"
  > | null
): MissionBoardItem[] {
  if (latestJob?.status === "failed") {
    return [
      {
        label: "Research failed",
        detail: latestJob.failureReason ?? "Maya needs operator review.",
        state: "blocked",
      },
    ];
  }
  if (!diagnosis || typeof diagnosis !== "object") {
    return [
      {
        label: "App diagnosis",
        detail: "Maya has not written a diagnosis yet.",
        state: "waiting",
      },
    ];
  }
  const record = diagnosis as Record<string, unknown>;
  return Object.entries(record)
    .slice(0, 4)
    .map(([label, value]) => ({
      label,
      detail: String(value),
      state: "done",
    }));
}

function buildTodayTasks(input: {
  latestJob: Pick<Doc<"gtmResearchJobs">, "status" | "phase"> | null;
  activeChannels: Array<Pick<Doc<"gtmChannelScores">, "channel" | "firstWeekTest">>;
  pendingDraftCount: number;
}): MissionBoardItem[] {
  if (input.pendingDraftCount > 0) {
    return [
      {
        label: "Review approvals",
        detail: `${input.pendingDraftCount} draft${input.pendingDraftCount === 1 ? "" : "s"} waiting for approval.`,
        state: "active",
      },
    ];
  }
  if (!input.latestJob || input.latestJob.status === "queued") {
    return [
      {
        label: "Research queue",
        detail: "Maya is waiting to start the first research job.",
        state: "waiting",
      },
    ];
  }
  if (
    input.latestJob.status === "running" ||
    input.latestJob.status === "needs_more_evidence"
  ) {
    return [
      {
        label: "Research in progress",
        detail: `Current phase: ${input.latestJob.phase}.`,
        state: "active",
      },
    ];
  }
  if (input.activeChannels.length === 0) {
    return [
      {
        label: "Channel decision",
        detail: "Maya needs a primary channel before creating tasks.",
        state: "waiting",
      },
    ];
  }
  return input.activeChannels.map((channel) => ({
    label: `${channel.channel} test`,
    detail: channel.firstWeekTest ?? "Maya has not written the first test yet.",
    state: channel.firstWeekTest ? "active" : "waiting",
  }));
}

function resultItems(input: {
  snapshots: Array<
    Pick<
      Doc<"gtmResultSnapshots">,
      "replies" | "clicks" | "signups" | "demos" | "feedbackItems"
    >
  >;
  publishedDrafts: Array<Pick<Doc<"gtmContentDrafts">, "platform">>;
}): MissionBoardItem[] {
  if (input.snapshots.length === 0) {
    return [
      {
        label: "No result snapshots",
        detail: input.publishedDrafts.length
          ? "Published work exists; Maya has not captured metrics yet."
          : "Maya needs approved or posted work before results exist.",
        state: "waiting",
      },
    ];
  }
  const initialTotals: ResultTotals = {
    replies: 0,
    clicks: 0,
    signups: 0,
    demos: 0,
    feedbackItems: 0,
  };
  const totals = input.snapshots.reduce<ResultTotals>(
    (sum, row) => ({
      replies: sum.replies + (row.replies ?? 0),
      clicks: sum.clicks + (row.clicks ?? 0),
      signups: sum.signups + (row.signups ?? 0),
      demos: sum.demos + (row.demos ?? 0),
      feedbackItems: sum.feedbackItems + (row.feedbackItems ?? 0),
    }),
    initialTotals
  );
  return [
    {
      label: "Customer movement",
      detail: `${totals.signups} signups, ${totals.demos} demos, ${totals.feedbackItems} useful feedback items.`,
      state:
        totals.signups + totals.demos + totals.feedbackItems > 0
          ? "done"
          : "waiting",
    },
    {
      label: "Engagement",
      detail: `${totals.replies} replies and ${totals.clicks} tracked clicks.`,
      state: totals.replies + totals.clicks > 0 ? "done" : "waiting",
    },
  ];
}

function learningItems(
  snapshots: Array<
    Pick<
      Doc<"gtmResultSnapshots">,
      "replies" | "clicks" | "signups" | "demos" | "feedbackItems"
    >
  >
): MissionBoardItem[] {
  if (snapshots.length === 0) {
    return [
      {
        label: "No learning yet",
        detail: "Maya needs result snapshots before updating strategy or memory.",
        state: "waiting",
      },
    ];
  }
  const decision = decideLearningLoop(snapshots);
  return [
    {
      label: "Signal read",
      detail: decision.summary,
      state: decision.signal === "strong" ? "done" : "active",
    },
    {
      label: "Memory promotion",
      detail: decision.memoryPromotionAllowed
        ? "This lesson is strong enough to promote into durable memory."
        : "This lesson stays provisional until customer movement repeats.",
      state: decision.memoryPromotionAllowed ? "done" : "waiting",
    },
  ];
}

function nextTestItems(input: {
  snapshots: Array<
    Pick<
      Doc<"gtmResultSnapshots">,
      "replies" | "clicks" | "signups" | "demos" | "feedbackItems"
    >
  >;
  activeChannels: Array<Pick<Doc<"gtmChannelScores">, "channel" | "firstWeekTest">>;
  pendingDraftCount: number;
}): MissionBoardItem[] {
  if (input.pendingDraftCount > 0) {
    return [
      {
        label: "Approval first",
        detail: "Clear pending approvals before Maya creates the next test.",
        state: "active",
      },
    ];
  }
  if (input.activeChannels.length === 0) {
    return [
      {
        label: "Pick channel",
        detail: "Maya needs a primary channel before choosing the next test.",
        state: "waiting",
      },
    ];
  }
  if (input.snapshots.length === 0) {
    return input.activeChannels.map((channel) => ({
      label: `${channel.channel} first test`,
      detail: channel.firstWeekTest ?? "Run the first channel test and capture the result link.",
      state: "active",
    }));
  }
  const decision = decideLearningLoop(input.snapshots);
  return [
    {
      label:
        decision.recommendation === "double_down"
          ? "Double down"
          : decision.recommendation === "iterate"
            ? "Revise"
            : "Keep measuring",
      detail: decision.nextAction,
      state: decision.recommendation === "double_down" ? "done" : "active",
    },
  ];
}

function stateForJob(
  job: Pick<Doc<"gtmResearchJobs">, "status"> | null
): MissionBoardItem["state"] {
  if (!job) return "waiting";
  if (job.status === "failed" || job.status === "cancelled") return "blocked";
  if (job.status === "ready_for_review") return "done";
  return "active";
}

function decisionRank(decision: string): number {
  switch (decision) {
    case "primary":
      return 0;
    case "secondary":
      return 1;
    case "parked":
      return 2;
    default:
      return 3;
  }
}
