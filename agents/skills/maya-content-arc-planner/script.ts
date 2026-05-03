/**
 * maya-content-arc-planner — multi-day content arc generator.
 *
 * Sprint 3.5. Two arc shapes:
 *   - "build-up-day-of-recap" — when seedEvent is a calendar life-event
 *   - "flexible-theme"        — when seed is a theme string
 *
 * The skill is deterministic in structure (which platforms / formats appear
 * on which dayOffsets) and LLM-creative only in the hook + caption drafting.
 * That separation keeps the day grid testable and the creative output
 * reviewable.
 *
 * Plan-tier behavior is encoded in `maxPlatformVariantsPerDay` — the skill
 * trims platform variants per day to that cap. The actual planFeatures
 * lookup happens at the orchestrating-action layer.
 *
 * Stage-aware adaptive product (Agent B, 2026-04-26): the orchestrator
 * (convex/agents/skills/contentArcPlanner.ts) MUST call
 * `assertSkillRespectsGrowthPlan("content-arc-planner", growthPlan)` BEFORE
 * generating a multi-day arc. For just-starting creators with "complex
 * content arcs" in antiPatterns, the orchestrator falls back to a single-day
 * suggestion instead of running this generator. We don't embed the guard
 * inside the deterministic planner because there's no LLM prompt to suffix
 * here — the gate is upstream-only.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type Platform = "tiktok" | "instagram" | "youtube" | "linkedin" | "x";

export type PostFormat =
  | "tiktok-post"
  | "ig-reel"
  | "ig-carousel"
  | "yt-short"
  | "yt-long"
  | "linkedin-post"
  | "x-thread"
  | "x-single";

export type ArcShape = "build-up-day-of-recap" | "flexible-theme";

export interface CalendarEvent {
  id: string;
  title: string;
  /** Unix ms — the day-of date. */
  startMs: number;
  /** Used for citation context, not freelancing. */
  classification: "creator-relevant-life-event" | "creator-shoot";
}

export interface CreatorPictureSubset {
  niche: string;
  voiceFingerprint: string;
  postingCadence: Array<{
    platform: Platform;
    postsPerWeek: number;
    bestHoursLocal: number[]; // 0..23
  }>;
}

export interface ArcInputs {
  seedEvent?: CalendarEvent;
  theme?: string;
  creatorPicture: CreatorPictureSubset;
  platforms: Platform[];
  lookAheadDays: number;
  /** Plan-tier cap: 1 for Starter, len(platforms) for Pro+. */
  maxPlatformVariantsPerDay: number;
  /** Creator's local timezone, IANA. */
  timezoneIana: string;
}

export interface ArcDay {
  dayOffset: number;
  platform: Platform;
  format: PostFormat;
  hookOptions: string[];
  captionDraft: string;
  postingTimeLocal: string; // "HH:MM"
  rationale: string;
  citation: { sourceKind: "calendar-event" | "theme"; sourceId: string };
}

export interface ArcResult {
  arc: ArcDay[];
  rationale: string;
  shape: ArcShape;
}

/* -------------------------------------------------------------------------- */
/* Dependencies                                                                */
/* -------------------------------------------------------------------------- */

export interface PlatformBestPracticeSkill {
  pickFormat(input: { platform: Platform; beat: ArcBeat }): Promise<PostFormat>;
  pickPostingHourLocal(input: {
    platform: Platform;
    beat: ArcBeat;
    creatorBestHours: number[];
  }): Promise<number>;
}

export interface CreativeModel {
  draftHooksAndCaption(input: {
    platform: Platform;
    format: PostFormat;
    beat: ArcBeat;
    seedKind: "calendar-event" | "theme";
    seedTitle: string;
    voiceFingerprint: string;
    niche: string;
  }): Promise<{ hookOptions: string[]; captionDraft: string }>;
}

export interface CitationFirewall {
  check(input: {
    text: string;
    citations: string[];
  }): Promise<{ passed: boolean; unsupportedClaims: string[] }>;
}

/** Beat = the role this slot plays in the arc. */
export type ArcBeat =
  | "build-up"     // -7..-1
  | "day-of"       // 0
  | "recap"        // +1
  | "evergreen"    // +7..+14
  | "theme-slot";  // flexible-theme arcs

