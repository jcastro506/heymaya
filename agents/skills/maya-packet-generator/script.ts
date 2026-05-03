/**
 * maya-packet-generator — assemble the manager-readiness packet content
 * structure, run it through the citation firewall, and hand off to the
 * Anthropic `pdf` skill for the byte-stream render.
 *
 * Sprint 3.5. The skill's job is *content assembly + section authoring*. PDF
 * layout/typography/page-break logic lives in the Anthropic `pdf` skill we
 * delegate to (see agents/skills/maya-platform/skill.md § pdf).
 *
 * Plan-tier gating is enforced server-side via `planFeatures(creator)` at
 * the entry point — Starter creators cannot invoke on-demand; only the
 * quarterly cron is allowed.
 *
 * Citation firewall is mandatory: every prose section's claims are passed
 * with their source row IDs to `maya-citation-firewall`. On failure the
 * section is either rewritten (claim dropped) or downgraded to its
 * structured-table form. Never fabricated.
 */

import type { PlanFeatures } from "../../../convex/lib/planFeatures";

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type TriggeredBy = "on-demand" | "quarterly-cron";

export interface PacketInputs {
  creatorId: string;
  windowDays: number;
  triggeredBy: TriggeredBy;
  planFeatures: PlanFeatures;
  data: PacketData;
}

/**
 * The Convex-resolved data the skill needs. The orchestrating Convex action
 * gathers this; the skill stays pure.
 */
export interface PacketData {
  creatorName: string;
  primaryHandle: string;
  niche: string;
  audience: {
    ageRanges: string[];
    topGeos: string[];
    interestTags: string[];
  };
  voiceFingerprint: string;
  followerCountByPlatform: Array<{ platform: string; count: number }>;
  postingCadence: Array<{ platform: string; postsPerWeek: number }>;
  topPosts: Array<{
    postId: string;
    platform: string;
    hookPattern: string;
    views: number;
    saves: number;
    comments: number;
    mayaAnnotation: string | null;
    captionExcerpt: string;
  }>;
  brandDealHistory: Array<{
    dealId: string;
    brand: string;
    format: string;
    deliverables: string;
    valueUsd: number | null;
    paymentStatus: "signed" | "shooting" | "submitted" | "paid" | "closed";
  }>;
  voiceSamples: Array<{
    postId: string;
    captionExcerpt: string;
  }>;
  goals: string[];
}

export type PacketSectionKind =
  | "cover"
  | "snapshot"
  | "niche-audience"
  | "top-posts"
  | "brand-deals"
  | "voice-samples"
  | "why-hire-me";

export interface PacketSection {
  kind: PacketSectionKind;
  title: string;
  /**
   * Either a structured rows-of-strings table (no LLM in the loop) or a prose
   * block (drafted by `internal-comms`, gated by citation firewall).
   */
  body:
    | { kind: "table"; columns: string[]; rows: string[][] }
    | { kind: "prose"; text: string }
    | { kind: "fields"; fields: Array<{ label: string; value: string }> };
  /** Source row IDs that ground the section's claims — used by the firewall. */
  citations: string[];
  /** True if the section ran through the citation firewall (prose only). */
  firewallChecked: boolean;
}

export interface PacketBundle {
  sections: PacketSection[];
  windowDays: number;
  generatedAt: number;
  triggeredBy: TriggeredBy;
}

export interface PacketRenderHandoff {
  /** What we hand to the Anthropic `pdf` skill for the byte-stream render. */
  pdfSkillInput: {
    title: string;
    sections: PacketSection[];
  };
  /** Convex storage URL the orchestrating action surfaces back to the creator. */
  packetUrl: string;
}

export interface CitationFirewall {
  check(input: {
    text: string;
    citations: string[];
  }): Promise<{ passed: boolean; unsupportedClaims: string[] }>;
}

export interface InternalCommsSkill {
  draftProse(input: {
    outline: string[];
    facts: Array<{ key: string; value: string }>;
    intendedLength: "short" | "medium" | "long";
  }): Promise<string>;
}

/* -------------------------------------------------------------------------- */
/* Plan-tier gating                                                            */
/* -------------------------------------------------------------------------- */

export class PacketPlanGateError extends Error {
  constructor(plan: string, attempted: TriggeredBy) {
    super(
      `maya-packet-generator: plan '${plan}' cannot invoke '${attempted}'. ` +
        `Starter is quarterly-cron only; Pro is quarterly + on-demand; Studio is on-demand any time.`
    );
    this.name = "PacketPlanGateError";
  }
}

/**
 * Fail-closed gate. Mirrors `planFeatures(creator).readinessPacketCadence`.
 */
export function assertPlanAllowsTrigger(
  features: PlanFeatures,
  triggeredBy: TriggeredBy
): void {
  const cadence = features.readinessPacketCadence;
  if (cadence === "none") {
    throw new PacketPlanGateError(features.plan, triggeredBy);
  }
  if (cadence === "quarterly" && triggeredBy === "on-demand") {
    throw new PacketPlanGateError(features.plan, triggeredBy);
  }
  // 'on-demand' cadence allows both. quarterly cadence allows quarterly-cron only.
}

