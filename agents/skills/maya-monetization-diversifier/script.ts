/**
 * maya-monetization-diversifier — pure-logic helpers.
 *
 * Sprint 3.5b. The Convex action that wires the model router + citation
 * firewall + monetizationProposalLog write lives in
 * `convex/agents/skills/monetizationDiversifier.ts` (lead pushes). This
 * module is the pure logic the action composes:
 *
 *   - `NICHE_PLAYBOOKS`: the per-niche milestone-anchored stream map
 *   - `selectPlaybookEntry`: pick the right tier given followerCount
 *   - `filterAlreadyActive`: drop streams the creator already has
 *   - `enforceEmailListProposal`: always include email-list (or acknowledge already-active)
 *   - `synthesisPrompt`: build the high-thinking prompt for the why/firstSteps/etc.
 *   - `parseProposalsOutput`: tolerant JSON parser, never throws
 *
 * Stage-aware adaptive product (Agent B, 2026-04-26): `synthesisPrompt`
 * accepts an optional `growthPlan` and appends a focusAreas/antiPatterns
 * suffix. The orchestrator should call
 * `assertSkillRespectsGrowthPlan("monetization-diversifier", growthPlan)`
 * upstream — when blocked (e.g. just-starting creators with "don't diversify
 * yet" in antiPatterns), the skill is not invoked at all.
 *
 * No Convex imports. No network. Pure TypeScript.
 */
import {
  growthPlanPromptSuffix,
  routeViaGrowthPlan,
  type GrowthPlanForSkill,
} from "../maya-platform/growthPlanGuard";

export type RevenueStream =
  | "brand-deals"
  | "affiliate"
  | "merch"
  | "courses"
  | "subs"
  | "ad-rev"
  | "email-list"
  | "live-events"
  | "consulting";

export type RevenueTrend = "growing" | "flat" | "shrinking";

export type StallTrigger =
  | "milestone-10k"
  | "milestone-50k"
  | "milestone-100k"
  | "milestone-500k"
  | "revenue-flat-90d"
  | "on-demand";

export type EffortToLaunch = "days" | "weeks" | "months";

export interface CreatorPictureSubset {
  readonly followerCount: number;
  readonly niche: string;
  readonly monthlyRevenueUsd: number;
  readonly currentRevenueStreams: ReadonlyArray<RevenueStream>;
}

export interface MonetizationInput {
  readonly creatorPicture: CreatorPictureSubset;
  readonly recentRevenueTrend: RevenueTrend;
  readonly stallTrigger?: StallTrigger;
}

export interface RevenueRange {
  readonly low: number;
  readonly high: number;
}

export interface Proposal {
  readonly stream: RevenueStream;
  readonly why: string;
  readonly expectedAddedRevenueRange: RevenueRange;
  readonly effortToLaunch: EffortToLaunch;
  readonly firstSteps: ReadonlyArray<string>;
  readonly comparableCreators: ReadonlyArray<string>;
}

export interface MonetizationCitation {
  readonly kind: "metric" | "peer";
  readonly id: string;
  readonly fact: string;
}

export interface MonetizationOutput {
  readonly proposals: ReadonlyArray<Proposal>;
  readonly antiPatterns: ReadonlyArray<string>;
  readonly citations: ReadonlyArray<MonetizationCitation>;
}

/* -------------------------------------------------------------------------- */
/* Per-niche playbook                                                          */
/* -------------------------------------------------------------------------- */

export type Milestone = "10k" | "50k" | "100k" | "500k";

export interface PlaybookEntry {
  readonly milestone: Milestone;
  readonly recommendedStreams: ReadonlyArray<RevenueStream>;
  readonly examplePartners: ReadonlyArray<string>;
  readonly note: string;
}

export interface NichePlaybook {
  readonly niche: string;
  readonly entries: ReadonlyArray<PlaybookEntry>;
  readonly antiPatterns: ReadonlyArray<string>;
}

