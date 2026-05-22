import type { GtmAppContext, GtmEvidenceCard } from "./channelScoring";

export type DistributionMotion =
  | "reddit_helpful_reply"
  | "x_founder_led"
  | "linkedin_founder_led"
  | "tiktok_faceless_demo"
  | "tiktok_founder_talking_head"
  | "tiktok_slideshow_carousel"
  | "ugc_creator_test"
  | "paid_ads_later"
  | "influencer_later";

export type DistributionMotionStatus =
  | "test_now"
  | "test_later"
  | "parked"
  | "blocked";

export type ExperimentScaleDecision =
  | "keep_testing"
  | "double_down"
  | "revise"
  | "park";

export type ExperimentSuccessMetric =
  | "qualified_replies"
  | "signups"
  | "installs"
  | "trials"
  | "creator_applicants";

export interface DistributionMotionVerdict {
  motion: DistributionMotion;
  status: DistributionMotionStatus;
  rationale: string[];
  risks: string[];
  evidenceCardIds: string[];
  minimumCadence: string;
  stopCriteria: string;
  doubleDownCriteria: string;
}

export interface FormatVariant {
  hook: string;
  demoMoment?: string;
  cta: string;
  formatSkeleton: string;
}

export interface FormatExperimentPlan {
  motion: DistributionMotion;
  hypothesis: string;
  variants: FormatVariant[];
  successMetric: ExperimentSuccessMetric;
  scaleDecision: ExperimentScaleDecision;
}

export interface MotionResultInput {
  views?: number;
  likes?: number;
  replies?: number;
  clicks?: number;
  signups?: number;
  installs?: number;
  trials?: number;
  demos?: number;
  feedbackItems?: number;
  creatorApplicants?: number;
}

type MotionResultTotals = Required<MotionResultInput>;

export interface UgcReadinessReport {
  readiness: "premature" | "useful_soon" | "ready";
  reasons: string[];
  requiredProof: string[];
  creatorProfile?: string;
  briefTemplate?: string;
  trainingOutline?: string[];
  managementCadence?: string;
}

export function evaluateDistributionMotions(input: {
  app: GtmAppContext & {
    productType:
      | "b2b_workflow"
      | "developer_tool"
      | "consumer_visual"
      | "prosumer"
      | "unknown";
  };
  evidence: ReadonlyArray<GtmEvidenceCard>;
}): DistributionMotionVerdict[] {
  const motions: DistributionMotionVerdict[] = [
    redditMotion(input.evidence),
    xMotion(input.evidence),
    linkedinMotion(input.app, input.evidence),
    tiktokFacelessMotion(input.app, input.evidence),
    tiktokFounderMotion(input.app, input.evidence),
    tiktokSlideshowMotion(input.app, input.evidence),
    ugcMotion(input.app, input.evidence),
  ];

  const active = motions
    .filter((motion) => motion.status === "test_now")
    .sort((a, b) => b.evidenceCardIds.length - a.evidenceCardIds.length);
  const activeSet = new Set(active.slice(0, 3).map((motion) => motion.motion));

  return motions.map((motion) => {
    if (motion.status !== "test_now" || activeSet.has(motion.motion)) {
      return motion;
    }
    return {
      ...motion,
      status: "test_later",
      rationale: [
        ...motion.rationale,
        "parked for sequencing because Maya should test only a few motions at once",
      ],
    };
  });
}

export function buildFormatExperimentPlan(
  verdict: DistributionMotionVerdict,
  productName: string
): FormatExperimentPlan {
  return {
    motion: verdict.motion,
    hypothesis: hypothesisFor(verdict, productName),
    variants: variantsFor(verdict.motion, productName),
    successMetric: successMetricFor(verdict.motion),
    scaleDecision: "keep_testing",
  };
}

