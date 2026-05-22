import type { Doc } from "../_generated/dataModel";

export type ResearchTaskKind =
  | "app_inspector"
  | "icp_hypothesis"
  | "reddit_demand"
  | "x_founder_led"
  | "linkedin_fit"
  | "tiktok_demo"
  | "competitor_search"
  | "channel_judge";

export interface ResearchTaskSpec {
  kind: ResearchTaskKind;
  skillSlug: string;
  objective: string;
  maxCostUsd: number;
  requiredEvidenceSources: Doc<"gtmEvidenceCards">["source"][];
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
}): ResearchTaskSpec[] {
  const visualPossible = input.canRecordScreen || input.canShowFace;
  return [
    task({
      kind: "app_inspector",
      skillSlug: "maya-app-inspector",
      objective: "Understand the app before asking the founder to know their ICP.",
      maxCostUsd: 0,
      requiredEvidenceSources: ["app"],
      evidenceCardsMin: 1,
      prompt: `Inspect ${input.appName} at ${input.appUrl}. Extract product promise, visible audience, feature surface, CTA, pricing visibility, and missing context.`,
    }),
    task({
      kind: "icp_hypothesis",
      skillSlug: "maya-icp-hypothesis",
      objective: "Infer likely buyers from the product and evidence.",
      maxCostUsd: 0.05,
      requiredEvidenceSources: ["app", "google", "competitor"],
      evidenceCardsMin: 2,
      prompt: `Infer likely buyers for ${input.appName}. Do not ask the user who their ICP is unless product evidence is insufficient.`,
    }),
    task({
      kind: "reddit_demand",
      skillSlug: "maya-reddit-demand-researcher",
      objective: "Find pain threads and community rules for reply-first GTM.",
      maxCostUsd: 0.35,
      requiredEvidenceSources: ["reddit"],
      evidenceCardsMin: 3,
      prompt: `Find Reddit threads where people describe the pain ${input.appName} might solve. Include promotion risk and reply angle for each.`,
    }),
    task({
      kind: "x_founder_led",
      skillSlug: "maya-x-founder-led-researcher",
      objective: "Find X conversations and post formats the founder can credibly use.",
      maxCostUsd: 0.25,
      requiredEvidenceSources: ["x"],
      evidenceCardsMin: 2,
      prompt: `Find X posts/conversations where founders discuss the problem ${input.appName} addresses. Extract reusable formats, not generic advice.`,
    }),
    task({
      kind: "linkedin_fit",
      skillSlug: "maya-linkedin-fit-researcher",
      objective: "Decide whether professional buyer context exists.",
      maxCostUsd: 0.2,
      requiredEvidenceSources: ["linkedin"],
      evidenceCardsMin: 2,
      prompt: `Check whether LinkedIn has buyer-context discussion for ${input.appName}. Park LinkedIn if evidence is weak.`,
    }),
    task({
      kind: "tiktok_demo",
      skillSlug: "maya-tiktok-demo-strategist",
      objective: visualPossible
        ? "Find demo formats the user can record manually."
        : "Park TikTok until visual assets are possible.",
      maxCostUsd: visualPossible ? 0.25 : 0,
      requiredEvidenceSources: ["tiktok"],
      evidenceCardsMin: visualPossible ? 2 : 1,
      prompt: visualPossible
        ? `Find TikTok demo/script formats ${input.appName} can use with screen or face recording. The user posts manually.`
        : `Do not spend on TikTok trend research. Produce a parked-channel evidence card explaining the missing visual asset constraint.`,
    }),
    task({
      kind: "competitor_search",
      skillSlug: "maya-competitor-researcher",
      objective: "Find substitutes, positioning, and complaints.",
      maxCostUsd: 0.15,
      requiredEvidenceSources: ["competitor", "google"],
      evidenceCardsMin: 2,
      prompt: `Find competitors or substitutes for ${input.appName}. Extract what users complain about and what positioning works.`,
    }),
    {
      kind: "channel_judge",
      skillSlug: "maya-channel-strategy-judge",
      objective: "Choose one primary and one optional secondary channel from evidence.",
      maxCostUsd: 0.05,
      requiredEvidenceSources: ["app", "reddit", "x", "linkedin", "tiktok", "competitor"],
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
  return {
    passed: failures.length === 0,
    failures,
  };
}

function task(input: {
  kind: ResearchTaskKind;
  skillSlug: string;
  objective: string;
  maxCostUsd: number;
  requiredEvidenceSources: Doc<"gtmEvidenceCards">["source"][];
  evidenceCardsMin: number;
  prompt: string;
}): ResearchTaskSpec {
  return {
    kind: input.kind,
    skillSlug: input.skillSlug,
    objective: input.objective,
    maxCostUsd: input.maxCostUsd,
    requiredEvidenceSources: input.requiredEvidenceSources,
    outputSchema: {
      evidenceCardsMin: input.evidenceCardsMin,
      mustCiteUrls: true,
      mustWriteCostLedger: true,
      mayFinalizeStrategy: false,
    },
    prompt: input.prompt,
  };
}