/* -------------------------------------------------------------------------- */
/* Day grid (deterministic)                                                    */
/* -------------------------------------------------------------------------- */

/** Per-beat platform-priority order — first N (= maxPlatformVariantsPerDay) get a slot. */
const BEAT_PRIORITY: Record<ArcBeat, Platform[]> = {
  "build-up": ["tiktok", "instagram", "x", "linkedin", "youtube"],
  "day-of": ["instagram", "tiktok", "x", "youtube", "linkedin"],
  "recap": ["instagram", "tiktok", "youtube", "linkedin", "x"],
  "evergreen": ["youtube", "linkedin", "instagram", "tiktok", "x"],
  "theme-slot": ["tiktok", "instagram", "youtube", "linkedin", "x"],
};

interface GridSlot {
  dayOffset: number;
  beat: ArcBeat;
  platform: Platform;
}

export function buildEventDayGrid(
  connectedPlatforms: Platform[],
  maxPlatformVariantsPerDay: number
): GridSlot[] {
  const slots: GridSlot[] = [];
  const beats: Array<{ offset: number; beat: ArcBeat }> = [
    { offset: -3, beat: "build-up" },
    { offset: -1, beat: "build-up" },
    { offset: 0, beat: "day-of" },
    { offset: 1, beat: "recap" },
    { offset: 7, beat: "evergreen" },
  ];
  for (const { offset, beat } of beats) {
    const ordered = BEAT_PRIORITY[beat].filter((p) => connectedPlatforms.includes(p));
    for (const platform of ordered.slice(0, maxPlatformVariantsPerDay)) {
      slots.push({ dayOffset: offset, beat, platform });
    }
  }
  return slots;
}

export function buildThemeDayGrid(
  connectedPlatforms: Platform[],
  cadence: CreatorPictureSubset["postingCadence"],
  lookAheadDays: number,
  maxPlatformVariantsPerDay: number
): GridSlot[] {
  const slots: GridSlot[] = [];
  // Cadence-aware: distribute postsPerWeek (per platform) across lookAheadDays.
  const platformsByPriority = BEAT_PRIORITY["theme-slot"].filter((p) =>
    connectedPlatforms.includes(p)
  );
  for (const platform of platformsByPriority.slice(0, maxPlatformVariantsPerDay)) {
    const c = cadence.find((x) => x.platform === platform);
    const postsThisWindow = c
      ? Math.max(1, Math.round((c.postsPerWeek / 7) * lookAheadDays))
      : 1;
    // Spread evenly across the window.
    const step = lookAheadDays / postsThisWindow;
    for (let i = 0; i < postsThisWindow; i++) {
      const offset = Math.floor(i * step);
      slots.push({ dayOffset: offset, beat: "theme-slot", platform });
    }
  }
  // Sort for determinism.
  slots.sort(
    (a, b) =>
      a.dayOffset - b.dayOffset || a.platform.localeCompare(b.platform)
  );
  return slots;
}

/* -------------------------------------------------------------------------- */
/* Top-level entry                                                             */
/* -------------------------------------------------------------------------- */

export interface ArcDeps {
  bestPractice: PlatformBestPracticeSkill;
  model: CreativeModel;
  firewall: CitationFirewall;
}

