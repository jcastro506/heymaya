/**
 * Performance screen — filterable post grid + click-through detail panel.
 *
 * Mobile-first: 2 columns at 390px, 3 at sm, 4 at lg. Cards use a 9:16 aspect
 * for vertical-video native (TikTok/Reels/Shorts) and fall back to 1:1 for
 * carousel/text/image posts.
 *
 * Filters apply server-side via the Convex query args. The hook-pattern chip
 * row filters in the client because we don't denormalize the pattern field
 * onto `posts` — see convex/performance.ts for the trade-off explanation.
 *
 * Detail panel (Sheet from the right on desktop, full-screen modal on mobile)
 * shows: video player, transcript placeholder, comments placeholder, Maya's
 * hook breakdown, and comparable posts.
 */

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ArrowLeft,
  Eye,
  Heart,
  MessageCircle,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { Section } from "@/components/creator/Section";
import { StageBanner, type StageContext } from "@/components/creator/stage";

type Platform = "tiktok" | "instagram" | "youtube" | "linkedin" | "x";
type MediaType = "video" | "image" | "carousel" | "text";

const PLATFORMS: ReadonlyArray<{ id: Platform; label: string }> = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "youtube", label: "YouTube" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "x", label: "X" },
];

const MEDIA_TYPES: ReadonlyArray<{ id: MediaType; label: string }> = [
  { id: "video", label: "Video" },
  { id: "image", label: "Image" },
  { id: "carousel", label: "Carousel" },
  { id: "text", label: "Text" },
];

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PAGE_SIZE = 30;

