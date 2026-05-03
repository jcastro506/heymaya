/**
 * maya-service-packet-generator — manager-readiness PDF render.
 *
 * Per § 3 routing matrix: Gemini 3 Flash, HIGH thinking — multi-document
 * synthesis. The skill composes structured packet sections via LLM, then
 * delegates to the Anthropic public `pdf` skill (injected as `pdfRenderer`)
 * for actual PDF generation. The orchestrator persists `pdfBase64` to R2
 * and returns the storage key.
 *
 * Studio-only. Sub-30s render budget enforced upstream by the orchestrator
 * action timeout. The skill itself does not measure wall-clock — it
 * produces the prose + manifest, and the renderer handles the rest.
 *
 * Adversarial: missing-data sections produce explicit
 * "[insufficient data — operator action required]" placeholders rather than
 * silent dropouts. Every section's source count is reported in
 * `citationsManifest` so the firewall can audit.
 */

export interface PacketGeneratorInputs {
  businessId: string;
  businessPicture: unknown;
  metrics90d: {
    jobsCompleted: number;
    revenue: number;
    avgTicket: number;
    reviewVolume: number;
    avgStarRating: number;
    gbpPostsPublished: number;
    leadResponseTimeMedian: number;
  };
  brandVoiceSamples: ReadonlyArray<{ source: string; text: string }>;
  reviewHighlights: ReadonlyArray<{
    stars: number;
    body: string;
    reply: string;
  }>;
  contentCadence: {
    gbpPerWeek: number;
    fbPerWeek: number;
    igPerWeek: number;
  };
  crewNames: ReadonlyArray<string>;
  competitorContext: ReadonlyArray<{
    name: string;
    gbpRating: number;
    cadenceWeekly: number;
  }>;
}

export interface PacketGeneratorOutput {
  pdfBase64: string;
  storageKey: string;
  pageCount: number;
  generatedAt: number;
  citationsManifest: ReadonlyArray<{
    section: string;
    sourceCount: number;
  }>;
}

export interface LlmCaller {
  (prompt: { system: string; user: string }): Promise<string>;
}

export interface PdfRenderResult {
  pdfBase64: string;
  storageKey: string;
  pageCount: number;
}

export interface PdfRenderer {
  (input: {
    businessId: string;
    sections: ReadonlyArray<{ title: string; body: string }>;
    title: string;
    generatedAt: number;
  }): Promise<PdfRenderResult>;
}

const INSUFFICIENT = "[insufficient data — operator action required]";

interface PacketSection {
  title: string;
  body: string;
  sourceCount: number;
}

function metricsSection(
  m: PacketGeneratorInputs["metrics90d"]
): PacketSection {
  if (m.jobsCompleted === 0 && m.revenue === 0) {
    return { title: "90-Day Performance", body: INSUFFICIENT, sourceCount: 0 };
  }
  const lines = [
    `Jobs completed: ${m.jobsCompleted}`,
    `Revenue: $${m.revenue.toLocaleString()}`,
    `Average ticket: $${m.avgTicket.toLocaleString()}`,
    `Reviews collected: ${m.reviewVolume} (avg ${m.avgStarRating.toFixed(1)} stars)`,
    `GBP posts published: ${m.gbpPostsPublished}`,
    `Median lead-response time: ${m.leadResponseTimeMedian} min`,
  ];
  return {
    title: "90-Day Performance",
    body: lines.join("\n"),
    sourceCount: 7,
  };
}

function brandVoiceSection(
  samples: PacketGeneratorInputs["brandVoiceSamples"]
): PacketSection {
  if (samples.length === 0) {
    return { title: "Brand Voice", body: INSUFFICIENT, sourceCount: 0 };
  }
  const top = samples.slice(0, 5);
  const body = top
    .map((s, i) => `${i + 1}. (${s.source}) ${s.text}`)
    .join("\n");
  return { title: "Brand Voice", body, sourceCount: top.length };
}

function reviewSection(
  highlights: PacketGeneratorInputs["reviewHighlights"]
): PacketSection {
  if (highlights.length === 0) {
    return { title: "Review Highlights", body: INSUFFICIENT, sourceCount: 0 };
  }
  const top = highlights.slice(0, 5);
  const body = top
    .map(
      (r) =>
        `★ ${r.stars} — ${r.body}\n  Reply: ${r.reply || "(no reply on file)"}`
    )
    .join("\n\n");
  return { title: "Review Highlights", body, sourceCount: top.length };
}

