"use client";

/**
 * Assets — the founder-facing gallery of every visual Maya has made for them:
 * slideshows (nano-banana), designed images + videos (Creatify), all grounded
 * in the founder's REAL product. Plus the source screenshots/recordings the
 * founder supplied. Today the creative only buzzed Telegram and vanished; this
 * is the one place to see / reuse / download it — and what makes the Growth
 * (images) and Studio (video) creative tangible.
 *
 * Live subscription via useQuery(getMyMediaAssets) — new renders/jobs appear
 * automatically. Auth-scoped server-side (the operator's own agent only).
 */

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Shell, Section, Card, Pill, Loading, Empty, timeAgo } from "../_components";

type Item = {
  id: string;
  kind: string;
  source: string;
  isVideo: boolean;
  url: string | null;
  label: string | null;
  createdAt: number;
  groundedCount: number;
  generatedByMaya: boolean;
};

const KIND_LABEL: Record<string, string> = {
  slide: "slideshow",
  image: "image",
  video: "video",
  screenshot: "screenshot",
  screen_recording: "recording",
};

function Tile({ item }: { item: Item }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="relative aspect-square bg-ink">
        {item.url ? (
          item.isVideo ? (
            <video
              src={item.url}
              controls
              playsInline
              className="h-full w-full object-cover"
            />
          ) : (
            <a href={item.url} target="_blank" rel="noreferrer" title="Open full size">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.url}
                alt={item.label ?? item.kind}
                className="h-full w-full object-cover"
              />
            </a>
          )
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center font-mono text-[11px] text-paper-faint">
            preview still rendering…
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="flex items-center gap-2">
          <Pill tone={item.generatedByMaya ? "lime" : "paper"}>
            {KIND_LABEL[item.kind] ?? item.kind}
          </Pill>
          {item.groundedCount > 0 ? (
            <span
              className="font-mono text-[10px] text-paper-faint"
              title="Built from your real screenshots"
            >
              grounded ×{item.groundedCount}
            </span>
          ) : null}
        </div>
        <span className="font-mono text-[10px] text-paper-faint">
          {timeAgo(item.createdAt)}
        </span>
      </div>
    </Card>
  );
}

const FILTERS = ["all", "images", "videos"] as const;
type Filter = (typeof FILTERS)[number];

export default function AssetsPage() {
  const items = useQuery(api.gtmMaya.mediaAssets.getMyMediaAssets) as
    | Item[]
    | undefined;
  const [filter, setFilter] = useState<Filter>("all");

  if (items === undefined) return <Loading />;

  if (items.length === 0) {
    return (
      <Shell
        title="Assets"
        subtitle="Every image, slideshow, and video Maya makes for you — built from your real product."
      >
        <Empty
          title="No assets yet"
          body="As Maya builds your plan she'll make on-brand slideshows and images (and, on Studio, videos) from your real product. They all land here — preview, reuse, and download from one place."
        />
      </Shell>
    );
  }

  const byFilter = (arr: Item[]) =>
    arr.filter((i) =>
      filter === "all" ? true : filter === "videos" ? i.isVideo : !i.isVideo
    );

  const made = byFilter(items.filter((i) => i.generatedByMaya));
  const source = byFilter(items.filter((i) => !i.generatedByMaya));

  return (
    <Shell
      title="Assets"
      subtitle="Every image, slideshow, and video Maya makes for you — built from your real product, never a fabricated UI."
    >
      <div className="mb-6 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 font-mono text-xs uppercase tracking-wide transition ${
              filter === f
                ? "bg-lime text-[#0a0a0a]"
                : "bg-paper/10 text-paper-dim hover:bg-paper/20"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {made.length > 0 ? (
        <Section title="Made by Maya" count={made.length}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {made.map((i) => (
              <Tile key={i.id} item={i} />
            ))}
          </div>
        </Section>
      ) : null}

      {source.length > 0 ? (
        <Section title="Your source material" count={source.length}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {source.map((i) => (
              <Tile key={i.id} item={i} />
            ))}
          </div>
        </Section>
      ) : null}

      {made.length === 0 && source.length === 0 ? (
        <Empty
          title={`No ${filter}`}
          body="Nothing matches this filter yet — try another."
        />
      ) : null}
    </Shell>
  );
}
