/**
 * maya-collab-matchmaker — pure-logic helpers.
 *
 * Sprint 3.5b. The Convex action that wires this skill to ScrapeCreators
 * creator-search + callMaya + voice-applier + collabMatchLog persistence
 * lives in `convex/agents/skills/collabMatchmaker.ts` (lead pushes). This
 * module is the pure logic the action composes:
 *
 *   - `filterCandidates`: drop direct competitors / mismatched-size /
 *     recent-same-format-collab / known-flop peers
 *   - `pickFormat`: deterministic format suggestion given platform + size
 *     differential
 *   - `matchPrompt`: build the medium-thinking prompt for match reasoning +
 *     first-message drafts
 *   - `parseMatchOutput`: tolerant JSON parser, never throws
 *   - `surfaceAntiPatterns`: enumerate anti-patterns based on which filters
 *     fired during candidate filtering
 *
 * Stage-aware adaptive product (Agent B, 2026-04-26): `matchPrompt` accepts
 * an optional `growthPlan` and appends a focusAreas/antiPatterns suffix. The
 * orchestrator should call
 * `assertSkillRespectsGrowthPlan("collab-matchmaker", growthPlan)` upstream.
 *
 * No Convex imports. No network. Pure TypeScript.
 */
import {
  growthPlanPromptSuffix,
  routeViaGrowthPlan,
  type GrowthPlanForSkill,
} from "../maya-platform/growthPlanGuard";

export type Platform = "tiktok" | "instagram" | "youtube" | "linkedin" | "x";

export type CollabFormat =
  | "duet"
  | "guest-podcast"
  | "video-collab"
  | "instagram-takeover"
  | "cross-shoutout"
  | "co-created-product";

export type Momentum = "rising" | "flat" | "declining";

export type CollabOutcome = "great" | "okay" | "flop";

export type PeerRelationship = "mutual" | "follower" | "admired";

export interface NamedPeer {
  readonly handle: string;
  readonly platform: string;
  readonly relationship: PeerRelationship;
}

export interface CollabHistoryItem {
  readonly peerHandle: string;
  readonly format: CollabFormat;
  readonly outcome: CollabOutcome;
  readonly happenedAt: string; // ISO date
}

export interface CreatorPictureSubset {
  readonly niche: string;
  readonly audience: {
    readonly topGeos: ReadonlyArray<string>;
    readonly interestTags: ReadonlyArray<string>;
    readonly ageRanges: ReadonlyArray<string>;
  };
  readonly followerCount: number;
  readonly namedPeers: ReadonlyArray<NamedPeer>;
  readonly platforms: ReadonlyArray<Platform>;
  readonly voiceFingerprint: string;
}

export interface CollabMatchInput {
  readonly creatorPicture: CreatorPictureSubset;
  readonly recentMomentum: Momentum;
  readonly collabHistory: ReadonlyArray<CollabHistoryItem>;
  readonly maxMatches?: number;
}

export interface PeerCandidate {
  readonly handle: string;
  readonly platform: Platform;
  readonly followerCount: number;
  readonly niche: string;
  readonly audienceOverlapScore: number; // 0..1
  readonly recentMomentum: Momentum;
  readonly recentTopPostHeadline?: string;
  readonly recentTopPostUrl?: string;
}

export interface CollabMatch {
  readonly peerHandle: string;
  readonly platform: string;
  readonly followerCount: number;
  readonly niche: string;
  readonly audienceOverlapScore: number;
  readonly recentMomentum: Momentum;
  readonly suggestedFormat: CollabFormat;
  readonly reasoning: string;
  readonly firstMessageDraft: string;
}

export type AntiPattern =
  | "avoid-direct-competitor"
  | "avoid-mismatched-audience-size"
  | "avoid-recent-same-format-repeat"
  | "avoid-known-flop-peer"
  | "prioritize-rising-peers";

export interface CollabMatchCitation {
  readonly kind: "peer" | "metric";
  readonly id: string;
  readonly fact: string;
}

export interface CollabMatchOutput {
  readonly matches: ReadonlyArray<CollabMatch>;
  readonly antiPatterns: ReadonlyArray<AntiPattern>;
  readonly citations: ReadonlyArray<CollabMatchCitation>;
}

/* -------------------------------------------------------------------------- */
/* Filtering                                                                   */
/* -------------------------------------------------------------------------- */

const DIRECT_COMPETITOR_THRESHOLD = 0.85;
const MIN_OVERLAP_THRESHOLD = 0.2;
const SIZE_RATIO_LARGE_MAX = 5.0;
const SIZE_RATIO_SMALL_MIN = 0.2;
const RECENT_SAME_FORMAT_DAYS = 90;

export interface FilterResult {
  readonly kept: ReadonlyArray<PeerCandidate>;
  readonly droppedDirectCompetitor: number;
  readonly droppedSizeMismatch: number;
  readonly droppedRecentSameFormat: number;
  readonly droppedKnownFlop: number;
  readonly droppedLowOverlap: number;
}