function cadenceSection(
  c: PacketGeneratorInputs["contentCadence"]
): PacketSection {
  if (c.gbpPerWeek === 0 && c.fbPerWeek === 0 && c.igPerWeek === 0) {
    return { title: "Content Cadence", body: INSUFFICIENT, sourceCount: 0 };
  }
  return {
    title: "Content Cadence",
    body: `GBP: ${c.gbpPerWeek}/week  FB: ${c.fbPerWeek}/week  IG: ${c.igPerWeek}/week`,
    sourceCount: 3,
  };
}

function crewSection(crew: PacketGeneratorInputs["crewNames"]): PacketSection {
  if (crew.length === 0) {
    return { title: "Crew", body: INSUFFICIENT, sourceCount: 0 };
  }
  return {
    title: "Crew",
    body: crew.map((n) => `- ${n}`).join("\n"),
    sourceCount: crew.length,
  };
}

function competitorSection(
  c: PacketGeneratorInputs["competitorContext"]
): PacketSection {
  if (c.length === 0) {
    return {
      title: "Competitor Context",
      body: INSUFFICIENT,
      sourceCount: 0,
    };
  }
  const body = c
    .map(
      (x) =>
        `- ${x.name}: ${x.gbpRating.toFixed(1)} stars, ~${x.cadenceWeekly} posts/wk`
    )
    .join("\n");
  return { title: "Competitor Context", body, sourceCount: c.length };
}

function buildSummaryPrompt(sections: PacketSection[]): {
  system: string;
  user: string;
} {
  const system = [
    "You write a 1-paragraph executive summary for a manager-readiness packet.",
    "",
    "HARD RULES:",
    "1. Use ONLY the data in the sections below. Do not invent numbers, names, or trends.",
    "2. 4-6 sentences. Plain prose. No headers, no markdown.",
    "3. Lead with the strongest signal (most jobs, highest reviews, fastest response, etc.).",
    "4. If most sections are '[insufficient data]', say so honestly: 'Limited data on file — operator should populate X, Y before handoff.'",
  ].join("\n");
  const user = sections
    .map((s) => `## ${s.title}\n${s.body}`)
    .join("\n\n");
  return { system, user };
}

export async function generatePacket(
  inputs: PacketGeneratorInputs,
  callLlm: LlmCaller,
  pdfRenderer: PdfRenderer
): Promise<PacketGeneratorOutput> {
  const sections: PacketSection[] = [
    metricsSection(inputs.metrics90d),
    brandVoiceSection(inputs.brandVoiceSamples),
    reviewSection(inputs.reviewHighlights),
    cadenceSection(inputs.contentCadence),
    crewSection(inputs.crewNames),
    competitorSection(inputs.competitorContext),
  ];

  // Executive summary via LLM. Even if all sections are insufficient, the
  // LLM is asked to produce a brief honest note — never silent.
  const summaryPrompt = buildSummaryPrompt(sections);
  const rawSummary = (await callLlm(summaryPrompt)).trim();
  const summaryBody =
    rawSummary.length > 0
      ? rawSummary
      : "Manager-readiness packet generated from on-file data.";

  const renderSections: { title: string; body: string }[] = [
    { title: "Executive Summary", body: summaryBody },
    ...sections.map((s) => ({ title: s.title, body: s.body })),
  ];

  const generatedAt = Date.now();
  const renderResult = await pdfRenderer({
    businessId: inputs.businessId,
    sections: renderSections,
    title: "Manager-Readiness Packet",
    generatedAt,
  });

  const citationsManifest: { section: string; sourceCount: number }[] = [
    { section: "Executive Summary", sourceCount: sections.length },
    ...sections.map((s) => ({ section: s.title, sourceCount: s.sourceCount })),
  ];

  return {
    pdfBase64: renderResult.pdfBase64,
    storageKey: renderResult.storageKey,
    pageCount: renderResult.pageCount,
    generatedAt,
    citationsManifest,
  };
}

export const SKILL_METADATA = {
  name: "maya-service-packet-generator" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "high" as const,
  planTier: ["studio"] as const,
};

export const __test__ = {
  metricsSection,
  brandVoiceSection,
  reviewSection,
  cadenceSection,
  crewSection,
  competitorSection,
  INSUFFICIENT,
};
