import type { Doc } from "../_generated/dataModel";

export type ResearchTaskKind =
  | "app_inspector"
  | "icp_hypothesis"
  | "reddit_demand"
  | "x_founder_led"
  | "linkedin_fit"
  | "tiktok_format_research"
  | "instagram_format_planner"
  | "competitor_search"
  | "channel_judge";

export type ResearchModelRoute =
  | "main_maya"
  | "hard_research_beta"
  | "future_default_research"
  | "extraction_worker";

export interface ResearchRetryPolicy {
  maxAttempts: number;
  retryableFailures: string[];
  escalation: "park_channel" | "ask_user" | "hard_research_model";
}

export interface ResearchTaskSpec {
  kind: ResearchTaskKind;
  skillSlug: string;
  objective: string;
  modelRoute: ResearchModelRoute;
  timeoutMinutes: number;
  maxCostUsd: number;
  maxScrapeCreatorsCalls: number;
  maxWebSearches: number;
  requiredEvidenceSources: Doc<"gtmEvidenceCards">["source"][];
  coverageChecklist: string[];
  failureBehavior: string;
  retryPolicy: ResearchRetryPolicy;
  outputSchema: {
    evidenceCardsMin: number;
    mustCiteUrls: boolean;
    mustWriteCostLedger: boolean;
    mayFinalizeStrategy: boolean;
  };
  prompt: string;
}