function daysAgoMs(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

export function filterCandidates(
  creator: CreatorPictureSubset,
  candidates: ReadonlyArray<PeerCandidate>,
  history: ReadonlyArray<CollabHistoryItem>,
  proposedFormatPerPeer: ReadonlyMap<string, CollabFormat>
): FilterResult {
  const kept: PeerCandidate[] = [];
  let direct = 0;
  let sizeMismatch = 0;
  let recentRepeat = 0;
  let flopped = 0;
  let lowOverlap = 0;

  // Build lookup tables for O(1) peer-history checks
  const flopPeers = new Set<string>(
    history.filter((h) => h.outcome === "flop").map((h) => h.peerHandle.toLowerCase())
  );
  const recentSameFormatCutoff = daysAgoMs(RECENT_SAME_FORMAT_DAYS);
  const recentSameFormatKeys = new Set<string>();
  for (const h of history) {
    const t = Date.parse(h.happenedAt);
    if (Number.isNaN(t) || t < recentSameFormatCutoff) continue;
    recentSameFormatKeys.add(`${h.peerHandle.toLowerCase()}::${h.format}`);
  }

  for (const c of candidates) {
    const handleLower = c.handle.toLowerCase();
    if (flopPeers.has(handleLower)) {
      flopped++;
      continue;
    }
    if (c.audienceOverlapScore > DIRECT_COMPETITOR_THRESHOLD) {
      direct++;
      continue;
    }
    if (c.audienceOverlapScore < MIN_OVERLAP_THRESHOLD) {
      lowOverlap++;
      continue;
    }
    const ratio = creator.followerCount === 0 ? Infinity : c.followerCount / creator.followerCount;
    if (ratio > SIZE_RATIO_LARGE_MAX || ratio < SIZE_RATIO_SMALL_MIN) {
      sizeMismatch++;
      continue;
    }
    const proposedFormat = proposedFormatPerPeer.get(handleLower);
    if (proposedFormat) {
      const key = `${handleLower}::${proposedFormat}`;
      if (recentSameFormatKeys.has(key)) {
        recentRepeat++;
        continue;
      }
    }
    kept.push(c);
  }

  return {
    kept,
    droppedDirectCompetitor: direct,
    droppedSizeMismatch: sizeMismatch,
    droppedRecentSameFormat: recentRepeat,
    droppedKnownFlop: flopped,
    droppedLowOverlap: lowOverlap,
  };
}

/* -------------------------------------------------------------------------- */
/* Format selection                                                            */
/* -------------------------------------------------------------------------- */

export function pickFormat(
  creator: CreatorPictureSubset,
  peer: PeerCandidate
): CollabFormat {
  const ratio = creator.followerCount === 0 ? 1 : peer.followerCount / creator.followerCount;
  const samePlatform = (creator.platforms as ReadonlyArray<string>).includes(peer.platform);

  // Different platforms — guest-podcast pattern (creator goes on peer's
  // long-form show, or vice versa).
  if (!samePlatform) {
    if (peer.platform === "youtube" || peer.platform === "linkedin") {
      return "guest-podcast";
    }
    return "video-collab";
  }

  // Same platform — size-driven choice.
  if (peer.platform === "tiktok") {
    if (ratio >= 0.7 && ratio <= 1.5) return "duet"; // similar-size duet
    if (ratio > 1.5 && ratio <= 2.0) return "video-collab";
    if (ratio < 0.7) return "cross-shoutout";
    return "video-collab";
  }
  if (peer.platform === "instagram") {
    if (ratio >= 0.7 && ratio <= 1.5) return "cross-shoutout";
    if (ratio > 1.5) return "instagram-takeover";
    return "cross-shoutout";
  }
  if (peer.platform === "youtube") {
    return "video-collab";
  }
  // Default safe choice.
  return "cross-shoutout";
}

/* -------------------------------------------------------------------------- */
/* Anti-pattern surfacing                                                      */
/* -------------------------------------------------------------------------- */

export function surfaceAntiPatterns(
  filterResult: FilterResult,
  matches: ReadonlyArray<CollabMatch>
): AntiPattern[] {
  const out: AntiPattern[] = [];
  if (filterResult.droppedDirectCompetitor > 0) out.push("avoid-direct-competitor");
  if (filterResult.droppedSizeMismatch > 0) out.push("avoid-mismatched-audience-size");
  if (filterResult.droppedRecentSameFormat > 0) out.push("avoid-recent-same-format-repeat");
  if (filterResult.droppedKnownFlop > 0) out.push("avoid-known-flop-peer");
  const risingCount = matches.filter((m) => m.recentMomentum === "rising").length;
  if (risingCount >= 2) out.push("prioritize-rising-peers");
  return out;
}

/* -------------------------------------------------------------------------- */
/* Match prompt                                                                */
/* -------------------------------------------------------------------------- */

export function matchPrompt(args: {
  readonly creator: CreatorPictureSubset;
  readonly recentMomentum: Momentum;
  readonly candidates: ReadonlyArray<PeerCandidate & { suggestedFormat: CollabFormat }>;
  /** Stage-aware growth plan from creatorPicture.growthPlan. Optional. */
  readonly growthPlan?: GrowthPlanForSkill | null;
}): string {
  const lines: string[] = [];
  lines.push("You are Maya, a creator's AI manager, drafting collab match cards for the creator.");
  lines.push("");
  lines.push("Creator context:");
  lines.push(`- Niche: ${args.creator.niche}`);
  lines.push(`- Follower count: ${args.creator.followerCount.toLocaleString()}`);
  lines.push(`- Platforms: ${args.creator.platforms.join(", ")}`);
  lines.push(`- Recent momentum: ${args.recentMomentum}`);
  lines.push(
    `- Audience interest tags: ${args.creator.audience.interestTags.slice(0, 6).join(", ") || "(none)"}`
  );
  lines.push("");
  lines.push("Candidates (already filtered for direct-competitor / size-mismatch / recent-format-repeat):");
  for (let i = 0; i < args.candidates.length; i++) {
    const c = args.candidates[i];
    lines.push(`[${i}] @${c.handle} (${c.platform}, ${c.followerCount.toLocaleString()} followers, ${c.niche})`);
    lines.push(
      `     Overlap: ${c.audienceOverlapScore.toFixed(2)}; Momentum: ${c.recentMomentum}; Suggested format: ${c.suggestedFormat}`
    );
    if (c.recentTopPostHeadline) {
      lines.push(`     Recent top post: "${c.recentTopPostHeadline}"${c.recentTopPostUrl ? ` (${c.recentTopPostUrl})` : ""}`);
    }
  }
  lines.push("");
  lines.push("Output STRICTLY JSON matching:");
  lines.push("{");
  lines.push('  "matches": [{');
  lines.push('    "idx": <candidate index>,');
  lines.push('    "reasoning": string  (1-2 sentences citing overlap score, momentum, OR shared niche signal),');
  lines.push('    "firstMessageDraft": string  (2-3 sentences, voice-tunable, opens with a specific reference to the peer\'s recent post if available)');
  lines.push("  }]");
  lines.push("}");
  lines.push("");
  lines.push("Rules:");
  lines.push("- Reference the peer's specific recent post in `firstMessageDraft` when available — that is the conversion lever in cold DMs.");
  lines.push("- Do NOT promise outcomes. Do NOT name dollar amounts.");
  lines.push("- Reasoning MUST trace to overlap score / momentum / niche tag — no fabrication about the peer's audience or career.");
  lines.push("- If a candidate's recent top post is missing, write a generic open that does not invent post details.");
  // Wave 2 — when the plan flags collab activity as an antiPattern (e.g. for
  // a just-starting creator with no clear niche), route to the smartAlternative
  // ("amplify in-niche peers via comment engagement first") instead of refusing.
  const route = routeViaGrowthPlan("collab-matchmaker", args.growthPlan);
  const stageSuffix = growthPlanPromptSuffix(args.growthPlan, {
    smartAlternative: route.smartAlternative,
  });
  if (stageSuffix.length > 0) lines.push(stageSuffix);
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Tolerant parser                                                             */
/* -------------------------------------------------------------------------- */

export interface ParsedMatch {
  readonly idx: number;
  readonly reasoning: string;
  readonly firstMessageDraft: string;
}

export function parseMatchOutput(raw: string, candidateCount: number): ParsedMatch[] {
  let body = raw.trim();
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const obj = parsed as { matches?: unknown };
  if (!Array.isArray(obj.matches)) return [];
  const out: ParsedMatch[] = [];
  for (const m of obj.matches) {
    if (typeof m !== "object" || m === null) continue;
    const mm = m as { idx?: unknown; reasoning?: unknown; firstMessageDraft?: unknown };
    if (typeof mm.idx !== "number" || mm.idx < 0 || mm.idx >= candidateCount) continue;
    if (typeof mm.reasoning !== "string" || mm.reasoning.trim().length === 0) continue;
    if (typeof mm.firstMessageDraft !== "string" || mm.firstMessageDraft.trim().length === 0) continue;
    if (mm.firstMessageDraft.length > 1_000) continue; // hard cap on DM length
    out.push({
      idx: mm.idx,
      reasoning: mm.reasoning,
      firstMessageDraft: mm.firstMessageDraft,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Citation builder                                                            */
/* -------------------------------------------------------------------------- */

export function buildCitations(
  creator: CreatorPictureSubset,
  matches: ReadonlyArray<CollabMatch>
): CollabMatchCitation[] {
  const cites: CollabMatchCitation[] = [
    {
      kind: "metric",
      id: "creator-followers",
      fact: `Creator follower count is ${creator.followerCount.toLocaleString()}.`,
    },
    {
      kind: "metric",
      id: "creator-niche",
      fact: `Creator niche is ${creator.niche}.`,
    },
  ];
  for (const m of matches) {
    cites.push({
      kind: "peer",
      id: `peer-${m.peerHandle.toLowerCase()}`,
      fact: `Peer @${m.peerHandle} (${m.platform}, ${m.followerCount.toLocaleString()} followers, ${m.niche}); audience overlap ${m.audienceOverlapScore.toFixed(2)}; momentum ${m.recentMomentum}.`,
    });
  }
  return cites;
}
