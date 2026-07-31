/**
 * The buyer map (§5.0.0) — where the buyers are and what they complain about.
 *
 * This is the artifact the whole positioning rests on, and it is more than a
 * competitor list:
 *
 *   gathering   — hashtags, creators, communities, with evidence
 *   follows     — who they actually watch, scored by overlap
 *   language    — THEIR words for the problem, never our marketing vocabulary
 *   complaints  — ⭐ RANKED, with receipts
 *
 * > **The ranked complaint list IS the content plan.** If 11 people in this
 * > niche asked about pricing confusion this month, that's not an insight to
 * > file — it's next week's post, with the receipts attached.
 *
 * Everything here is pure. The vendor calls that feed it live in
 * `integrations/scrapeCreators`; this module is the reasoning, so it can be
 * tested exhaustively against known inputs rather than against the network.
 */

import { similarity } from "./quality";

/* -------------------------------------------------------------------------- */
/* Audience overlap — who follows the competitors IS the ICP                   */
/* -------------------------------------------------------------------------- */

export interface CompetitorAudience {
  handle: string;
  /** Follower handles, from `tiktok/user/followers`. */
  followers: ReadonlyArray<string>;
}

export interface OverlapResult {
  handle: string;
  /** 0–1: the share of tracked competitors this person follows. */
  overlapScore: number;
  /** Which ones, so the score is always explainable. */
  followsCompetitors: string[];
}

/**
 * Rank an audience by how many competitors each person follows.
 *
 * The insight the spec leans on: someone following ONE competitor might be a
 * customer, a rival, or a bot. Someone following FOUR is in the market — the
 * overlap is the signal, not the raw follower list.
 *
 * `minCompetitors` defaults to 2 for exactly that reason: a single-competitor
 * follower carries almost no information, and including them buries the real
 * ICP under noise.
 */
export function computeAudienceOverlap(input: {
  competitors: ReadonlyArray<CompetitorAudience>;
  minCompetitors?: number;
}): OverlapResult[] {
  const { competitors, minCompetitors = 2 } = input;
  if (competitors.length === 0) return [];

  const follows = new Map<string, Set<string>>();
  for (const competitor of competitors) {
    // Dedupe within one competitor's list: a repeated handle must not inflate
    // the score of someone who appears twice in a paginated pull.
    for (const follower of new Set(competitor.followers)) {
      const set = follows.get(follower) ?? new Set<string>();
      set.add(competitor.handle);
      follows.set(follower, set);
    }
  }

  const results: OverlapResult[] = [];
  for (const [handle, set] of follows) {
    if (set.size < minCompetitors) continue;
    results.push({
      handle,
      overlapScore: set.size / competitors.length,
      followsCompetitors: [...set].sort(),
    });
  }

  // Highest overlap first; ties broken alphabetically so the order is stable
  // across runs — an unstable ranking makes week-over-week diffs meaningless.
  return results.sort(
    (a, b) => b.overlapScore - a.overlapScore || a.handle.localeCompare(b.handle)
  );
}

export interface GatheringPlace {
  handle: string;
  /** How many of the ICP follow this account. */
  icpFollowers: number;
  /** 0–1 share of the ICP sample. */
  share: number;
}

/**
 * Given the ICP, find where they actually gather.
 *
 * The second half of the move: having identified the people, ask what ELSE
 * they follow. Accounts the ICP watches which are *not* the competitors are
 * the niche's real gathering places — and they're where a founder should be
 * posting, versus where we assumed they should be.
 *
 * Competitors are excluded by construction; including them would just
 * rediscover the input.
 */
export function discoverGathering(input: {
  icpHandles: ReadonlyArray<string>;
  /** What each ICP member follows, from `tiktok/user/following`. */
  followingByHandle: Readonly<Record<string, ReadonlyArray<string>>>;
  competitorHandles: ReadonlyArray<string>;
  minShare?: number;
  /**
   * Absolute floor, independent of share. One person is never a gathering
   * place — with a small ICP sample a single follower clears any sensible
   * share threshold (1 of 4 is 25%) while being that person's unrelated
   * interest rather than a place the niche gathers.
   */
  minIcpFollowers?: number;
}): GatheringPlace[] {
  const {
    icpHandles,
    followingByHandle,
    competitorHandles,
    minShare = 0.2,
    minIcpFollowers = 2,
  } = input;
  if (icpHandles.length === 0) return [];

  const exclude = new Set([...competitorHandles, ...icpHandles]);
  const counts = new Map<string, number>();

  for (const person of icpHandles) {
    const following = followingByHandle[person];
    if (!following) continue;
    for (const followed of new Set(following)) {
      if (exclude.has(followed)) continue;
      counts.set(followed, (counts.get(followed) ?? 0) + 1);
    }
  }

  const places: GatheringPlace[] = [];
  for (const [handle, icpFollowers] of counts) {
    const share = icpFollowers / icpHandles.length;
    if (icpFollowers < minIcpFollowers) continue;
    if (share < minShare) continue;
    places.push({ handle, icpFollowers, share });
  }
  return places.sort(
    (a, b) => b.share - a.share || a.handle.localeCompare(b.handle)
  );
}

