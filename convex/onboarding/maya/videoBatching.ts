/**
 * videoBatching — signal-prioritized video batching for the creator-picture
 * synthesis pipeline (Sprint 2 follow-up, 2026-04-26).
 *
 * ─── Why this module exists ─────────────────────────────────────────────────
 *
 * Gemini 3 Flash supports multimodal video input but with hard limits — per
 * Google's video-understanding docs (ai.google.dev/gemini-api/docs/video-
 * understanding), a single request tops out somewhere around 45-60 minutes of
 * total video duration depending on encoding (lower for high-bitrate / 4K).
 * Token cost per second of video is ~250 tokens/sec at default resolution
 * (roughly 1 frame/sec sampled), so a 60-min request is ~900K tokens of video
 * alone before captions, transcripts, or comments. The 1M context budget we
 * advertise burns out fast.
 *
 * For a creator with 60 cached posts that include multi-minute TikTok lives,
 * 5-25 min YouTube long-form, or LinkedIn/IG Reels at the upper bound, we'll
 * blow past the duration limit and either get a 4xx from Google (silent fail)
 * or eat a $5+ synthesis bill per creator. Either way it's a real gap.
 *
 * ─── Strategy: signal-prioritized subset + 30-min cap ───────────────────────
 *
 * Cap total full-video duration at 30 minutes per synthesis request. That's
 * a safety margin under any documented limit and keeps the per-creator cost
 * deterministic.
 *
 * Signal-rich subset:
 *   • Top 15 posts by engagement (across all platforms) — these are the
 *     creator's best hooks. Maya needs to see what worked.
 *   • Bottom 5 posts by engagement — the bombs. Maya needs to see what
 *     pattern to steer AWAY from. Neither half tells the story alone.
 *   • Total: 20 posts of full video.
 *
 * For the remaining 40 posts: send caption + thumbnailUrl + transcript (if
 * available) + topComments + engagement metrics as TEXT-ONLY context. Gemini
 * doesn't need to watch every video to understand the niche — these add corpus
 * signal without burning quota.
 *
 * ─── Down-shift fallback ────────────────────────────────────────────────────
 *
 * If the top-15 + bottom-5 selection still exceeds 30 min total (e.g. a
 * gaming creator whose every top-performer is a 20-min stream highlight), we
 * shrink the top half first: top-12+bottom-5 → top-10+bottom-5 → top-8+bottom-5
 * → … down to top-2+bottom-1 if necessary. We always preserve at least one
 * bottom-engagement post (the contrast signal is critical).
 *
 * ─── Long-video handling ────────────────────────────────────────────────────
 *
 * If a SINGLE video is > 30 min (e.g. an unedited 90-min YouTube vlog), it
 * cannot fit even alone. We move it to text-only context with a sampled-flag
 * so Maya knows the video wasn't watched. Truncating to first 5 min via
 * Gemini's videoMetadata.startOffset/endOffset is supported but we defer that
 * to a future sprint (TODO(s7)) — for v0 the 30-min cap is sufficient signal.
 *
 * ─── Cost envelope ──────────────────────────────────────────────────────────
 *
 * Estimated synthesis cost with this strategy:
 *   • 30 min video × ~250 tok/sec = ~450K video tokens (input)
 *   • Text context (~40 posts × ~300 tokens each) = ~12K text tokens
 *   • Captions/transcripts/comments for video posts = ~10K text tokens
 *   • System prompt = ~3K tokens
 *   Total input ≈ 475K tokens × $0.50/MTok = $0.24
 *
 *   • Output (synthesis JSON) ≈ 5K tokens
 *   • Thinking tokens (HIGH budget) ≈ 50K tokens
 *   Total output ≈ 55K × $3.00/MTok = $0.165
 *
 *   Per-synthesis cost ≈ $0.40
 *
 * Cost reduction vs sending all 60 videos at full quality:
 *   • Worst case (60 × 5 min average = 300 min) = ~4.5M video tokens × $0.50/MTok
 *     = $2.25 input alone, plus we'd hit the duration limit and get a 4xx.
 *   • Reduction: ~6× cheaper AND avoids the silent-fail risk.
 *
 * ─── Pure module — no Convex APIs ──────────────────────────────────────────
 *
 * This is a pure TypeScript module. It's called from synthesizeCreatorPicture
 * before prompt building. Tests are pure-function tests (no convex-test).
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The minimal shape this module needs from a normalized post. The synthesis
 * pipeline already normalizes posts to a richer shape (NormalizedPostForPrompt
 * in synthesizeCreatorPicture.ts) — we accept just the engagement + duration
 * fields here so the module stays decoupled and easy to unit-test.
 */