export function decideExperimentScale(
  results: ReadonlyArray<MotionResultInput>
): ExperimentScaleDecision {
  const zeroTotals: MotionResultTotals = {
    views: 0,
    likes: 0,
    replies: 0,
    clicks: 0,
    signups: 0,
    installs: 0,
    trials: 0,
    demos: 0,
    feedbackItems: 0,
    creatorApplicants: 0,
  };
  const totals = results.reduce<MotionResultTotals>(
    (sum, row) => ({
      views: sum.views + (row.views ?? 0),
      likes: sum.likes + (row.likes ?? 0),
      replies: sum.replies + (row.replies ?? 0),
      clicks: sum.clicks + (row.clicks ?? 0),
      signups: sum.signups + (row.signups ?? 0),
      installs: sum.installs + (row.installs ?? 0),
      trials: sum.trials + (row.trials ?? 0),
      demos: sum.demos + (row.demos ?? 0),
      feedbackItems: sum.feedbackItems + (row.feedbackItems ?? 0),
      creatorApplicants: sum.creatorApplicants + (row.creatorApplicants ?? 0),
    }),
    zeroTotals
  );
  const customerSignal =
    totals.signups +
    totals.installs +
    totals.trials +
    totals.demos * 2 +
    totals.feedbackItems +
    totals.creatorApplicants +
    totals.replies * 0.25;

  if (customerSignal >= 5 && results.length >= 3) return "double_down";
  if (totals.views >= 10_000 && customerSignal < 1) return "revise";
  if (results.length >= 5 && customerSignal < 1) return "park";
  return "keep_testing";
}

export function assessUgcReadiness(input: {
  app: GtmAppContext & { canRecordScreen: boolean; canShowFace: boolean };
  motionDecisions: ReadonlyArray<{
    motion: DistributionMotion;
    scaleDecision: ExperimentScaleDecision;
  }>;
}): UgcReadinessReport {
  const winningShortForm = input.motionDecisions.some(
    (motion) =>
      (motion.motion === "tiktok_faceless_demo" ||
        motion.motion === "tiktok_founder_talking_head" ||
        motion.motion === "tiktok_slideshow_carousel") &&
      motion.scaleDecision === "double_down"
  );
  if (winningShortForm) {
    return {
      readiness: "ready",
      reasons: ["a short-form motion has repeated customer signal"],
      requiredProof: [],
      creatorProfile:
        "Micro creator who can explain a product problem clearly and record crisp app demos.",
      briefTemplate:
        "Use the proven hook, show the exact app moment, keep one CTA, and send the result URL back to Maya.",
      trainingOutline: [
        "What the app does and who it helps",
        "The winning format skeleton",
        "Examples to copy structurally, not word-for-word",
        "Submission checklist and common mistakes",
      ],
      managementCadence: "weekly batch review plus async feedback on every post",
    };
  }

  const canTestShortForm = input.app.canRecordScreen || input.app.canShowFace;
  if (canTestShortForm) {
    return {
      readiness: "useful_soon",
      reasons: ["the app can test short-form manually before recruiting creators"],
      requiredProof: [
        "at least three short-form tests",
        "one format with qualified replies, installs, trials, or signups",
      ],
    };
  }

  return {
    readiness: "premature",
    reasons: ["no proven short-form motion or recording capacity yet"],
    requiredProof: [
      "showable app demo moment",
      "manual founder/faceless test with customer signal",
    ],
  };
}

function redditMotion(
  evidence: ReadonlyArray<GtmEvidenceCard>
): DistributionMotionVerdict {
  const cards = cardsFor(evidence, "reddit");
  const highRisk = cards.some((card) => card.promotionRisk === "high");
  return {
    motion: "reddit_helpful_reply",
    status: cards.length >= 2 && !highRisk ? "test_now" : "parked",
    rationale:
      cards.length >= 2
        ? ["public pain threads exist", "reply-first motion can create feedback"]
        : ["needs more public pain-thread evidence"],
    risks: highRisk ? ["promotion risk is too high without rule review"] : [],
    evidenceCardIds: ids(cards),
    minimumCadence: "5-10 helpful replies per week",
    stopCriteria: "no qualified replies after two weeks and 15 useful replies",
    doubleDownCriteria: "2+ qualified replies or 1 signup from replies",
  };
}