export function buildResearchTaskSpecs(input: {
  appName: string;
  appUrl: string;
  canRecordScreen: boolean;
  canShowFace: boolean;
  canRecordVoice?: boolean;
  canProvideScreenshots?: boolean;
  canPostTikTokManually?: boolean;
  canPostInstagramManually?: boolean;
  openToUgcCreators?: boolean;
  creatorBudgetMonthlyUsd?: number;
}): ResearchTaskSpec[] {
  const hasUserMadeVisualPath =
    input.canRecordScreen ||
    input.canShowFace ||
    input.canRecordVoice ||
    input.canProvideScreenshots;
  const hasPaidCreatorPath =
    input.openToUgcCreators && (input.creatorBudgetMonthlyUsd ?? 0) > 0;
  const tiktokPossible = Boolean(
    input.canPostTikTokManually && (hasUserMadeVisualPath || hasPaidCreatorPath)
  );
  const instagramPossible = Boolean(
    input.canPostInstagramManually && (hasUserMadeVisualPath || hasPaidCreatorPath)
  );
  return [
    task({
      kind: "app_inspector",
      skillSlug: "maya-app-inspector",
      objective: "Understand the app before asking the founder to know their ICP.",
      modelRoute: "extraction_worker",
      timeoutMinutes: 8,
      maxCostUsd: 0,
      maxScrapeCreatorsCalls: 0,
      maxWebSearches: 2,
      requiredEvidenceSources: ["app"],
      evidenceCardsMin: 1,
      coverageChecklist: [
        "product promise",
        "visible audience",
        "activation path",
        "pricing or waitlist path",
      ],
      failureBehavior:
        "Ask for a screen recording or screenshots before channel strategy.",
      prompt: `Inspect ${input.appName} at ${input.appUrl}. Extract product promise, visible audience, feature surface, CTA, pricing visibility, and missing context.`,
    }),
    task({
      kind: "icp_hypothesis",
      skillSlug: "maya-icp-hypothesis",
      objective: "Infer likely buyers from the product and evidence.",
      modelRoute: "hard_research_beta",
      timeoutMinutes: 12,
      maxCostUsd: 0.05,
      maxScrapeCreatorsCalls: 0,
      maxWebSearches: 5,
      requiredEvidenceSources: ["app", "google", "competitor"],
      evidenceCardsMin: 2,
      coverageChecklist: [
        "buyer hypothesis",
        "pain intensity",
        "searchable language",
        "why the founder should not be asked to invent the ICP",
      ],
      failureBehavior:
        "Keep ICP confidence low and make the first plan feedback-first.",
      prompt: `Infer likely buyers for ${input.appName}. Do not ask the user who their ICP is unless product evidence is insufficient.`,
    }),
    task({
      kind: "reddit_demand",
      skillSlug: "maya-reddit-demand-researcher",
      objective: "Find pain threads and community rules for reply-first GTM.",
      modelRoute: "hard_research_beta",
      timeoutMinutes: 16,
      maxCostUsd: 0.35,
      maxScrapeCreatorsCalls: 2,
      maxWebSearches: 4,
      requiredEvidenceSources: ["reddit"],
      evidenceCardsMin: 3,
      coverageChecklist: [
        "fresh pain threads",
        "community rules",
        "promotion risk",
        "reply angle",
      ],
      failureBehavior: "Park Reddit if promotion risk is high or pain is weak.",
      prompt: `Find Reddit threads where people describe the pain ${input.appName} might solve. Include promotion risk and reply angle for each.`,
    }),
    task({
      kind: "x_founder_led",
      skillSlug: "maya-x-founder-led-researcher",
      objective: "Find X conversations and post formats the founder can credibly use.",
      modelRoute: "hard_research_beta",
      timeoutMinutes: 14,
      maxCostUsd: 0.25,
      maxScrapeCreatorsCalls: 2,
      maxWebSearches: 3,
      requiredEvidenceSources: ["x"],
      evidenceCardsMin: 2,
      coverageChecklist: [
        "recent founder/customer conversations",
        "post format",
        "reply surface",
        "signup or feedback intent",
      ],
      failureBehavior:
        "Park X if the only evidence is generic build-in-public content.",
      prompt: `Find X posts/conversations where founders discuss the problem ${input.appName} addresses. Extract reusable formats, not generic advice.`,
    }),
    task({
      kind: "linkedin_fit",
      skillSlug: "maya-linkedin-fit-researcher",
      objective: "Decide whether professional buyer context exists.",
      modelRoute: "future_default_research",
      timeoutMinutes: 10,
      maxCostUsd: 0.2,
      maxScrapeCreatorsCalls: 1,
      maxWebSearches: 4,
      requiredEvidenceSources: ["linkedin"],
      evidenceCardsMin: 2,
      coverageChecklist: [
        "professional buyer context",
        "job-title or workflow language",
        "comment surface",
        "why LinkedIn should be active or parked",
      ],
      failureBehavior: "Park LinkedIn if there is no professional buyer context.",
      prompt: `Check whether LinkedIn has buyer-context discussion for ${input.appName}. Park LinkedIn if evidence is weak.`,
    }),
    task({
      kind: "tiktok_format_research",
      skillSlug: "maya-tiktok-demo-strategist",
      objective: tiktokPossible
        ? "Find TikTok demo, slideshow, and UGC-style formats the user can realistically produce."
        : "Park TikTok until manual posting and a visual production path are possible.",
      modelRoute: "hard_research_beta",
      timeoutMinutes: tiktokPossible ? 18 : 4,
      maxCostUsd: tiktokPossible ? 0.3 : 0,
      maxScrapeCreatorsCalls: tiktokPossible ? 3 : 0,
      maxWebSearches: tiktokPossible ? 3 : 0,
      requiredEvidenceSources: ["tiktok"],
      evidenceCardsMin: tiktokPossible ? 3 : 1,
      coverageChecklist: tiktokPossible
        ? [
            "video demo formats",
            "slideshow/photo-mode formats",
            "hook pattern",
            "reference post URLs",
            "production requirement for the founder",
          ]
        : ["manual posting constraint", "visual asset constraint"],
      failureBehavior:
        "Park TikTok if evidence is thin or the user cannot actually produce the format this week.",
      prompt: tiktokPossible
        ? `Find TikTok demo, slideshow/photo-mode, and UGC-style script formats ${input.appName} can use. The user posts manually, so every idea must include the exact asset needed and why it is realistic.`
        : `Do not spend on TikTok trend research. Produce a parked-channel evidence card explaining the missing manual-posting or visual-production constraint.`,
    }),
    task({
      kind: "instagram_format_planner",
      skillSlug: "maya-instagram-format-planner",
      objective: instagramPossible
        ? "Research Reels/carousel reuse plans that can come from the same assets as TikTok."
        : "Park Instagram until manual posting and reusable visual assets are possible.",
      modelRoute: "future_default_research",
      timeoutMinutes: instagramPossible ? 12 : 4,
      maxCostUsd: instagramPossible ? 0.15 : 0,
      maxScrapeCreatorsCalls: instagramPossible ? 1 : 0,
      maxWebSearches: instagramPossible ? 3 : 0,
      requiredEvidenceSources: ["instagram"],
      evidenceCardsMin: instagramPossible ? 2 : 1,
      coverageChecklist: instagramPossible
        ? [
            "Reels format",
            "carousel/slideshow format",
            "asset reuse from TikTok or screenshots",
            "manual posting limitation",
          ]
        : ["manual posting constraint", "visual asset constraint"],
      failureBehavior:
        "Use Instagram as a reuse lane only; do not make it primary in V1.",
      prompt: instagramPossible
        ? `Find Instagram Reels and carousel formats ${input.appName} can reuse from the same TikTok/screenshot assets. Do not assume API posting.`
        : `Do not spend on Instagram research. Produce a parked-channel evidence card explaining the missing manual-posting or visual-production constraint.`,
    }),
    task({
      kind: "competitor_search",
      skillSlug: "maya-competitor-researcher",
      objective: "Find substitutes, positioning, and complaints.",
      modelRoute: "hard_research_beta",
      timeoutMinutes: 12,
      maxCostUsd: 0.15,
      maxScrapeCreatorsCalls: 0,
      maxWebSearches: 6,
      requiredEvidenceSources: ["competitor", "google"],
      evidenceCardsMin: 2,
      coverageChecklist: [
        "direct competitors",
        "substitutes",
        "complaints",
        "positioning that appears to work",
      ],
      failureBehavior:
        "Proceed with low confidence and schedule more research before scaling spend.",
      prompt: `Find competitors or substitutes for ${input.appName}. Extract what users complain about and what positioning works.`,
    }),
    {
      kind: "channel_judge",
      skillSlug: "maya-channel-strategy-judge",
      objective: "Choose one primary and one optional secondary channel from evidence.",
      modelRoute: "main_maya",
      timeoutMinutes: 10,
      maxCostUsd: 0.05,
      maxScrapeCreatorsCalls: 0,
      maxWebSearches: 0,
      requiredEvidenceSources: [
        "app",
        "reddit",
        "x",
        "linkedin",
        "tiktok",
        "instagram",
        "competitor",
      ],
      coverageChecklist: [
        "exactly one primary channel",
        "at most one secondary channel",
        "parked-channel reasons",
        "first-week test",
        "cost ledger summary",
      ],
      failureBehavior:
        "Return needs_more_evidence instead of inventing a confident plan.",
      retryPolicy: {
        maxAttempts: 1,
        retryableFailures: ["missing cited evidence", "missing cost ledger"],
        escalation: "hard_research_model",
      },
      outputSchema: {
        evidenceCardsMin: 0,
        mustCiteUrls: true,
        mustWriteCostLedger: true,
        mayFinalizeStrategy: true,
      },
      prompt: `Score channels for ${input.appName}. Use only evidence cards already written. Choose exactly one primary and at most one secondary.`,
    },
  ];
}