export const NICHE_PLAYBOOKS: ReadonlyArray<NichePlaybook> = [
  {
    niche: "fitness",
    entries: [
      {
        milestone: "10k",
        recommendedStreams: ["affiliate"],
        examplePartners: ["Gymshark", "MyProtein", "Bandwidth"],
        note: "Affiliate codes are zero-capital — earn while you build the muscle for paid deals.",
      },
      {
        milestone: "50k",
        recommendedStreams: ["merch", "email-list"],
        examplePartners: ["Bonfire", "Printful"],
        note: "Lean launch: 1 hoodie + 1 shaker bottle. Keep inventory tiny; convert email-list signups before the broader audience.",
      },
      {
        milestone: "100k",
        recommendedStreams: ["courses", "subs"],
        examplePartners: ["Teachable", "Skool"],
        note: "Custom training program or subscription-based plans — your audience trusts you on the science by now.",
      },
      {
        milestone: "500k",
        recommendedStreams: ["live-events", "consulting"],
        examplePartners: [],
        note: "Live events and 1-on-1 coaching at this tier — high-margin per hour, builds parasocial moat.",
      },
    ],
    antiPatterns: [
      "Don't launch supplements at <50K followers — supply chain + FDA risk + capital all eat margin pre-scale.",
      "Don't skip email list to 'just focus on Reels' — when the algo shifts, your $0 affiliate month is the wake-up call.",
    ],
  },
  {
    niche: "beauty",
    entries: [
      {
        milestone: "10k",
        recommendedStreams: ["affiliate"],
        examplePartners: ["Sephora Squad", "Ulta", "ShopMy"],
        note: "Affiliate is the bridge — every brand watches your codes and builds a paid pitch around them.",
      },
      {
        milestone: "50k",
        recommendedStreams: ["merch", "email-list"],
        examplePartners: ["Printful"],
        note: "Branded merch — lip kit or brush set, ship via fulfillment partner so you don't own inventory.",
      },
      {
        milestone: "100k",
        recommendedStreams: ["courses"],
        examplePartners: [],
        note: "Your own product line — multi-quarter ramp, manufacturer collab, expect 6-12 months pre-launch.",
      },
      {
        milestone: "500k",
        recommendedStreams: ["live-events"],
        examplePartners: [],
        note: "In-person masterclasses + tour stops; the parasocial premium is highest in beauty.",
      },
    ],
    antiPatterns: [
      "Don't drop your own line at <100K — the production + photography + launch budget will outrun your audience trust.",
    ],
  },
  {
    niche: "finance",
    entries: [
      {
        milestone: "10k",
        recommendedStreams: ["affiliate"],
        examplePartners: ["Robinhood", "M1 Finance", "Webull"],
        note: "Broker referrals pay well per signup — but disclose every link clearly (compliance is your moat).",
      },
      {
        milestone: "50k",
        recommendedStreams: ["courses", "email-list"],
        examplePartners: ["Teachable", "Substack"],
        note: "Email list is non-negotiable in finance — algo and compliance risk on every platform is high; own your channel.",
      },
      {
        milestone: "100k",
        recommendedStreams: ["subs"],
        examplePartners: ["Substack", "Patreon"],
        note: "Paid newsletter or paid community — recurring revenue with high LTV in finance.",
      },
      {
        milestone: "500k",
        recommendedStreams: ["consulting"],
        examplePartners: [],
        note: "Premium 1-on-1 advisory or speaking — at this tier the brand is bigger than the platform.",
      },
    ],
    antiPatterns: [
      "Don't promise specific returns — that's a SEC violation; every claim must be hedged + disclaimed.",
      "Don't run merch in finance — the audience didn't show up for hoodies; they showed up for signal.",
    ],
  },
  {
    niche: "lifestyle",
    entries: [
      {
        milestone: "10k",
        recommendedStreams: ["affiliate"],
        examplePartners: ["Amazon Associates", "ShopMy", "LTK"],
        note: "Amazon storefront + ShopMy — broad SKU range matches the broad lifestyle audience.",
      },
      {
        milestone: "50k",
        recommendedStreams: ["merch", "email-list"],
        examplePartners: ["Printful"],
        note: "Apparel + 1 lifestyle item (mug, candle, tote) — owned-product margin starts compounding here.",
      },
      {
        milestone: "100k",
        recommendedStreams: ["subs", "brand-deals"],
        examplePartners: ["Substack"],
        note: "Paid Substack + ambassador-level brand deals — long-term retainer beats one-off pitches.",
      },
      {
        milestone: "500k",
        recommendedStreams: ["live-events"],
        examplePartners: [],
        note: "Lifestyle conferences, retreats — high-touch IRL events compound brand value.",
      },
    ],
    antiPatterns: [
      "Don't try a course at <50K in lifestyle — the niche is too broad; your audience is here for vibes, not modules.",
    ],
  },
  {
    niche: "gaming",
    entries: [
      {
        milestone: "10k",
        recommendedStreams: ["subs"],
        examplePartners: ["Twitch Subs", "YouTube Memberships", "Patreon"],
        note: "Subscription / membership is the gaming-native monetization — your most-engaged 1% pays your bills.",
      },
      {
        milestone: "50k",
        recommendedStreams: ["merch"],
        examplePartners: ["Bonfire", "Streamlabs Merch"],
        note: "Apparel + a peripheral collab (mousepad, deskmat) — gaming audiences buy gear that signals identity.",
      },
      {
        milestone: "100k",
        recommendedStreams: ["brand-deals"],
        examplePartners: [],
        note: "Brand partnerships at scale — esports orgs, peripheral brands, energy drinks (high CPM in gaming).",
      },
      {
        milestone: "500k",
        recommendedStreams: ["live-events"],
        examplePartners: [],
        note: "Tournaments, IRL meetups, conventions — gaming converts parasocial to IRL exceptionally well.",
      },
    ],
    antiPatterns: [
      "Don't burn your audience with too-frequent paid promotions — gaming subs detect insincerity faster than other niches.",
    ],
  },
  {
    niche: "education",
    entries: [
      {
        milestone: "10k",
        recommendedStreams: ["courses"],
        examplePartners: ["Skillshare", "Teachable", "Udemy"],
        note: "Education + courses are native — your audience is here to learn, so they pay to learn deeper.",
      },
      {
        milestone: "50k",
        recommendedStreams: ["subs", "email-list"],
        examplePartners: ["Discord", "Circle", "Skool"],
        note: "Paid community — recurring revenue + the community itself becomes your retention moat.",
      },
      {
        milestone: "100k",
        recommendedStreams: ["live-events"],
        examplePartners: [],
        note: "Certifications + cohort programs — premium pricing for synchronous learning.",
      },
      {
        milestone: "500k",
        recommendedStreams: ["consulting"],
        examplePartners: [],
        note: "Enterprise / institutional partnerships — the 'I learned from X on YouTube' candidate becomes the candidate enterprises hire.",
      },
    ],
    antiPatterns: [
      "Don't drop free content quality when you launch the paid course — the funnel only works if free is best-in-class.",
    ],
  },
];