function xMotion(evidence: ReadonlyArray<GtmEvidenceCard>): DistributionMotionVerdict {
  const cards = cardsFor(evidence, "x");
  return {
    motion: "x_founder_led",
    status: cards.length >= 2 ? "test_now" : "test_later",
    rationale:
      cards.length >= 2
        ? ["founder-led formats exist in the market"]
        : ["needs better X examples before becoming a main motion"],
    risks: ["can create vanity attention without app users"],
    evidenceCardIds: ids(cards),
    minimumCadence: "3 posts and 10 replies per week",
    stopCriteria: "attention without replies/clicks after two weeks",
    doubleDownCriteria: "3+ qualified replies or 2 signups from posts/replies",
  };
}

function linkedinMotion(
  app: { productType: string },
  evidence: ReadonlyArray<GtmEvidenceCard>
): DistributionMotionVerdict {
  const cards = cardsFor(evidence, "linkedin");
  const professional =
    app.productType === "b2b_workflow" || app.productType === "developer_tool";
  return {
    motion: "linkedin_founder_led",
    status: professional && cards.length >= 2 ? "test_now" : "parked",
    rationale: professional
      ? ["professional buyer context can support founder-led posts"]
      : ["not enough professional buyer fit"],
    risks: professional ? [] : ["LinkedIn is likely the wrong first motion"],
    evidenceCardIds: ids(cards),
    minimumCadence: "2 posts and 5 thoughtful comments per week",
    stopCriteria: "no buyer conversations after two weeks",
    doubleDownCriteria: "1 demo request or 3 relevant buyer conversations",
  };
}

function tiktokFacelessMotion(
  app: { productType: string; canRecordScreen: boolean },
  evidence: ReadonlyArray<GtmEvidenceCard>
): DistributionMotionVerdict {
  const cards = cardsFor(evidence, "tiktok");
  const visual =
    app.productType === "consumer_visual" || app.productType === "prosumer";
  return {
    motion: "tiktok_faceless_demo",
    status: visual && app.canRecordScreen && cards.length >= 2 ? "test_now" : "parked",
    rationale:
      visual && app.canRecordScreen
        ? ["app can be shown with screen recordings"]
        : ["faceless demo needs a visual product and screen-recording capacity"],
    risks: ["views can be misleading without install/signup tracking"],
    evidenceCardIds: ids(cards),
    minimumCadence: "3-5 short demo clips per week",
    stopCriteria: "10k+ views without qualified app action",
    doubleDownCriteria: "5+ installs/signups/trials from one format cluster",
  };
}

function tiktokFounderMotion(
  app: { productType: string; canShowFace: boolean },
  evidence: ReadonlyArray<GtmEvidenceCard>
): DistributionMotionVerdict {
  const cards = cardsFor(evidence, "tiktok");
  const visual =
    app.productType === "consumer_visual" || app.productType === "prosumer";
  return {
    motion: "tiktok_founder_talking_head",
    status: visual && app.canShowFace && cards.length >= 2 ? "test_now" : "parked",
    rationale:
      visual && app.canShowFace
        ? ["founder can pair a clear face hook with app demo"]
        : ["founder talking-head needs face comfort and a visual product"],
    risks: ["high founder burden; should not be required if faceless works"],
    evidenceCardIds: ids(cards),
    minimumCadence: "2-3 founder clips per week",
    stopCriteria: "founder burden is too high or no qualified signal",
    doubleDownCriteria: "repeatable comments/signups from founder-led clips",
  };
}

function tiktokSlideshowMotion(
  app: { productType: string; canRecordScreen: boolean },
  evidence: ReadonlyArray<GtmEvidenceCard>
): DistributionMotionVerdict {
  const cards = cardsFor(evidence, "tiktok");
  const visual =
    app.productType === "consumer_visual" || app.productType === "prosumer";
  return {
    motion: "tiktok_slideshow_carousel",
    status: visual && cards.length >= 2 ? "test_now" : "parked",
    rationale: visual
      ? ["app can be explained with screenshots, steps, or before/after slides"]
      : ["slideshow/carousel needs a visual sequence or crisp app story"],
    risks: [
      "slides can get attention without installs if CTA and first screen are weak",
    ],
    evidenceCardIds: ids(cards),
    minimumCadence: "3 slideshow/carousel concepts per week",
    stopCriteria: "saves/views without qualified comments, installs, or trials",
    doubleDownCriteria: "5+ installs/signups/trials from one slide format cluster",
  };
}