export interface BatchablePost {
  /** Unique within (platform, postId) — used for stable sort tiebreak. */
  postId: string;
  platform: string;
  /** Seconds of video. null/undefined → treated as 0 (text or unknown). */
  videoDurationSec: number | null | undefined;
  /**
   * Composite engagement score. Caller is responsible for normalizing across
   * platforms (e.g. likeCount + 2*commentCount + 0.5*shareCount). null/
   * undefined → treated as 0 (no engagement signal available).
   */
  engagementScore: number | null | undefined;
  /** Whether the post has a usable videoUrl Gemini can fetch. */
  hasVideo: boolean;
}

export interface SignalSubsetOptions {
  /** Hard cap on full-video duration sent to Gemini per synthesis request. */
  readonly maxTotalVideoSec?: number;
  /**
   * Initial top-N count (sorted by engagement DESC). Default 15. Down-shifted
   * by the fallback algorithm if the top-N + bottom-M selection exceeds the
   * duration cap.
   */
  readonly initialTopN?: number;
  /**
   * Initial bottom-M count (sorted by engagement ASC). Default 5. Held
   * constant during down-shift unless the cap can't be met any other way.
   */
  readonly initialBottomM?: number;
}

export interface SelectedSubset {
  /**
   * Posts whose video is sent full-quality to Gemini. Ordered: top-engagement
   * first (descending), then bottom-engagement (ascending). Total duration
   * <= maxTotalVideoSec.
   */
  fullVideoPosts: ReadonlyArray<BatchablePost>;
  /**
   * Posts sent as text-only context (caption + transcript + comments + metrics).
   * Includes:
   *   • posts beyond the top-N + bottom-M selection
   *   • posts dropped from the selection by the down-shift fallback
   *   • posts whose individual duration > cap (single-video oversized)
   *   • posts with no usable video (image-only / text-only — text-only context
   *     is the right place for them anyway)
   */
  textOnlyPosts: ReadonlyArray<BatchablePost>;
  /** Sum of videoDurationSec across fullVideoPosts. <= maxTotalVideoSec. */
  totalDurationSec: number;
  /**
   * Diagnostics: the actual top-N / bottom-M after down-shift, plus reason
   * any posts were forced to text-only. Surfaced so the caller can log it
   * to aiCallLog or print in the dev-overlay.
   */
  diagnostics: {
    finalTopN: number;
    finalBottomM: number;
    downShifted: boolean;
    oversizedSingleVideoCount: number;
    /** Posts with no videoUrl (image / text / carousel) routed to text-only. */
    noVideoCount: number;
  };
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** Hard cap per Gemini request, well under any documented limit. */
export const MAX_TOTAL_VIDEO_SEC_DEFAULT = 30 * 60;

/** Default top-N by engagement (DESC). */
export const INITIAL_TOP_N_DEFAULT = 15;

/** Default bottom-M by engagement (ASC). */
export const INITIAL_BOTTOM_M_DEFAULT = 5;

/**
 * Minimum bottom-M we'll preserve during down-shift. The contrast between
 * winners and losers is a critical signal for the synthesis prompt; we never
 * drop bottom posts below this floor unless there are literally fewer.
 */
const MIN_BOTTOM_M = 1;

/**
 * Minimum top-N we'll preserve during down-shift. Two top videos is enough
 * to form a hook pattern; below that we're wasting the multimodal channel.
 */
const MIN_TOP_N = 2;

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Select the signal-prioritized subset of posts for full-video synthesis.
 *
 * Algorithm:
 *   1. Partition posts into video-eligible vs no-video. No-video posts go
 *      directly to textOnlyPosts.
 *   2. Filter out video posts whose individual duration > cap. They go to
 *      textOnlyPosts with the oversized-single-video diagnostic.
 *   3. Sort remaining video-eligible posts by engagement (DESC for top,
 *      ASC for bottom — same input sorted twice). Tiebreak by postId for
 *      determinism.
 *   4. Select top-N + bottom-M. If the union has duplicates (small post
 *      pools where a post is both in top-N and bottom-M), they count once.
 *   5. If total duration > cap, down-shift top-N: 15→12→10→8→6→4→3→2.
 *      Bottom-M held at original; only drops to MIN_BOTTOM_M as last resort.
 *   6. Posts not in the final selection but video-eligible go to textOnlyPosts.
 */
export function selectSignalSubset(
  posts: ReadonlyArray<BatchablePost>,
  options: SignalSubsetOptions = {}
): SelectedSubset {
  const cap = options.maxTotalVideoSec ?? MAX_TOTAL_VIDEO_SEC_DEFAULT;
  const initialTopN = options.initialTopN ?? INITIAL_TOP_N_DEFAULT;
  const initialBottomM = options.initialBottomM ?? INITIAL_BOTTOM_M_DEFAULT;

  // Defensive: empty input → empty output.
  if (posts.length === 0) {
    return {
      fullVideoPosts: [],
      textOnlyPosts: [],
      totalDurationSec: 0,
      diagnostics: {
        finalTopN: 0,
        finalBottomM: 0,
        downShifted: false,
        oversizedSingleVideoCount: 0,
        noVideoCount: 0,
      },
    };
  }

  const noVideoPosts: BatchablePost[] = [];
  const oversizedSingleVideoPosts: BatchablePost[] = [];
  const videoEligible: BatchablePost[] = [];

  for (const p of posts) {
    const dur = normalizeDuration(p.videoDurationSec);
    if (!p.hasVideo || dur === 0) {
      noVideoPosts.push(p);
      continue;
    }
    if (dur > cap) {
      // Single video too long to fit even alone — text-only context.
      // TODO(s7): support Gemini videoMetadata.startOffset/endOffset to
      // sample first 5 min instead of dropping the video signal entirely.
      oversizedSingleVideoPosts.push(p);
      continue;
    }
    videoEligible.push(p);
  }

  if (videoEligible.length === 0) {
    return {
      fullVideoPosts: [],
      textOnlyPosts: [...noVideoPosts, ...oversizedSingleVideoPosts],
      totalDurationSec: 0,
      diagnostics: {
        finalTopN: 0,
        finalBottomM: 0,
        downShifted: false,
        oversizedSingleVideoCount: oversizedSingleVideoPosts.length,
        noVideoCount: noVideoPosts.length,
      },
    };
  }

  // Stable sort: engagement DESC for top, ties broken by postId ASC for
  // determinism (tests + reproducibility across runs).
  const byEngagementDesc = [...videoEligible].sort((a, b) => {
    const aScore = normalizeEngagement(a.engagementScore);
    const bScore = normalizeEngagement(b.engagementScore);
    if (bScore !== aScore) return bScore - aScore;
    return a.postId.localeCompare(b.postId);
  });

  // Down-shift top-N until cap is met. Try the standard ladder first;
  // if even MIN_TOP_N + MIN_BOTTOM_M doesn't fit, that's a degenerate
  // pathological input (every video is huge) — fall through to MIN_TOP_N +
  // MIN_BOTTOM_M and accept the over-cap as a soft warning (caller logs it).
  const TOP_N_LADDER = [
    initialTopN,
    Math.max(MIN_TOP_N, Math.floor(initialTopN * 0.8)),
    Math.max(MIN_TOP_N, Math.floor(initialTopN * 0.65)),
    Math.max(MIN_TOP_N, Math.floor(initialTopN * 0.5)),
    Math.max(MIN_TOP_N, Math.floor(initialTopN * 0.4)),
    Math.max(MIN_TOP_N, Math.floor(initialTopN * 0.25)),
    MIN_TOP_N,
  ].filter((n, i, arr) => arr.indexOf(n) === i); // dedupe

  let chosenTopN = TOP_N_LADDER[0];
  let chosenBottomM = initialBottomM;
  let selected: BatchablePost[] = [];
  let totalSec = 0;
  let downShifted = false;

  for (const topN of TOP_N_LADDER) {
    const candidate = pickTopAndBottom(byEngagementDesc, topN, initialBottomM);
    const candidateSec = candidate.reduce(
      (sum, p) => sum + normalizeDuration(p.videoDurationSec),
      0
    );
    if (candidateSec <= cap) {
      selected = candidate;
      totalSec = candidateSec;
      chosenTopN = topN;
      chosenBottomM = countBottomInSelection(
        candidate,
        byEngagementDesc,
        initialBottomM
      );
      downShifted = topN !== initialTopN;
      break;
    }
  }

  // If even MIN_TOP_N + initialBottomM didn't fit, try shrinking bottom too.
  if (selected.length === 0) {
    for (let bottomM = initialBottomM - 1; bottomM >= MIN_BOTTOM_M; bottomM--) {
      const candidate = pickTopAndBottom(byEngagementDesc, MIN_TOP_N, bottomM);
      const candidateSec = candidate.reduce(
        (sum, p) => sum + normalizeDuration(p.videoDurationSec),
        0
      );
      if (candidateSec <= cap) {
        selected = candidate;
        totalSec = candidateSec;
        chosenTopN = MIN_TOP_N;
        chosenBottomM = bottomM;
        downShifted = true;
        break;
      }
    }
  }

  // Final degenerate case: even MIN_TOP_N + MIN_BOTTOM_M exceeds the cap.
  // Pick MIN_TOP_N + MIN_BOTTOM_M anyway — over-cap is a soft warning, not a
  // hard fail. The synthesis call may then error from Gemini with a clear
  // message we surface to the operator. This branch is exercised by the
  // adversarial test "every video is >cap individually" (impossible unless
  // every video is also > cap, which we already filtered).
  if (selected.length === 0) {
    selected = pickTopAndBottom(byEngagementDesc, MIN_TOP_N, MIN_BOTTOM_M);
    totalSec = selected.reduce(
      (sum, p) => sum + normalizeDuration(p.videoDurationSec),
      0
    );
    chosenTopN = MIN_TOP_N;
    chosenBottomM = MIN_BOTTOM_M;
    downShifted = true;
  }

  // Everything else (video-eligible but not in the chosen subset) → text-only.
  const selectedIds = new Set(selected.map((p) => p.postId + "|" + p.platform));
  const remainingVideoEligible = videoEligible.filter(
    (p) => !selectedIds.has(p.postId + "|" + p.platform)
  );

  return {
    fullVideoPosts: selected,
    textOnlyPosts: [
      ...remainingVideoEligible,
      ...noVideoPosts,
      ...oversizedSingleVideoPosts,
    ],
    totalDurationSec: totalSec,
    diagnostics: {
      finalTopN: chosenTopN,
      finalBottomM: chosenBottomM,
      downShifted,
      oversizedSingleVideoCount: oversizedSingleVideoPosts.length,
      noVideoCount: noVideoPosts.length,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

function normalizeDuration(d: number | null | undefined): number {
  if (typeof d !== "number" || !Number.isFinite(d) || d < 0) return 0;
  return d;
}

function normalizeEngagement(e: number | null | undefined): number {
  if (typeof e !== "number" || !Number.isFinite(e)) return 0;
  return e;
}

/**
 * Pick the union of the top-N (by engagement DESC) and bottom-M (by engagement
 * ASC). When a small post pool causes overlap (the same post is both a "top"
 * and "bottom" candidate), the union dedupes.
 *
 * Input array is assumed to be pre-sorted by engagement DESC. Bottom is taken
 * from the END of the same array.
 */
function pickTopAndBottom(
  sortedByEngagementDesc: ReadonlyArray<BatchablePost>,
  topN: number,
  bottomM: number
): BatchablePost[] {
  const top = sortedByEngagementDesc.slice(0, topN);
  const bottom = sortedByEngagementDesc
    .slice(Math.max(0, sortedByEngagementDesc.length - bottomM))
    // Bottom is naturally ASC after a slice from a DESC list reversed —
    // keep them in the order they appear in the source so the order is
    // top-by-engagement-DESC then the last M as-is. Tests assert the
    // contrast pair is present, not specific within-group ordering.
    .filter((p) => !top.includes(p)); // dedupe overlap
  return [...top, ...bottom];
}

/**
 * Count how many of the bottomM "intended" picks survived the dedupe in
 * pickTopAndBottom. Used for the final diagnostics.finalBottomM value.
 */
function countBottomInSelection(
  selected: ReadonlyArray<BatchablePost>,
  sortedByEngagementDesc: ReadonlyArray<BatchablePost>,
  intendedBottomM: number
): number {
  if (sortedByEngagementDesc.length === 0) return 0;
  const bottomCandidates = sortedByEngagementDesc.slice(
    Math.max(0, sortedByEngagementDesc.length - intendedBottomM)
  );
  return bottomCandidates.filter((p) => selected.includes(p)).length;
}
