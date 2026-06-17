/**
 * channelSelection.ts — the channel-ACTIVATION policy.
 *
 * The judge (judgeChannel.ts) scores each channel and assigns a `decision`
 * (primary / secondary / parked / blocked). That is the FIT signal. This module
 * turns fit into the set of channels Maya actually RUNS on day one.
 *
 * Policy (locked 2026-06-06, see handoff):
 *  1. Lock in ALL high-fit (`primary`) bet channels — NO cap. Early GTM is
 *     portfolio search (explore→exploit); diversifying across platforms is the
 *     point, and a flat tier gives no reason to under-serve.
 *  2. Floor of 3: if fewer than 3 are locked, promote the top-scored
 *     `secondary` channels by score — BUT never one below the quality floor.
 *  3. Honesty escape hatch: if fewer than 3 clear the floor, activate only what
 *     clears it and surface `belowFloor` + a note. We do NOT pad the set with
 *     channels the evidence doesn't support just to hit an arbitrary count.
 *  4. Floor-of-1 safety: if literally nothing clears (no primaries, no
 *     floor-clearing secondaries), fall back to the single highest-scored
 *     non-blocked bet channel so Maya is never paralyzed — flagged belowFloor.
 *
 * Ban-safety: `blocked` channels NEVER activate (they carry a platform/ban
 * risk the judge flagged). Pacing of how fast active channels go hot is handled
 * separately by channelWarmth.ts — this module decides the SET, warmth decides
 * the RAMP.
 *
 * This is a PURE function with no Convex/DB/network deps so the deploy path,
 * the mission board, and the onboarding picker all share one source of truth
 * for "which channels are live".
 */

import type { GtmChannel, GtmChannelDecision, GtmConfidence } from "./channelScoring";

/** The bet channels Maya can actually run + post on (Zernio-postable, or
 * human-one-tap for reddit/tiktok). `hn` is research-only and `product_hunt`
 * is a single-day launch — neither is an ongoing bet channel, so neither can
 * be activated here even if a stale historical row scored them. */
export const BET_CHANNELS: readonly GtmChannel[] = [
  "reddit",
  "x",
  "linkedin",
  "tiktok",
  "instagram",
  "youtube",
];

/** Minimum number of channels we try to activate (portfolio-search floor). */
export const MIN_ACTIVE_CHANNELS = 3;

/** A secondary may only be PROMOTED to active if its score clears this bar. */
export const PROMOTION_SCORE_FLOOR = 0.5;

/** The minimal score-row shape this policy needs. Both
 * `Doc<"gtmChannelScores">` and `JudgeChannelDecisionRow` satisfy it. */
export interface ChannelScoreInput {
  channel: GtmChannel;
  score: number;
  decision: GtmChannelDecision;
  confidence: GtmConfidence;
  qualityGate: { passed: boolean; failures?: string[] };
}

export interface ActiveChannelSelection {
  /** The channels Maya runs, ordered by score (highest first). */
  active: GtmChannel[];
  /** Back-compat single fields for consumers that still take one each. */
  primaryChannel: GtmChannel | null;
  secondaryChannel: GtmChannel | null;
  /** Secondaries that were promoted to active to meet the floor of 3. */
  promoted: GtmChannel[];
  /** Bet channels evaluated but NOT activated (parked / sub-floor / blocked). */
  parked: GtmChannel[];
  /** True when we could not reach MIN_ACTIVE_CHANNELS on evidence alone. */
  belowFloor: boolean;
  /** Human-readable summary of what was activated and why (for GTM.md). */
  note: string;
}

function isBetChannel(channel: GtmChannel): boolean {
  return BET_CHANNELS.includes(channel);
}

/** A secondary clears the promotion floor only if its quality gate passed, its
 * confidence is not `low`, and its score meets the threshold. */
function clearsPromotionFloor(s: ChannelScoreInput): boolean {
  return (
    s.qualityGate.passed &&
    s.confidence !== "low" &&
    s.score >= PROMOTION_SCORE_FLOOR
  );
}

/**
 * Decide which channels Maya actually runs, from the judge's scored rows.
 * Pure + deterministic — same input always yields the same selection.
 */
export interface SelectActiveChannelsOpts {
  /**
   * Tier ceiling on how many channels Maya RUNS (the per-tier paywall — the #1
   * COGS/margin lever, since Zernio bills per connected account). Undefined =
   * NO cap (legacy behavior, all high-fit primaries run). When set, the active
   * set is trimmed to the top-N by priority (primaries first, then promoted),
   * and the cap WINS over the floor-of-3 (a tier that only pays for 2 channels
   * runs 2). Resolve from `planFeaturesGtm(agent).autoPostChannelCap`.
   */
  maxActiveChannels?: number;
}