function ugcMotion(
  app: { canRecordScreen: boolean; canShowFace: boolean },
  evidence: ReadonlyArray<GtmEvidenceCard>
): DistributionMotionVerdict {
  const cards = cardsFor(evidence, "tiktok").filter(
    (card) => (card.engagement?.views ?? 0) >= 25_000
  );
  const canTest = app.canRecordScreen || app.canShowFace;
  return {
    motion: "ugc_creator_test",
    status: "test_later",
    rationale: canTest
      ? ["test founder/faceless formats before recruiting creators"]
      : ["recording capacity must exist before UGC can scale"],
    risks: ["premature creator recruiting creates cost before a format is proven"],
    evidenceCardIds: ids(cards),
    minimumCadence: "defer until one short-form format wins",
    stopCriteria: "no proven format to train against",
    doubleDownCriteria: "one winning short-form skeleton and clear creator brief",
  };
}

function cardsFor(
  evidence: ReadonlyArray<GtmEvidenceCard>,
  source: GtmEvidenceCard["source"]
): GtmEvidenceCard[] {
  return evidence.filter(
    (card) => card.source === source && card.recommendedUse !== "avoid"
  );
}

function ids(cards: ReadonlyArray<GtmEvidenceCard>): string[] {
  return cards.map((card) => card.id).filter((id): id is string => Boolean(id));
}

function hypothesisFor(
  verdict: DistributionMotionVerdict,
  productName: string
): string {
  return `${productName} can get user signal through ${verdict.motion.replaceAll("_", " ")} because ${verdict.rationale[0] ?? "the motion has evidence"}.`;
}

function successMetricFor(motion: DistributionMotion): ExperimentSuccessMetric {
  if (motion === "ugc_creator_test") return "creator_applicants";
  if (motion.startsWith("tiktok")) return "installs";
  if (motion === "linkedin_founder_led") return "qualified_replies";
  return "signups";
}

function variantsFor(
  motion: DistributionMotion,
  productName: string
): FormatVariant[] {
  if (motion === "tiktok_faceless_demo") {
    return [
      {
        hook: "I built this because the manual version is painful.",
        demoMoment: "show the before screen, then the one-click result",
        cta: "comment if you want to try it",
        formatSkeleton: "pain screen -> app action -> result -> simple CTA",
      },
      {
        hook: "This tiny app replaces the step I kept avoiding.",
        demoMoment: "screen-record the fastest workflow",
        cta: "join the beta from the link",
        formatSkeleton: "confession -> demo -> result -> beta CTA",
      },
    ];
  }
  if (motion === "tiktok_slideshow_carousel") {
    return [
      {
        hook: "The annoying part before this app existed.",
        demoMoment: "slide-by-slide before, action, result, proof",
        cta: "comment if this is your workflow too",
        formatSkeleton: "problem slide -> app screenshot -> result slide -> CTA",
      },
      {
        hook: "3 signs you need this workflow fixed.",
        demoMoment: "use product screenshots as the final two slides",
        cta: "join the beta from the link",
        formatSkeleton: "listicle pain -> product reveal -> beta CTA",
      },
    ];
  }
  if (motion === "reddit_helpful_reply") {
    return [
      {
        hook: "I ran into this too.",
        cta: "ask what they use today before sharing the app",
        formatSkeleton: "validate pain -> useful workaround -> soft research ask",
      },
    ];
  }
  return [
    {
      hook: `I built ${productName} for one narrow reason.`,
      cta: "reply with what you use today",
      formatSkeleton: "specific pain -> why now -> ask for qualified users",
    },
  ];
}
