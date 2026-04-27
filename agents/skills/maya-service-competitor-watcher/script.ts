/**
 * maya-service-competitor-watcher — weekly competitor diff + digest.
 *
 * Per § 3 routing matrix: Gemini 3.1 Flash Lite, LOW thinking — routine
 * classification. Diff logic is rule-based + deterministic; the LLM call is
 * a thin wrapper that prosifies the flag list into a 60-120 word digest.
 *
 * Sweep diffing rules (per SKILL.md):
 *   - rating delta >= 0.2 (drop or rise)
 *   - review-count surge: current > last * 1.25 (and current >= last + 5)
 *   - new visible offer / promo
 *   - cadence-spike: lastPostAt within current sweep but null in previous
 *   - suspended: dropped from digest with note
 */

export interface CompetitorSnapshot {
  gbpPlaceId: string;
  rating: number;
  reviewCount: number;
  lastPostAt: number | null;
  visibleOffers: ReadonlyArray<string>;
  suspended?: boolean;
}

export interface CompetitorWatcherInputs {
  namedCompetitors: ReadonlyArray<{
    name: string;
    gbpPlaceId: string;
    reputationalNote?: string;
  }>;
  lastSweep: {
    sweepAt: number;
    competitorSnapshots: ReadonlyArray<CompetitorSnapshot>;
  };
  currentSweep: {
    sweepAt: number;
    competitorSnapshots: ReadonlyArray<CompetitorSnapshot>;
  };
}

export type CompetitorFlagKind =
  | "rating-drop"
  | "rating-rise"
  | "new-promo"
  | "cadence-spike"
  | "suspended"
  | "no-change";

export interface CompetitorWatcherOutput {
  digestProse: string;
  flags: ReadonlyArray<{
    competitorName: string;
    kind: CompetitorFlagKind;
    delta: string;
  }>;
  citationManifest: ReadonlyArray<{
    gbpPlaceId: string;
    sweepRef: "last" | "current";
  }>;
}

export interface LlmCaller {
  (prompt: { system: string; user: string }): Promise<string>;
}

const RATING_DELTA_THRESHOLD = 0.2;
const REVIEW_SURGE_MULTIPLIER = 1.25;
const REVIEW_SURGE_MIN_DELTA = 5;

function findSnapshot(
  snaps: ReadonlyArray<CompetitorSnapshot>,
  placeId: string
): CompetitorSnapshot | null {
  return snaps.find((s) => s.gbpPlaceId === placeId) ?? null;
}

function diffOne(
  competitorName: string,
  prev: CompetitorSnapshot | null,
  curr: CompetitorSnapshot | null
): { kind: CompetitorFlagKind; delta: string }[] {
  const flags: { kind: CompetitorFlagKind; delta: string }[] = [];

  if (curr?.suspended) {
    flags.push({
      kind: "suspended",
      delta: `${competitorName} GBP listing suspended; dropping from digest until restored.`,
    });
    return flags;
  }
  if (!prev || !curr) {
    return [{ kind: "no-change", delta: "no comparable sweep data" }];
  }

  const ratingDelta = curr.rating - prev.rating;
  if (ratingDelta <= -RATING_DELTA_THRESHOLD) {
    flags.push({
      kind: "rating-drop",
      delta: `${competitorName} rating ${prev.rating.toFixed(1)} → ${curr.rating.toFixed(1)} (${ratingDelta.toFixed(1)})`,
    });
  } else if (ratingDelta >= RATING_DELTA_THRESHOLD) {
    flags.push({
      kind: "rating-rise",
      delta: `${competitorName} rating ${prev.rating.toFixed(1)} → ${curr.rating.toFixed(1)} (+${ratingDelta.toFixed(1)})`,
    });
  }

  if (
    curr.reviewCount > prev.reviewCount * REVIEW_SURGE_MULTIPLIER &&
    curr.reviewCount - prev.reviewCount >= REVIEW_SURGE_MIN_DELTA
  ) {
    flags.push({
      kind: "cadence-spike",
      delta: `${competitorName} review count ${prev.reviewCount} → ${curr.reviewCount} (+${curr.reviewCount - prev.reviewCount})`,
    });
  }

  // New visible offers — set difference.
  const prevOffers = new Set(prev.visibleOffers.map((o) => o.toLowerCase()));
  const newOffers = curr.visibleOffers.filter(
    (o) => !prevOffers.has(o.toLowerCase())
  );
  for (const offer of newOffers) {
    flags.push({
      kind: "new-promo",
      delta: `${competitorName}: new promo — ${offer}`,
    });
  }

  // Posting cadence: previously inactive, now posting.
  if (prev.lastPostAt === null && curr.lastPostAt !== null) {
    flags.push({
      kind: "cadence-spike",
      delta: `${competitorName} resumed GBP posting cadence`,
    });
  }

  if (flags.length === 0) {
    flags.push({ kind: "no-change", delta: `${competitorName}: no movement` });
  }
  return flags;
}