export function selectActiveChannels(
  scores: ReadonlyArray<ChannelScoreInput>,
  opts: SelectActiveChannelsOpts = {}
): ActiveChannelSelection {
  // Only ongoing bet channels are eligible. De-dupe by channel (keep the
  // highest-scored row if a channel somehow appears twice) and drop blocked.
  const byChannel = new Map<GtmChannel, ChannelScoreInput>();
  for (const s of scores) {
    if (!isBetChannel(s.channel)) continue;
    const existing = byChannel.get(s.channel);
    if (!existing || s.score > existing.score) byChannel.set(s.channel, s);
  }
  const eligible = [...byChannel.values()].filter(
    (s) => s.decision !== "blocked"
  );
  // Stable, deterministic ordering: score desc, then channel name for ties.
  const byScoreDesc = (a: ChannelScoreInput, b: ChannelScoreInput) =>
    b.score - a.score || a.channel.localeCompare(b.channel);

  // 1. Lock ALL high-fit primaries — no cap.
  const primaries = eligible
    .filter((s) => s.decision === "primary")
    .sort(byScoreDesc);
  const active: ChannelScoreInput[] = [...primaries];
  const promoted: GtmChannel[] = [];

  // 2. Floor of 3: promote top-scored secondaries that clear the quality floor.
  if (active.length < MIN_ACTIVE_CHANNELS) {
    const promotable = eligible
      .filter((s) => s.decision === "secondary" && clearsPromotionFloor(s))
      .sort(byScoreDesc);
    for (const s of promotable) {
      if (active.length >= MIN_ACTIVE_CHANNELS) break;
      active.push(s);
      promoted.push(s.channel);
    }
  }

  // 4. Floor-of-1 safety: never leave Maya with nothing to run. If neither a
  //    primary nor a floor-clearing secondary exists, fall back to the single
  //    highest-scored non-blocked bet channel.
  if (active.length === 0 && eligible.length > 0) {
    const fallback = [...eligible].sort(byScoreDesc)[0];
    active.push(fallback);
    if (fallback.decision !== "primary") promoted.push(fallback.channel);
  }

  // Tier cap: trim the active set to the per-tier ceiling (the paywall + the
  // Zernio per-account COGS lever). `active` is already in priority order
  // (primaries by score, then promoted), so a head-slice keeps the bets and
  // drops the lowest-priority extras into parked. The cap WINS over the floor
  // (a 2-channel tier runs 2, even though the portfolio floor wants 3). A cap
  // <= 0 (fail-closed/inactive) runs nothing.
  let capped = false;
  if (
    typeof opts.maxActiveChannels === "number" &&
    active.length > Math.max(0, opts.maxActiveChannels)
  ) {
    active.length = Math.max(0, opts.maxActiveChannels);
    capped = true;
  }

  const activeChannels = active.map((s) => s.channel);
  const activeSet = new Set<GtmChannel>(activeChannels);
  const parked = eligible
    .filter((s) => !activeSet.has(s.channel))
    .sort(byScoreDesc)
    .map((s) => s.channel);

  // The floor only "fails" on thin evidence — NOT when the tier cap itself is
  // below the floor (that's a paid ceiling, not a research gap).
  const belowFloor =
    !capped && activeChannels.length < MIN_ACTIVE_CHANNELS;

  // A channel trimmed by the cap is no longer "promoted-and-active".
  const promotedActive = promoted.filter((c) => activeSet.has(c));

  // 3. Honesty note.
  let note: string;
  if (activeChannels.length === 0) {
    note =
      capped && opts.maxActiveChannels === 0
        ? "Plan allows 0 channels — nothing is running (inactive/fail-closed)."
        : "No channels cleared the evidence bar — research is incomplete.";
  } else if (belowFloor) {
    note =
      `Only ${activeChannels.length} channel(s) clear the bar ` +
      `(${activeChannels.join(", ")}). Activating just those rather than ` +
      `padding the mix with channels the evidence doesn't support yet.`;
  } else {
    const promotedNote = promotedActive.length
      ? ` (${promotedActive.join(", ")} promoted to meet the 3-channel floor)`
      : "";
    const capNote = capped
      ? ` — capped to your plan's ${opts.maxActiveChannels}-channel limit`
      : "";
    note = `Running ${activeChannels.length} channels: ${activeChannels.join(", ")}${promotedNote}${capNote}.`;
  }

  return {
    active: activeChannels,
    primaryChannel: activeChannels[0] ?? null,
    secondaryChannel: activeChannels[1] ?? null,
    promoted: promotedActive,
    parked,
    belowFloor,
    note,
  };
}
