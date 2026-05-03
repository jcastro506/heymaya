export type TikTokWatchMode =
  | "metadata_only"
  | "first_3_seconds"
  | "sampled_frames"
  | "full_video";

export interface TikTokPostCandidate {
  id: string;
  createdAt: number;
  durationSec: number | null;
  hasVideo: boolean;
  caption?: string;
  formatKey?: string;
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
  };
}

export type SampleReason = "top" | "weak" | "recent" | "format_outlier";

export interface SelectedTikTokSample {
  post: TikTokPostCandidate;
  reasons: ReadonlyArray<SampleReason>;
  watchMode: TikTokWatchMode;
}

export interface OnboardingVideoSamplingOptions {
  maxSelected?: number;
  topCount?: number;
  weakCount?: number;
  recentCount?: number;
  allowFullVideo?: boolean;
  maxFullVideoSec?: number;
}

export interface OnboardingVideoSamplingResult {
  selected: ReadonlyArray<SelectedTikTokSample>;
  diagnostics: {
    inputCount: number;
    maxSelected: number;
    topCount: number;
    weakCount: number;
    recentCount: number;
    fullVideoCount: number;
    metadataOnlyCount: number;
  };
}

const DEFAULT_MAX_SELECTED = 8;
const DEFAULT_TOP_COUNT = 3;
const DEFAULT_WEAK_COUNT = 2;
const DEFAULT_RECENT_COUNT = 2;
const DEFAULT_MAX_FULL_VIDEO_SEC = 35;

export function selectOnboardingVideoSamples(
  posts: ReadonlyArray<TikTokPostCandidate>,
  options: OnboardingVideoSamplingOptions = {}
): OnboardingVideoSamplingResult {
  const maxSelected = options.maxSelected ?? DEFAULT_MAX_SELECTED;
  const topCount = options.topCount ?? DEFAULT_TOP_COUNT;
  const weakCount = options.weakCount ?? DEFAULT_WEAK_COUNT;
  const recentCount = options.recentCount ?? DEFAULT_RECENT_COUNT;
  const selected = new Map<string, SelectedTikTokSample>();

  const add = (post: TikTokPostCandidate, reason: SampleReason) => {
    if (selected.size >= maxSelected && !selected.has(post.id)) return;
    const existing = selected.get(post.id);
    if (existing) {
      if (!existing.reasons.includes(reason)) {
        selected.set(post.id, {
          ...existing,
          reasons: [...existing.reasons, reason],
        });
      }
      return;
    }
    selected.set(post.id, {
      post,
      reasons: [reason],
      watchMode: chooseWatchMode(post, options),
    });
  };

  const byScoreDesc = [...posts].sort((a, b) => {
    const diff = scorePost(b) - scorePost(a);
    return diff !== 0 ? diff : b.createdAt - a.createdAt;
  });
  const byScoreAsc = [...posts].sort((a, b) => {
    const diff = scorePost(a) - scorePost(b);
    return diff !== 0 ? diff : b.createdAt - a.createdAt;
  });
  const byRecent = [...posts].sort((a, b) => b.createdAt - a.createdAt);

  for (const post of byScoreDesc.slice(0, topCount)) add(post, "top");
  for (const post of byScoreAsc.slice(0, weakCount)) add(post, "weak");
  for (const post of byRecent.slice(0, recentCount)) add(post, "recent");

  const outlier = findFormatOutlier(posts, selected);
  if (outlier) add(outlier, "format_outlier");

  const ordered = [...selected.values()].sort((a, b) => {
    const priority = highestReasonPriority(a) - highestReasonPriority(b);
    return priority !== 0 ? priority : b.post.createdAt - a.post.createdAt;
  });
  const fullVideoCount = ordered.filter((s) => s.watchMode === "full_video").length;
  const metadataOnlyCount = ordered.filter(
    (s) => s.watchMode === "metadata_only"
  ).length;

  return {
    selected: ordered,
    diagnostics: {
      inputCount: posts.length,
      maxSelected,
      topCount: Math.min(topCount, posts.length),
      weakCount: Math.min(weakCount, posts.length),
      recentCount: Math.min(recentCount, posts.length),
      fullVideoCount,
      metadataOnlyCount,
    },
  };
}

export function chooseWatchMode(
  post: TikTokPostCandidate,
  options: Pick<
    OnboardingVideoSamplingOptions,
    "allowFullVideo" | "maxFullVideoSec"
  > = {}
): TikTokWatchMode {
  const duration = normalizeDuration(post.durationSec);
  if (!post.hasVideo || duration === 0) return "metadata_only";

  if (
    options.allowFullVideo === true &&
    duration <= (options.maxFullVideoSec ?? DEFAULT_MAX_FULL_VIDEO_SEC)
  ) {
    return "full_video";
  }

  if (duration <= 35) return "first_3_seconds";
  return "sampled_frames";
}

export function scorePost(post: TikTokPostCandidate): number {
  const views = normalizeMetric(post.metrics.views);
  const likes = normalizeMetric(post.metrics.likes);
  const comments = normalizeMetric(post.metrics.comments);
  const shares = normalizeMetric(post.metrics.shares);
  return views + likes * 10 + comments * 25 + shares * 35;
}

function findFormatOutlier(
  posts: ReadonlyArray<TikTokPostCandidate>,
  selected: ReadonlyMap<string, SelectedTikTokSample>
): TikTokPostCandidate | null {
  const unselected = posts.filter((post) => !selected.has(post.id));
  if (unselected.length === 0) return null;

  const bucketCounts = new Map<string, number>();
  for (const post of posts) {
    const bucket = formatBucket(post);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }

  const rare = [...unselected].sort((a, b) => {
    const rareDiff = (bucketCounts.get(formatBucket(a)) ?? 0) -
      (bucketCounts.get(formatBucket(b)) ?? 0);
    if (rareDiff !== 0) return rareDiff;
    return durationDistanceFromMedian(b, posts) - durationDistanceFromMedian(a, posts);
  });
  return rare[0] ?? null;
}

function formatBucket(post: TikTokPostCandidate): string {
  if (post.formatKey) return `format:${post.formatKey}`;
  const duration = normalizeDuration(post.durationSec);
  if (duration <= 15) return "duration:short";
  if (duration <= 45) return "duration:medium";
  return "duration:long";
}

function durationDistanceFromMedian(
  post: TikTokPostCandidate,
  posts: ReadonlyArray<TikTokPostCandidate>
): number {
  const durations = posts
    .map((p) => normalizeDuration(p.durationSec))
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  if (durations.length === 0) return 0;
  const median = durations[Math.floor(durations.length / 2)] ?? 0;
  return Math.abs(normalizeDuration(post.durationSec) - median);
}

function highestReasonPriority(sample: SelectedTikTokSample): number {
  const rank: Record<SampleReason, number> = {
    top: 0,
    weak: 1,
    recent: 2,
    format_outlier: 3,
  };
  return Math.min(...sample.reasons.map((r) => rank[r]));
}

function normalizeMetric(value: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function normalizeDuration(value: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
}