export const GENERIC_PLAYBOOK: NichePlaybook = {
  niche: "general",
  entries: [
    {
      milestone: "10k",
      recommendedStreams: ["affiliate"],
      examplePartners: ["Amazon Associates"],
      note: "Affiliate is universal — start with an Amazon storefront in your niche; layer specialty programs as you find them.",
    },
    {
      milestone: "50k",
      recommendedStreams: ["email-list", "merch"],
      examplePartners: ["Printful", "ConvertKit"],
      note: "Email list + 1 niche-appropriate merch SKU — own the audience, ship a single hero product.",
    },
    {
      milestone: "100k",
      recommendedStreams: ["courses", "subs"],
      examplePartners: ["Teachable", "Substack"],
      note: "Course or subscription, whichever your audience signals stronger demand for (poll them).",
    },
    {
      milestone: "500k",
      recommendedStreams: ["live-events", "consulting"],
      examplePartners: [],
      note: "Live events + premium 1-on-1 — the brand is bigger than the platform at this scale.",
    },
  ],
  antiPatterns: [
    "Don't bet the farm on one stream — diversification is the whole point.",
    "Don't skip email list — every successful creator who skipped it regretted it during an algorithm shift.",
  ],
};

/* -------------------------------------------------------------------------- */
/* Selection logic                                                             */
/* -------------------------------------------------------------------------- */

export function getPlaybookForNiche(niche: string): NichePlaybook {
  const key = niche.trim().toLowerCase();
  const match = NICHE_PLAYBOOKS.find((p) => p.niche === key);
  return match ?? GENERIC_PLAYBOOK;
}

export function milestoneForFollowerCount(n: number): Milestone {
  if (n < 50_000) return "10k";
  if (n < 100_000) return "50k";
  if (n < 500_000) return "100k";
  return "500k";
}

export function selectPlaybookEntry(
  playbook: NichePlaybook,
  milestone: Milestone
): PlaybookEntry {
  const e = playbook.entries.find((x) => x.milestone === milestone);
  if (e) return e;
  // Defensive — should always find one but fallback to first.
  return playbook.entries[0];
}

