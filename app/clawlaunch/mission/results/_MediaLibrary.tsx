"use client";

/**
 * Media library — slideshows, images, and videos Maya made for posts (plus
 * the founder's source material), collapsed under Results. Live-subscribed;
 * new renders appear as her pipeline finishes them.
 */

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, Fold, Pill, timeAgo } from "../_components";

type MediaItem = {
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

const MEDIA_KIND_LABEL: Record<string, string> = {
  slide: "slideshow",
  image: "image",
  video: "video",
  screenshot: "screenshot",
  screen_recording: "recording",
};

function MediaTile({ item }: { item: MediaItem }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="relative aspect-square bg-ink">
        {item.url ? (
          item.isVideo ? (
            <video src={item.url} controls playsInline className="h-full w-full object-cover" />
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
            {MEDIA_KIND_LABEL[item.kind] ?? item.kind}
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

export function MediaLibrary() {
  const items = useQuery(api.gtmMaya.mediaAssets.getMyMediaAssets) as
    | MediaItem[]
    | undefined;
  const all = items ?? [];
  if (all.length === 0) return null;
  const made = all.filter((a) => a.generatedByMaya);
  const source = all.filter((a) => !a.generatedByMaya);

  return (
    <Fold label="Media Maya made" count={all.length}>
      {made.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {made.map((a) => (
            <MediaTile key={a.id} item={a} />
          ))}
        </div>
      ) : null}
      {source.length > 0 ? (
        <>
          <p className="mb-2 mt-5 font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint">
            Your source material
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {source.map((a) => (
              <MediaTile key={a.id} item={a} />
            ))}
          </div>
        </>
      ) : null}
    </Fold>
  );
}
