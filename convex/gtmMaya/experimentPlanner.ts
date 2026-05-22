import type { GtmAppContext, GtmChannelEvaluation, GtmEvidenceCard } from "./channelScoring";
import {
  assessUgcReadiness,
  buildFormatExperimentPlan,
  evaluateDistributionMotions,
  type FormatExperimentPlan,
  type UgcReadinessReport,
} from "./distributionMotions";
import { buildStrategyPlan, validateStrategyPlan, type GtmStrategyPlan } from "./strategyJudge";

export interface GtmExperimentPlan {
  strategy: GtmStrategyPlan;
  formatExperiments: FormatExperimentPlan[];
  ugcReadiness: UgcReadinessReport;
  weekCount: 1 | 2;
  operatingRule: string;
}

export function buildGtmExperimentPlan(input: {
  productName: string;
  app: GtmAppContext & {
    productType:
      | "b2b_workflow"
      | "developer_tool"
      | "consumer_visual"
      | "prosumer"
      | "unknown";
  };
  evaluations: ReadonlyArray<GtmChannelEvaluation>;
  evidence: ReadonlyArray<GtmEvidenceCard>;
  weekCount?: 1 | 2;
}): GtmExperimentPlan {
  let strategy: GtmStrategyPlan;
  try {
    strategy = buildStrategyPlan(input.evaluations);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`strategy is not experiment-ready: ${message}`);
  }
  const strategyGate = validateStrategyPlan({
    plan: strategy,
    evaluations: input.evaluations,
  });
  if (!strategyGate.passed) {
    throw new Error(`strategy is not experiment-ready: ${strategyGate.failures.join("; ")}`);
  }

  const motions = evaluateDistributionMotions({
    app: input.app,
    evidence: input.evidence,
  });
  const formatExperiments = motions
    .filter((motion) => motion.status === "test_now" || motion.status === "test_later")
    .slice(0, input.weekCount === 2 ? 5 : 3)
    .map((motion) => buildFormatExperimentPlan(motion, input.productName));
  const ugcReadiness = assessUgcReadiness({
    app: input.app,
    motionDecisions: formatExperiments.map((experiment) => ({
      motion: experiment.motion,
      scaleDecision: experiment.scaleDecision,
    })),
  });

  return {
    strategy,
    formatExperiments,
    ugcReadiness,
    weekCount: input.weekCount ?? 1,
    operatingRule:
      "Run only evidence-backed tests, measure customer movement, and revise before adding channels.",
  };
}

export function validateGtmExperimentPlan(input: {
  plan: GtmExperimentPlan;
  evaluations: ReadonlyArray<GtmChannelEvaluation>;
}): { passed: boolean; failures: string[] } {
  const failures = validateStrategyPlan({
    plan: input.plan.strategy,
    evaluations: input.evaluations,
  }).failures;

  if (input.plan.formatExperiments.length === 0) {
    failures.push("experiment plan needs at least one format experiment");
  }
  if (input.plan.weekCount === 1 && input.plan.formatExperiments.length > 3) {
    failures.push("week-one plan has too many simultaneous experiments");
  }
  for (const experiment of input.plan.formatExperiments) {
    if (experiment.variants.length === 0) {
      failures.push(`${experiment.motion} has no variants`);
    }
    if (!experiment.hypothesis.includes("because")) {
      failures.push(`${experiment.motion} hypothesis lacks evidence rationale`);
    }
    for (const variant of experiment.variants) {
      if (!variant.hook.trim() || !variant.cta.trim()) {
        failures.push(`${experiment.motion} variant is missing hook or CTA`);
      }
      if (!variant.formatSkeleton.trim()) {
        failures.push(`${experiment.motion} variant is missing format skeleton`);
      }
    }
  }
  if (input.plan.ugcReadiness.readiness === "ready" && input.plan.weekCount === 1) {
    failures.push("UGC recruiting should not start before a measured short-form winner");
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}