/**
 * Drop streams the creator already runs. Returns a non-empty list when at
 * least one recommended stream is novel; otherwise returns empty (caller
 * decides whether to escalate to next milestone or just acknowledge no
 * gap exists).
 */
export function filterAlreadyActive(
  recommended: ReadonlyArray<RevenueStream>,
  active: ReadonlyArray<RevenueStream>
): RevenueStream[] {
  const activeSet = new Set(active);
  return recommended.filter((s) => !activeSet.has(s));
}

/**
 * Enforce the universal rule: if `email-list` is not currently active and
 * not already in the proposal-streams list, prepend it. Returns the
 * augmented list and whether email-list was added.
 */
export function enforceEmailListProposal(
  proposalStreams: ReadonlyArray<RevenueStream>,
  active: ReadonlyArray<RevenueStream>
): { streams: RevenueStream[]; addedEmailList: boolean } {
  if (active.includes("email-list")) {
    return { streams: proposalStreams.slice(), addedEmailList: false };
  }
  if (proposalStreams.includes("email-list")) {
    return { streams: proposalStreams.slice(), addedEmailList: false };
  }
  return {
    streams: ["email-list", ...proposalStreams],
    addedEmailList: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Synthesis prompt                                                            */
/* -------------------------------------------------------------------------- */

export function synthesisPrompt(args: {
  readonly creatorPicture: CreatorPictureSubset;
  readonly trigger: StallTrigger;
  readonly trend: RevenueTrend;
  readonly milestone: Milestone;
  readonly playbookEntry: PlaybookEntry;
  readonly proposalStreams: ReadonlyArray<RevenueStream>;
  readonly studioPeerHints: boolean;
  /** Stage-aware growth plan from creatorPicture.growthPlan. Optional. */
  readonly growthPlan?: GrowthPlanForSkill | null;
}): string {
  const lines: string[] = [];
  lines.push("You are Maya, a creator's AI manager. Produce monetization PROPOSALS.");
  lines.push(`Creator niche: ${args.creatorPicture.niche}`);
  lines.push(`Follower count: ${args.creatorPicture.followerCount.toLocaleString()}`);
  lines.push(`Monthly revenue: $${args.creatorPicture.monthlyRevenueUsd.toLocaleString()}`);
  lines.push(`Current streams: ${args.creatorPicture.currentRevenueStreams.join(", ") || "(none)"}`);
  lines.push(`Recent revenue trend: ${args.trend}`);
  lines.push(`Trigger: ${args.trigger}`);
  lines.push(`Size milestone: ${args.milestone}`);
  lines.push(
    `Playbook recommendation at this tier: ${args.playbookEntry.recommendedStreams.join(", ")}.`
  );
  lines.push(`Playbook note: ${args.playbookEntry.note}`);
  if (args.playbookEntry.examplePartners.length > 0) {
    lines.push(`Suggested partners: ${args.playbookEntry.examplePartners.join(", ")}`);
  }
  lines.push("");
  lines.push(`Generate proposals for these streams in order: ${args.proposalStreams.join(", ")}.`);
  lines.push("");
  lines.push("Output STRICTLY JSON matching:");
  lines.push("{");
  lines.push('  "proposals": [{');
  lines.push('    "stream": one of the streams above,');
  lines.push('    "why": string (1-2 sentences citing the playbook + the creator size),');
  lines.push('    "expectedAddedRevenueRange": { "low": number, "high": number },  // USD/month');
  lines.push('    "effortToLaunch": "days" | "weeks" | "months",');
  lines.push('    "firstSteps": string[3..5],');
  lines.push(
    args.studioPeerHints
      ? '    "comparableCreators": string[1..3]  // named peer examples (Studio)'
      : '    "comparableCreators": string[]  // empty or 1 anonymized peer (Pro)'
  );
  lines.push("  }],");
  lines.push('  "antiPatterns": string[]  // 0-3 patterns to avoid');
  lines.push("}");
  lines.push("");
  lines.push("Rules:");
  lines.push("- Every `why` must reference the playbook tier OR the creator's current size — no fabrication.");
  lines.push("- `expectedAddedRevenueRange` is an honest band, never a single point. Width must be at least 2x the low end.");
  lines.push("- Do NOT promise dollar amounts beyond ranges. Do NOT promise specific outcomes.");
  lines.push("- `firstSteps` are concrete, executable this week / month — not abstract advice.");
  // Wave 2 — when the growth plan flags monetization-diversification as an
  // antiPattern at this stage, route to the matched smartAlternative (e.g.
  // "pick ONE beachhead and prove it" + a concrete ebook outline action) and
  // frame the proposals as the alternative's exampleAction. The prompt-suffix
  // carries the route directive; the LLM rephrases its output accordingly.
  const route = routeViaGrowthPlan("monetization-diversifier", args.growthPlan);
  const stageSuffix = growthPlanPromptSuffix(args.growthPlan, {
    smartAlternative: route.smartAlternative,
  });
  if (stageSuffix.length > 0) lines.push(stageSuffix);
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Tolerant JSON parser                                                        */
/* -------------------------------------------------------------------------- */

const VALID_STREAMS: ReadonlyArray<RevenueStream> = [
  "brand-deals",
  "affiliate",
  "merch",
  "courses",
  "subs",
  "ad-rev",
  "email-list",
  "live-events",
  "consulting",
];

const VALID_EFFORT: ReadonlyArray<EffortToLaunch> = ["days", "weeks", "months"];

export function parseProposalsOutput(raw: string): {
  proposals: Proposal[];
  antiPatterns: string[];
} {
  let body = raw.trim();
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { proposals: [], antiPatterns: [] };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { proposals: [], antiPatterns: [] };
  }
  const obj = parsed as { proposals?: unknown; antiPatterns?: unknown };

  const proposals: Proposal[] = [];
  if (Array.isArray(obj.proposals)) {
    for (const p of obj.proposals) {
      if (!isProposal(p)) continue;
      proposals.push(p);
    }
  }

  const antiPatterns: string[] = [];
  if (Array.isArray(obj.antiPatterns)) {
    for (const a of obj.antiPatterns) {
      if (typeof a === "string" && a.trim().length > 0) antiPatterns.push(a);
    }
  }

  return { proposals, antiPatterns };
}

function isProposal(x: unknown): x is Proposal {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Partial<Proposal>;
  if (typeof p.stream !== "string") return false;
  if (!VALID_STREAMS.includes(p.stream as RevenueStream)) return false;
  if (typeof p.why !== "string" || p.why.trim().length === 0) return false;
  if (typeof p.effortToLaunch !== "string") return false;
  if (!VALID_EFFORT.includes(p.effortToLaunch as EffortToLaunch)) return false;
  if (
    typeof p.expectedAddedRevenueRange !== "object" ||
    p.expectedAddedRevenueRange === null
  ) {
    return false;
  }
  const r = p.expectedAddedRevenueRange as Partial<RevenueRange>;
  if (typeof r.low !== "number" || typeof r.high !== "number") return false;
  if (r.low < 0 || r.high < r.low) return false;
  if (!Array.isArray(p.firstSteps)) return false;
  if (p.firstSteps.some((s) => typeof s !== "string")) return false;
  if (!Array.isArray(p.comparableCreators)) return false;
  if (p.comparableCreators.some((s) => typeof s !== "string")) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Citation builder for the playbook + size + trigger                          */
/* -------------------------------------------------------------------------- */

export function buildCitations(args: {
  readonly creatorPicture: CreatorPictureSubset;
  readonly milestone: Milestone;
  readonly trigger: StallTrigger;
  readonly playbook: NichePlaybook;
}): MonetizationCitation[] {
  return [
    {
      kind: "metric",
      id: "follower-count",
      fact: `Follower count is ${args.creatorPicture.followerCount.toLocaleString()} — milestone bucket ${args.milestone}.`,
    },
    {
      kind: "metric",
      id: "monthly-revenue",
      fact: `Monthly revenue is $${args.creatorPicture.monthlyRevenueUsd.toLocaleString()}.`,
    },
    {
      kind: "metric",
      id: `playbook-${args.playbook.niche}-${args.milestone}`,
      fact: `Playbook for ${args.playbook.niche} at ${args.milestone}: ${selectPlaybookEntry(args.playbook, args.milestone).note}`,
    },
    {
      kind: "metric",
      id: `trigger-${args.trigger}`,
      fact: `Trigger event: ${args.trigger}.`,
    },
  ];
}