export async function planArc(
  inputs: ArcInputs,
  deps: ArcDeps
): Promise<ArcResult> {
  // Validate seed exclusivity.
  const hasEvent = inputs.seedEvent !== undefined;
  const hasTheme = inputs.theme !== undefined && inputs.theme.trim().length > 0;
  if (hasEvent === hasTheme) {
    throw new Error(
      "maya-content-arc-planner: exactly one of seedEvent or theme must be present."
    );
  }
  if (inputs.platforms.length === 0) {
    throw new Error("maya-content-arc-planner: platforms[] must be non-empty.");
  }
  if (inputs.maxPlatformVariantsPerDay < 1) {
    throw new Error(
      "maya-content-arc-planner: maxPlatformVariantsPerDay must be >= 1."
    );
  }
  if (inputs.lookAheadDays < 3 || inputs.lookAheadDays > 14) {
    throw new Error(
      "maya-content-arc-planner: lookAheadDays must be between 3 and 14."
    );
  }

  const shape: ArcShape = hasEvent ? "build-up-day-of-recap" : "flexible-theme";
  const seedKind: "calendar-event" | "theme" = hasEvent ? "calendar-event" : "theme";
  const seedTitle = hasEvent ? inputs.seedEvent!.title : inputs.theme!;
  const seedId = hasEvent
    ? inputs.seedEvent!.id
    : `theme:${slug(inputs.theme!)}`;

  // Build the deterministic day grid.
  const grid = hasEvent
    ? buildEventDayGrid(inputs.platforms, inputs.maxPlatformVariantsPerDay)
    : buildThemeDayGrid(
        inputs.platforms,
        inputs.creatorPicture.postingCadence,
        inputs.lookAheadDays,
        inputs.maxPlatformVariantsPerDay
      );

  // For each slot, ask best-practice for format + posting hour, then ask the
  // creative model for hooks + caption.
  const arc: ArcDay[] = [];
  for (const slot of grid) {
    const format = await deps.bestPractice.pickFormat({
      platform: slot.platform,
      beat: slot.beat,
    });
    const cadenceForPlatform = inputs.creatorPicture.postingCadence.find(
      (c) => c.platform === slot.platform
    );
    const hour = await deps.bestPractice.pickPostingHourLocal({
      platform: slot.platform,
      beat: slot.beat,
      creatorBestHours: cadenceForPlatform?.bestHoursLocal ?? [10, 18],
    });
    const { hookOptions, captionDraft } = await deps.model.draftHooksAndCaption({
      platform: slot.platform,
      format,
      beat: slot.beat,
      seedKind,
      seedTitle,
      voiceFingerprint: inputs.creatorPicture.voiceFingerprint,
      niche: inputs.creatorPicture.niche,
    });

    const day: ArcDay = {
      dayOffset: slot.dayOffset,
      platform: slot.platform,
      format,
      hookOptions,
      captionDraft,
      postingTimeLocal: `${pad2(hour)}:00`,
      rationale: rationaleForBeat(slot.beat, slot.platform, format),
      citation: { sourceKind: seedKind, sourceId: seedId },
    };

    // Firewall the caption + hook bundle against the seed citation.
    const verdict = await deps.firewall.check({
      text: `${captionDraft}\n${hookOptions.join("\n")}`,
      citations: [seedId],
    });
    if (!verdict.passed) {
      // Drop this slot rather than ship a hallucinated caption.
      continue;
    }
    arc.push(day);
  }

  // Bundle-level rationale (≤ 4 sentences). Built deterministically from the
  // arc shape + seed; firewalled against the seed.
  const rationale = buildBundleRationale(shape, seedTitle, arc.length);
  const bundleVerdict = await deps.firewall.check({
    text: rationale,
    citations: [seedId],
  });
  if (!bundleVerdict.passed) {
    // Strip the synthesized rationale entirely rather than ship one we can't
    // ground. Replace with a structural one-liner.
    return {
      arc,
      rationale: `${arc.length}-slot arc anchored to ${seedKind === "calendar-event" ? "calendar event" : "theme"}: ${seedTitle}.`,
      shape,
    };
  }
  return { arc, rationale, shape };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function rationaleForBeat(beat: ArcBeat, platform: Platform, format: PostFormat): string {
  switch (beat) {
    case "build-up":
      return `Anticipation slot — ${platform}/${format} — primes the audience before the moment.`;
    case "day-of":
      return `Live capture — ${platform}/${format} — the moment itself, posted in real time.`;
    case "recap":
      return `Morning-after — ${platform}/${format} — synthesis + lessons from the moment.`;
    case "evergreen":
      return `Evergreen variant — ${platform}/${format} — durable retelling that retains value beyond the moment.`;
    case "theme-slot":
      return `Theme slot — ${platform}/${format} — fits the cadence on this platform.`;
  }
}

function buildBundleRationale(shape: ArcShape, seedTitle: string, slotCount: number): string {
  if (shape === "build-up-day-of-recap") {
    return `${slotCount}-slot arc anchored to: ${seedTitle}. Build-up posts prime the audience; day-of captures the moment; recap and evergreen extend the story past the date.`;
  }
  return `${slotCount}-slot theme arc on: ${seedTitle}. Slots distributed across the window per the creator's actual cadence per platform.`;
}