/* -------------------------------------------------------------------------- */
/* Section builders (pure, deterministic given inputs)                         */
/* -------------------------------------------------------------------------- */

function fmtUsd(n: number | null): string {
  if (n === null) return "(not disclosed)";
  return `$${n.toLocaleString("en-US")}`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

export function buildCoverSection(
  data: PacketData,
  windowDays: number,
  generatedAt: number
): PacketSection {
  return {
    kind: "cover",
    title: "Manager-readiness packet",
    body: {
      kind: "fields",
      fields: [
        { label: "Creator", value: data.creatorName },
        { label: "Primary handle", value: data.primaryHandle },
        { label: "Window", value: `${windowDays} days` },
        { label: "Generated", value: new Date(generatedAt).toISOString().slice(0, 10) },
      ],
    },
    citations: [],
    firewallChecked: false,
  };
}

export function buildSnapshotSection(data: PacketData): PacketSection {
  const followerRows = data.followerCountByPlatform
    .slice()
    .sort((a, b) => a.platform.localeCompare(b.platform))
    .map((f) => [f.platform, fmtInt(f.count)]);
  const cadenceRows = data.postingCadence
    .slice()
    .sort((a, b) => a.platform.localeCompare(b.platform))
    .map((c) => [c.platform, `${c.postsPerWeek}/week`]);
  return {
    kind: "snapshot",
    title: "Snapshot",
    body: {
      kind: "table",
      columns: ["Platform", "Followers", "Posting cadence"],
      rows: followerRows.map((row, i) => [
        row[0],
        row[1],
        cadenceRows.find((c) => c[0] === row[0])?.[1] ?? "—",
      ]),
    },
    citations: [],
    firewallChecked: false,
  };
}

export async function buildNicheAudienceSection(
  data: PacketData,
  internalComms: InternalCommsSkill,
  firewall: CitationFirewall
): Promise<PacketSection> {
  const facts = [
    { key: "niche", value: data.niche },
    { key: "ageRanges", value: data.audience.ageRanges.join(", ") },
    { key: "topGeos", value: data.audience.topGeos.join(", ") },
    { key: "interestTags", value: data.audience.interestTags.join(", ") },
  ];
  const draft = await internalComms.draftProse({
    outline: [
      "Open with the niche in one sentence.",
      "Describe the audience's age and geo concentration.",
      "Close with the interest tags that explain why this audience saves and shares.",
    ],
    facts,
    intendedLength: "short",
  });
  // Citations for this section are the creator-picture row + audience block.
  // We surface them as opaque IDs the firewall resolves; in v0 the firewall
  // just verifies that every claim has *some* citation present.
  const citations = ["creatorPicture:niche", "creatorPicture:audience"];
  const verdict = await firewall.check({ text: draft, citations });
  if (!verdict.passed) {
    // Degrade gracefully — emit a fields version that cannot hallucinate.
    return {
      kind: "niche-audience",
      title: "Niche & Audience",
      body: {
        kind: "fields",
        fields: [
          { label: "Niche", value: data.niche },
          { label: "Age", value: data.audience.ageRanges.join(", ") },
          { label: "Top geos", value: data.audience.topGeos.join(", ") },
          { label: "Interest tags", value: data.audience.interestTags.join(", ") },
        ],
      },
      citations,
      firewallChecked: true,
    };
  }
  return {
    kind: "niche-audience",
    title: "Niche & Audience",
    body: { kind: "prose", text: draft },
    citations,
    firewallChecked: true,
  };
}

export function buildTopPostsSection(data: PacketData): PacketSection {
  const top5 = data.topPosts.slice(0, 5);
  const rows = top5.map((p) => [
    p.platform,
    p.hookPattern,
    fmtInt(p.views),
    fmtInt(p.saves),
    fmtInt(p.comments),
  ]);
  return {
    kind: "top-posts",
    title: "Best-performing posts",
    body: {
      kind: "table",
      columns: ["Platform", "Hook pattern", "Views", "Saves", "Comments"],
      rows,
    },
    citations: top5.map((p) => `posts:${p.postId}`),
    firewallChecked: false,
  };
}

export function buildBrandDealsSection(data: PacketData): PacketSection {
  if (data.brandDealHistory.length === 0) {
    return {
      kind: "brand-deals",
      title: "Brand-deal history",
      body: {
        kind: "prose",
        text:
          "No signed brand deals on file in the window. The creator has not " +
          "yet pursued sponsored work, or has pursued it outside the windows " +
          "tracked by Maya.",
      },
      citations: [],
      firewallChecked: false,
    };
  }
  const rows = data.brandDealHistory.map((d) => [
    d.brand,
    d.format,
    d.deliverables,
    fmtUsd(d.valueUsd),
    d.paymentStatus,
  ]);
  return {
    kind: "brand-deals",
    title: "Brand-deal history",
    body: {
      kind: "table",
      columns: ["Brand", "Format", "Deliverables", "Value", "Status"],
      rows,
    },
    citations: data.brandDealHistory.map((d) => `brandDeals:${d.dealId}`),
    firewallChecked: false,
  };
}

export function buildVoiceSamplesSection(data: PacketData): PacketSection {
  const samples = data.voiceSamples.slice(0, 3);
  const rows = samples.map((s) => [s.captionExcerpt]);
  return {
    kind: "voice-samples",
    title: "Voice samples",
    body: {
      kind: "table",
      columns: ["Caption excerpt"],
      rows,
    },
    citations: samples.map((s) => `posts:${s.postId}`),
    firewallChecked: false,
  };
}

export async function buildWhyHireMeSection(
  data: PacketData,
  internalComms: InternalCommsSkill,
  firewall: CitationFirewall
): Promise<PacketSection> {
  const totalFollowers = data.followerCountByPlatform.reduce(
    (a, b) => a + b.count,
    0
  );
  const facts = [
    { key: "totalFollowers", value: fmtInt(totalFollowers) },
    { key: "niche", value: data.niche },
    { key: "platformMix", value: data.followerCountByPlatform.map((f) => f.platform).join(", ") },
    { key: "dealCount", value: String(data.brandDealHistory.length) },
    { key: "goals", value: data.goals.join("; ") || "(none stated)" },
  ];
  const draft = await internalComms.draftProse({
    outline: [
      "Lead with the audience scale and platform mix.",
      "Name the niche and what the creator's voice does well in it.",
      "Cite the brand-deal posture (count + recent activity).",
      "Close with the creator's stated goals so the manager knows what they're hiring for.",
    ],
    facts,
    intendedLength: "medium",
  });
  const citations = [
    "creatorPicture:niche",
    "creatorPicture:audience",
    ...data.brandDealHistory.map((d) => `brandDeals:${d.dealId}`),
    "soul:goals",
  ];
  const verdict = await firewall.check({ text: draft, citations });
  if (!verdict.passed) {
    // Degrade to a structured fields block.
    return {
      kind: "why-hire-me",
      title: "Why hire me",
      body: {
        kind: "fields",
        fields: [
          { label: "Total followers", value: fmtInt(totalFollowers) },
          { label: "Niche", value: data.niche },
          { label: "Brand deals on file", value: String(data.brandDealHistory.length) },
          { label: "Goals", value: data.goals.join("; ") || "(none stated)" },
        ],
      },
      citations,
      firewallChecked: true,
    };
  }
  return {
    kind: "why-hire-me",
    title: "Why hire me",
    body: { kind: "prose", text: draft },
    citations,
    firewallChecked: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Top-level assembler                                                          */
/* -------------------------------------------------------------------------- */

export interface AssembleDeps {
  internalComms: InternalCommsSkill;
  firewall: CitationFirewall;
  now: number;
}

/**
 * Assemble the packet content. Pure given deps + inputs. Plan-tier check is
 * the first thing that happens — fail-closed.
 *
 * The caller (a Convex action) then hands `pdfSkillInput` to the Anthropic
 * `pdf` skill and stores the resulting URL on a `packetGenerations` row
 * (Sprint 4 schema dependency — see SKILL.md).
 */
export async function assemblePacket(
  inputs: PacketInputs,
  deps: AssembleDeps
): Promise<PacketBundle> {
  assertPlanAllowsTrigger(inputs.planFeatures, inputs.triggeredBy);

  if (inputs.windowDays < 1 || inputs.windowDays > 365) {
    throw new Error(
      `maya-packet-generator: windowDays must be between 1 and 365, got ${inputs.windowDays}`
    );
  }

  const sections: PacketSection[] = [];
  sections.push(buildCoverSection(inputs.data, inputs.windowDays, deps.now));
  sections.push(buildSnapshotSection(inputs.data));
  sections.push(
    await buildNicheAudienceSection(inputs.data, deps.internalComms, deps.firewall)
  );
  sections.push(buildTopPostsSection(inputs.data));
  sections.push(buildBrandDealsSection(inputs.data));
  sections.push(buildVoiceSamplesSection(inputs.data));
  sections.push(
    await buildWhyHireMeSection(inputs.data, deps.internalComms, deps.firewall)
  );

  return {
    sections,
    windowDays: inputs.windowDays,
    generatedAt: deps.now,
    triggeredBy: inputs.triggeredBy,
  };
}

/**
 * Hand-off to the Anthropic `pdf` skill. The orchestrating Convex action
 * supplies `packetUrl` after writing the rendered bytes to Convex storage.
 */
export function buildPdfHandoff(
  bundle: PacketBundle,
  packetUrl: string,
  data: PacketData
): PacketRenderHandoff {
  return {
    pdfSkillInput: {
      title: `Manager-readiness packet — ${data.creatorName}`,
      sections: bundle.sections,
    },
    packetUrl,
  };
}