export function validateResearchTaskResult(input: {
  task: ResearchTaskSpec;
  evidenceCards: Array<Pick<Doc<"gtmEvidenceCards">, "source" | "url" | "snippet">>;
  costLedgerWritten: boolean;
  completedChecklistItems?: string[];
}): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  if (input.evidenceCards.length < input.task.outputSchema.evidenceCardsMin) {
    failures.push("too few evidence cards");
  }
  if (
    input.task.outputSchema.mustCiteUrls &&
    input.evidenceCards.some((card) => !card.url.startsWith("http"))
  ) {
    failures.push("evidence cards must cite URLs");
  }
  if (
    input.task.requiredEvidenceSources.length > 0 &&
    !input.evidenceCards.some((card) =>
      input.task.requiredEvidenceSources.includes(card.source)
    ) &&
    input.task.kind !== "channel_judge"
  ) {
    failures.push("missing required evidence source");
  }
  if (input.task.outputSchema.mustWriteCostLedger && !input.costLedgerWritten) {
    failures.push("cost ledger entry required");
  }
  const completed = new Set(input.completedChecklistItems ?? []);
  const missingChecklistItems = input.task.coverageChecklist.filter(
    (item) => !completed.has(item)
  );
  if (
    input.completedChecklistItems !== undefined &&
    missingChecklistItems.length > 0
  ) {
    failures.push(
      `missing coverage checklist items: ${missingChecklistItems.join(", ")}`
    );
  }
  return {
    passed: failures.length === 0,
    failures,
  };
}

function task(input: {
  kind: ResearchTaskKind;
  skillSlug: string;
  objective: string;
  modelRoute: ResearchModelRoute;
  timeoutMinutes: number;
  maxCostUsd: number;
  maxScrapeCreatorsCalls: number;
  maxWebSearches: number;
  requiredEvidenceSources: Doc<"gtmEvidenceCards">["source"][];
  coverageChecklist: string[];
  failureBehavior: string;
  evidenceCardsMin: number;
  prompt: string;
}): ResearchTaskSpec {
  return {
    kind: input.kind,
    skillSlug: input.skillSlug,
    objective: input.objective,
    modelRoute: input.modelRoute,
    timeoutMinutes: input.timeoutMinutes,
    maxCostUsd: input.maxCostUsd,
    maxScrapeCreatorsCalls: input.maxScrapeCreatorsCalls,
    maxWebSearches: input.maxWebSearches,
    requiredEvidenceSources: input.requiredEvidenceSources,
    coverageChecklist: input.coverageChecklist,
    failureBehavior: input.failureBehavior,
    retryPolicy: {
      maxAttempts: 2,
      retryableFailures: [
        "too few evidence cards",
        "evidence cards must cite URLs",
        "missing required evidence source",
        "missing coverage checklist items",
      ],
      escalation: "hard_research_model",
    },
    outputSchema: {
      evidenceCardsMin: input.evidenceCardsMin,
      mustCiteUrls: true,
      mustWriteCostLedger: true,
      mayFinalizeStrategy: false,
    },
    prompt: input.prompt,
  };
}