/* -------------------------------------------------------------------------- */
/* The ranked complaint list — which is the content plan                       */
/* -------------------------------------------------------------------------- */

export interface ComplaintSource {
  text: string;
  sourceUrl: string;
  postedAt: number;
}

export interface RankedComplaint {
  /** The clearest phrasing seen — THEIR words, not a summary in ours. */
  text: string;
  frequency: number;
  /** Receipts. Every complaint is quotable back to where it was said. */
  sourceUrls: string[];
  lastSeen: number;
}

/** Above this, two complaints are the same complaint said differently. */
const COMPLAINT_CLUSTER_THRESHOLD = 0.45;

/**
 * Cluster raw complaints and rank by frequency.
 *
 * Two properties matter more than the clustering quality:
 *
 * 1. **The representative text is a real quote**, never a synthesis. We pick
 *    the longest member of the cluster, because it carries the most of the
 *    buyer's own language — and §5.0.0 is explicit that `language` must be
 *    their words for the problem, never our marketing vocabulary.
 * 2. **Every complaint keeps its receipts.** A frequency with no source URLs
 *    is a number we can't defend, and this list is meant to be shown to the
 *    founder as justification for what gets written.
 */
export function rankComplaints(
  sources: ReadonlyArray<ComplaintSource>
): RankedComplaint[] {
  const clusters: Array<{ members: ComplaintSource[] }> = [];

  for (const source of sources) {
    const hit = clusters.find((cluster) =>
      cluster.members.some(
        (m) => similarity(m.text, source.text) >= COMPLAINT_CLUSTER_THRESHOLD
      )
    );
    if (hit) hit.members.push(source);
    else clusters.push({ members: [source] });
  }

  return clusters
    .map((cluster) => {
      const representative = cluster.members.reduce((longest, m) =>
        m.text.length > longest.text.length ? m : longest
      );
      return {
        text: representative.text,
        frequency: cluster.members.length,
        // Deduped: the same thread quoted twice is one receipt, not two.
        sourceUrls: [...new Set(cluster.members.map((m) => m.sourceUrl))],
        lastSeen: Math.max(...cluster.members.map((m) => m.postedAt)),
      };
    })
    .sort((a, b) => b.frequency - a.frequency || b.lastSeen - a.lastSeen);
}

/* -------------------------------------------------------------------------- */
/* Complaint→content — the tracked number                                      */
/* -------------------------------------------------------------------------- */

export interface ComplaintToContentRate {
  traced: number;
  total: number;
  /** 0–1. Undefined-safe: a week with no posts is 0, never NaN. */
  rate: number;
  /** The sentence for the weekly review. Plain language, no percentages. */
  sentence: string;
}

/**
 * What percentage of this week's posts trace to a real buyer complaint?
 *
 * §5.0.0 calls this three things at once: a quality signal (content grounded
 * in demand rather than invention), an operator signal (if it's low across the
 * fleet, comment mining is underperforming), and the marketing claim itself,
 * provable per customer.
 *
 * It belongs in the weekly review stated plainly — "4 of 6 posts this week came
 * from something your buyers actually said" — which is why this returns the
 * sentence rather than a number for someone else to phrase.
 */
export function complaintToContentRate(
  posts: ReadonlyArray<{ tracesToComplaint: boolean }>
): ComplaintToContentRate {
  const total = posts.length;
  const traced = posts.filter((p) => p.tracesToComplaint).length;
  const rate = total === 0 ? 0 : traced / total;

  const sentence =
    total === 0
      ? "Nothing went out this week."
      : traced === 0
        ? `None of this week's ${total} posts came from something your buyers said — I'll fix that.`
        : `${traced} of ${total} post${total === 1 ? "" : "s"} this week came from something your buyers actually said.`;

  return { traced, total, rate, sentence };
}

/* -------------------------------------------------------------------------- */
/* Staleness                                                                   */
/* -------------------------------------------------------------------------- */

/** A buyer map is refreshed monthly (§5.0.0). */
export const BUYER_MAP_MAX_AGE_MS = 31 * 24 * 3600_000;

/**
 * Is this map too old to trust?
 *
 * §5.0.0: "a stale buyer map silently poisons the idea bank, the format
 * library, and the benchmarks all at once." Silently is the operative word —
 * nothing downstream fails, the output just quietly stops matching reality. So
 * staleness is surfaced rather than inferred.
 */
export function isStale(refreshedAt: number | undefined, now: number): boolean {
  if (refreshedAt === undefined) return true;
  return now - refreshedAt > BUYER_MAP_MAX_AGE_MS;
}