function buildDigestPrompt(
  flags: { competitorName: string; kind: CompetitorFlagKind; delta: string }[]
): { system: string; user: string } {
  const significant = flags.filter((f) => f.kind !== "no-change");
  const system = [
    "You write a 60-120 word weekly competitor digest for a service-business operator.",
    "",
    "HARD RULES:",
    "1. Cite only the flags below — do not invent activity, ratings, or promos.",
    "2. Lead with the most significant change; bury 'no-change' competitors at the end or omit.",
    "3. Tone: brief, direct, no AI pleasantries.",
    "4. If only 'no-change' flags, return: 'Quiet week on the competitor front — no rating moves, no new promos.'",
    "5. Output plain prose only — no headers, no markdown.",
  ].join("\n");
  const user = [
    "Flags this week:",
    ...flags.map((f) => `- [${f.kind}] ${f.delta}`),
    "",
    `Significant flag count: ${significant.length}`,
  ].join("\n");
  return { system, user };
}

export async function watchCompetitors(
  inputs: CompetitorWatcherInputs,
  callLlm?: LlmCaller
): Promise<CompetitorWatcherOutput> {
  const flags: { competitorName: string; kind: CompetitorFlagKind; delta: string }[] = [];
  const citationManifest: { gbpPlaceId: string; sweepRef: "last" | "current" }[] = [];

  for (const comp of inputs.namedCompetitors) {
    const prev = findSnapshot(inputs.lastSweep.competitorSnapshots, comp.gbpPlaceId);
    const curr = findSnapshot(
      inputs.currentSweep.competitorSnapshots,
      comp.gbpPlaceId
    );
    if (prev) {
      citationManifest.push({ gbpPlaceId: comp.gbpPlaceId, sweepRef: "last" });
    }
    if (curr) {
      citationManifest.push({
        gbpPlaceId: comp.gbpPlaceId,
        sweepRef: "current",
      });
    }
    const compFlags = diffOne(comp.name, prev, curr);
    for (const f of compFlags) {
      flags.push({ competitorName: comp.name, ...f });
    }
  }

  // Build the digest. If no LLM provided (rule-only path), produce a plain
  // bullet summary; otherwise call Flash Lite for prosification.
  let digestProse: string;
  const significant = flags.filter((f) => f.kind !== "no-change");
  if (callLlm) {
    const prompt = buildDigestPrompt(flags);
    const raw = await callLlm(prompt);
    digestProse = raw.trim();
    if (digestProse.length === 0) {
      digestProse = bulletFallback(flags);
    }
  } else {
    digestProse = bulletFallback(flags);
  }

  // Citation firewall: every name + delta cited in `flags` must come from the
  // input. Fact-check by ensuring every flag's competitorName matches an
  // input namedCompetitors entry.
  const allowedNames = new Set(inputs.namedCompetitors.map((c) => c.name));
  for (const f of flags) {
    if (!allowedNames.has(f.competitorName)) {
      throw new Error(
        `competitor-watcher: flag references competitor '${f.competitorName}' not in input list`
      );
    }
  }

  return {
    digestProse,
    flags,
    citationManifest,
  };

  function bulletFallback(
    fs: ReadonlyArray<{
      competitorName: string;
      kind: CompetitorFlagKind;
      delta: string;
    }>
  ): string {
    if (significant.length === 0) {
      return "Quiet week on the competitor front — no rating moves, no new promos.";
    }
    return significant.map((f) => `- ${f.delta}`).join("\n");
  }
}

export const SKILL_METADATA = {
  name: "maya-service-competitor-watcher" as const,
  modelTarget: "gemini-3.1-flash-lite" as const,
  thinkingBudget: "low" as const,
  planTier: ["pro", "studio"] as const,
};

export const __test__ = { diffOne, buildDigestPrompt };