export default function PerformancePage() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [mediaType, setMediaType] = useState<MediaType | null>(null);
  const [dayOfWeek, setDayOfWeek] = useState<number | null>(null);
  const [hookFilter, setHookFilter] = useState<string | null>(null);
  const [openPostId, setOpenPostId] = useState<Id<"posts"> | null>(null);

  const postsResult = useQuery(api.performance.postsList, {
    platform: platform ?? undefined,
    mediaType: mediaType ?? undefined,
    dayOfWeek: dayOfWeek ?? undefined,
    paginationOpts: { numItems: PAGE_SIZE, cursor: null },
  });
  const hooks = useQuery(api.performance.hookLibrary, {
    paginationOpts: { numItems: 12, cursor: null },
  });
  // ─── Stage-aware adaptive product (Agent B, 2026-04-26) ──────────────────
  // The Performance page is mostly stage-agnostic — every creator wants to
  // see what landed. But just-starting creators don't yet have enough
  // posts for day-of-week or comparative-analytics filters to mean
  // anything (n<5 per bucket = noise), so we simplify the chrome for them
  // and lead with hook performance instead. Building+ creators see the
  // full filter set.
  const stageCtx = useQuery(api.businessReadiness.creatorStage);
  const isJustStarting = stageCtx?.stage === "just-starting";

  // Client-side hook-pattern filter — see convex/performance.ts for why.
  const visiblePosts = useMemo(() => {
    if (!postsResult) return [];
    if (!hookFilter) return postsResult.page;
    return postsResult.page.filter(
      (p) => p.mayaAnnotation?.hookPattern === hookFilter
    );
  }, [postsResult, hookFilter]);

  const lastPullTs = useMemo(() => {
    if (!postsResult || postsResult.page.length === 0) return null;
    // The most-recent `_creationTime` across the page is a reasonable proxy
    // for "last time anything in the active window was pulled."
    return Math.max(...postsResult.page.map((p) => p._creationTime));
  }, [postsResult]);

  const hasFilters =
    platform !== null ||
    mediaType !== null ||
    dayOfWeek !== null ||
    hookFilter !== null;

  return (
    <div className="pt-2 sm:pt-6">
      {/*
        Stage-aware: just-starting creators see a top-of-page banner reminding
        them that comparative analytics are sparse by design at their stage.
        Building+ creators don't get this banner — the filters are enough chrome.
      */}
      {isJustStarting && stageCtx && (
        <Section
          eyebrow="§ Performance · early-stage view"
          title="Performance, simplified"
          caption="At your stage, the signal in any one post matters more than cross-post averages. Maya is highlighting hook patterns from your top 5 — comparative breakdowns unlock as your post count grows."
          variant="tight"
        >
          <StageBanner ctx={stageCtx as StageContext} variant="compact" />
        </Section>
      )}
      <Section
        eyebrow="§ Performance"
        title="What landed, what didn't"
        caption="Every post Maya has pulled, ranked by recency. Hover any card to see her read; tap to open the breakdown."
        rightSlot={
          <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
            {lastPullTs ? `Last pull ${timeAgo(lastPullTs)}` : "—"}
          </span>
        }
        variant="tight"
      >
        {/*
          Filter chip rows. just-starting creators see Platform + Format only —
          day-of-week and hook-pattern slicing on n<5 posts is noise more than
          signal. Building+ creators see the full set.
        */}
        <div className="space-y-3 pt-2">
          <ChipRow
            label="Platform"
            options={PLATFORMS.map((p) => ({ id: p.id, label: p.label }))}
            value={platform}
            onChange={(v) => setPlatform(v as Platform | null)}
          />
          <ChipRow
            label="Format"
            options={MEDIA_TYPES.map((m) => ({ id: m.id, label: m.label }))}
            value={mediaType}
            onChange={(v) => setMediaType(v as MediaType | null)}
          />
          {!isJustStarting && (
            <ChipRow
              label="Day"
              options={DOW_LABELS.map((d, i) => ({ id: String(i), label: d }))}
              value={dayOfWeek === null ? null : String(dayOfWeek)}
              onChange={(v) => setDayOfWeek(v === null ? null : Number(v))}
            />
          )}
          {!isJustStarting && hooks && hooks.page.length > 0 && (
            <ChipRow
              label="Hook"
              options={hooks.page.map((h) => ({
                id: h.pattern,
                label: h.pattern.length > 18 ? `${h.pattern.slice(0, 18)}…` : h.pattern,
              }))}
              value={hookFilter}
              onChange={(v) => setHookFilter(v)}
            />
          )}
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setPlatform(null);
                setMediaType(null);
                setDayOfWeek(null);
                setHookFilter(null);
              }}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-paper-faint hover:text-paper"
            >
              <RefreshCw className="h-3 w-3" />
              Clear filters
            </button>
          )}
        </div>
      </Section>

      <Section
        title=""
        eyebrow={
          postsResult
            ? `${visiblePosts.length} of ${postsResult.page.length} posts shown`
            : "Loading…"
        }
      >
        {postsResult === undefined ? (
          <GridSkeleton />
        ) : visiblePosts.length === 0 ? (
          <EmptyGrid hasFilters={hasFilters} />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visiblePosts.map((p) => (
              <li key={p._id}>
                <PostCard post={p} onOpen={() => setOpenPostId(p._id)} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {openPostId && (
        <PostDetail
          postId={openPostId}
          onClose={() => setOpenPostId(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Filter chip row                                                             */
/* -------------------------------------------------------------------------- */

interface ChipRowProps {
  label: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  value: string | null;
  onChange: (id: string | null) => void;
}

function ChipRow({ label, options, value, onChange }: ChipRowProps) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-2 w-16 shrink-0 font-mono text-[11px] uppercase tracking-widest text-paper-faint">
        {label}
      </span>
      <div className="-mx-1 flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(active ? null : o.id)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? "border-lime bg-lime text-ink"
                  : "border-[var(--hairline-strong)] text-paper-dim hover:text-paper"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Post card                                                                   */
/* -------------------------------------------------------------------------- */

interface PostRow {
  _id: Id<"posts">;
  _creationTime: number;
  platform: Platform;
  caption: string;
  thumbnailUrl?: string;
  mediaType: MediaType;
  postedAt: number;
  mayaAnnotation?: {
    hookPattern: string;
    whyItWorked: string;
    retentionScore?: number;
  };
}

function PostCard({
  post,
  onOpen,
}: {
  post: PostRow;
  onOpen: () => void;
}) {
  const isVertical = post.mediaType === "video";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative block w-full overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 text-left transition-colors hover:border-[var(--paper-faint)]"
    >
      <div
        className="relative w-full bg-ink-3"
        style={{ aspectRatio: isVertical ? "9 / 16" : "1 / 1" }}
      >
        {post.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- justification: thumbnails arrive from arbitrary social CDNs (TikTok/IG/YT); adding every host to next.config remotePatterns just for the v0 grid is more lock-in than benefit
          <img
            src={post.thumbnailUrl}
            alt={post.caption.slice(0, 80) || "Post thumbnail"}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-paper-faint">
            <span className="font-mono text-[10px] uppercase tracking-widest">
              {post.mediaType}
            </span>
          </div>
        )}
        <div className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-white backdrop-blur">
          {post.platform}
        </div>
        {post.mayaAnnotation && (
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/20 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-lime">
              <Sparkles className="h-3 w-3" />
              Maya
            </div>
            <p className="mt-1 line-clamp-3 text-xs leading-snug text-white">
              {post.mayaAnnotation.whyItWorked}
            </p>
          </div>
        )}
      </div>
      <div className="px-3 py-2.5">
        <p className="line-clamp-2 text-xs leading-snug text-paper">
          {post.caption || <span className="text-paper-faint">No caption</span>}
        </p>
        <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-paper-faint">
          <span>{formatPostedAt(post.postedAt)}</span>
          {post.mayaAnnotation?.retentionScore !== undefined && (
            <span className="text-lime">
              {Math.round(post.mayaAnnotation.retentionScore * 100)}% ret
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Detail panel                                                                */
/* -------------------------------------------------------------------------- */

function PostDetail({
  postId,
  onClose,
}: {
  postId: Id<"posts">;
  onClose: () => void;
}) {
  const detail = useQuery(api.performance.postDetail, { postId });
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Post detail"
      className="fixed inset-0 z-40 flex items-end justify-end bg-black/60 backdrop-blur-sm sm:items-stretch"
    >
      <button
        type="button"
        aria-label="Close detail"
        onClick={onClose}
        className="absolute inset-0"
      />
      <aside className="relative ml-auto flex h-[92vh] w-full flex-col overflow-y-auto rounded-t-3xl border-t border-[var(--hairline-strong)] bg-ink-2 sm:h-full sm:max-w-xl sm:rounded-l-3xl sm:rounded-tr-none sm:border-l sm:border-t-0">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--hairline)] bg-ink-2/95 px-5 py-3 backdrop-blur">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 text-sm text-paper-dim hover:text-paper"
          >
            <ArrowLeft className="h-4 w-4 sm:hidden" />
            <X className="hidden h-4 w-4 sm:inline" />
            Close
          </button>
          <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
            Post detail
          </span>
        </div>

        {detail === undefined ? (
          <div className="space-y-4 p-5">
            <div className="aspect-[9/16] w-full rounded-2xl bg-ink-3" />
            <div className="h-4 w-1/2 rounded-full bg-ink-3" />
            <div className="h-20 w-full rounded-2xl bg-ink-3" />
          </div>
        ) : detail === null ? (
          <div className="p-6">
            <p className="font-display text-xl text-paper">Post not found.</p>
            <p className="mt-2 text-sm text-paper-dim">
              Either the post was removed, or it doesn&rsquo;t belong to your
              account. Maya only ever returns your own data here.
            </p>
          </div>
        ) : (
          <PostDetailBody
            post={detail.post}
            metrics={detail.metrics}
            comparable={detail.comparable}
          />
        )}
      </aside>
    </div>
  );
}

function PostDetailBody({
  post,
  metrics,
  comparable,
}: {
  post: PostRow & { videoUrl?: string; url: string };
  metrics: ReadonlyArray<{
    _id: string;
    ts: number;
    viewCount?: number;
    likeCount?: number;
    commentCount?: number;
    saveCount?: number;
    shareCount?: number;
  }>;
  comparable: ReadonlyArray<PostRow>;
}) {
  const latest = metrics.at(-1);
  return (
    <div className="space-y-6 p-5">
      {/* Player or thumbnail */}
      <div className="overflow-hidden rounded-2xl border border-[var(--hairline)] bg-black">
        {post.videoUrl ? (
          <video
            controls
            preload="metadata"
            poster={post.thumbnailUrl}
            className="aspect-[9/16] w-full bg-black"
            src={post.videoUrl}
          />
        ) : post.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- justification: detail panel is offscreen until opened; Next/Image's intrinsic-size requirement does not fit external CDN URLs without remotePatterns config
          <img
            src={post.thumbnailUrl}
            alt={post.caption}
            className="aspect-[9/16] w-full object-cover"
          />
        ) : (
          <div className="aspect-[9/16] grid w-full place-items-center text-paper-faint">
            <span className="font-mono text-[10px] uppercase tracking-widest">
              {post.mediaType}
            </span>
          </div>
        )}
      </div>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-paper-faint">
          <span className="rounded-full bg-ink-3 px-2 py-0.5">{post.platform}</span>
          <span>{formatPostedAt(post.postedAt)}</span>
        </div>
        <p className="mt-3 text-base leading-relaxed text-paper">
          {post.caption || <span className="text-paper-faint">No caption.</span>}
        </p>
        <a
          href={post.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs text-paper-dim underline decoration-lime decoration-2 underline-offset-4 hover:text-lime"
        >
          Open original
        </a>
      </div>

      {/* Latest metrics */}
      <div className="grid grid-cols-3 gap-2">
        <MetricTile icon={Eye} label="Views" value={latest?.viewCount} />
        <MetricTile icon={Heart} label="Likes" value={latest?.likeCount} />
        <MetricTile
          icon={MessageCircle}
          label="Comments"
          value={latest?.commentCount}
        />
      </div>

      {/* Maya's hook breakdown */}
      {post.mayaAnnotation ? (
        <div className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-3 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-paper-faint">
            <Sparkles className="h-3.5 w-3.5 text-lime" />
            Maya&rsquo;s read
          </div>
          <p className="mt-3 font-display text-xl text-paper">
            Hook · {post.mayaAnnotation.hookPattern}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-paper-dim">
            {post.mayaAnnotation.whyItWorked}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--hairline-strong)] p-5">
          <p className="text-sm text-paper-dim">
            Maya hasn&rsquo;t analyzed this post yet — annotation lands after
            the post-publish reaction completes (Pro+).
          </p>
        </div>
      )}

      {/* Transcript / comments placeholders. Sprint 5 wires the real pulls. */}
      <details className="rounded-2xl border border-[var(--hairline)] bg-ink-2 p-4">
        <summary className="cursor-pointer text-sm text-paper-dim">
          Transcript <span className="text-paper-faint">(coming Sprint 5)</span>
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-paper-faint">
          Transcript pull lands with the comment-triage cron in Sprint 5.
        </p>
      </details>
      <details className="rounded-2xl border border-[var(--hairline)] bg-ink-2 p-4">
        <summary className="cursor-pointer text-sm text-paper-dim">
          Top comments <span className="text-paper-faint">(coming Sprint 5)</span>
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-paper-faint">
          Comment triage rows arrive twice daily once the cron fires.
        </p>
      </details>

      {/* Comparable posts */}
      {comparable.length > 0 && (
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
            You have {comparable.length} other{" "}
            {comparable.length === 1 ? "post" : "posts"} with the &ldquo;
            {post.mayaAnnotation?.hookPattern}&rdquo; hook
          </p>
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {comparable.map((c) => (
              <li
                key={c._id}
                className="overflow-hidden rounded-xl border border-[var(--hairline)] bg-ink-3"
              >
                {c.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- justification: same external-CDN reasoning as the grid above
                  <img
                    src={c.thumbnailUrl}
                    alt={c.caption.slice(0, 80) || "Comparable post"}
                    className="aspect-[9/16] w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="aspect-[9/16] grid w-full place-items-center text-paper-faint">
                    <span className="font-mono text-[10px] uppercase tracking-widest">
                      {c.mediaType}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: number;
}) {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] bg-ink-3 p-3">
      <div className="flex items-center gap-1.5 text-paper-faint">
        <Icon className="h-3.5 w-3.5" />
        <span className="font-mono text-[10px] uppercase tracking-widest">
          {label}
        </span>
      </div>
      <div className="mt-2 font-display text-2xl text-paper">
        {value === undefined ? "—" : compactNumber(value)}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty / loading                                                             */
/* -------------------------------------------------------------------------- */

function GridSkeleton() {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <li
          key={i}
          className="aspect-[9/16] rounded-2xl border border-[var(--hairline)] bg-ink-2"
        />
      ))}
    </ul>
  );
}

function EmptyGrid({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--hairline-strong)] bg-ink-2/40 p-8 text-center">
      {hasFilters ? (
        <>
          <p className="font-display text-xl text-paper">
            Nothing matches those filters.
          </p>
          <p className="mt-2 text-sm text-paper-dim">
            Loosen one of the chips above.
          </p>
        </>
      ) : (
        <>
          <p className="font-display text-xl text-paper">
            No posts pulled yet.
          </p>
          <p className="mt-2 text-sm text-paper-dim">
            Maya pulls on a 30-minute delta cycle. Add a handle from{" "}
            <Link href="/profile" className="text-lime underline decoration-lime underline-offset-4">
              Profile
            </Link>{" "}
            if you haven&rsquo;t yet.
          </p>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(ts: number): string {
  const diffMin = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatPostedAt(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diffDay = (now - ts) / (24 * 60 * 60 * 1000);
  if (diffDay < 1) return "today";
  if (diffDay < 7) return `${Math.round(diffDay)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
