/**
 * Library tab: thumbnail grid of mediaAssets.
 *
 * Per Service Sprint Plan § 12.4 Library tab:
 *   - thumbnail + primarySubject + visualQuality badge + serviceCategory
 *     chip + usageHistory count
 *   - Filter via parent: serviceCategory, visualQuality, posting status,
 *     source channel, has-CRM-linkage
 *
 * Pure render. Click → parent opens AssetDetailPanel.
 */

import { Camera } from "lucide-react";
import type { AssetSummary } from "@/convex/queries/business/posts";

export interface LibraryGridProps {
  assets: AssetSummary[];
  onSelect?: (assetId: AssetSummary["_id"]) => void;
  testId?: string;
}

const QUALITY_BADGE: Record<
  AssetSummary["catalog"]["visualQuality"],
  string
> = {
  excellent: "bg-lime/15 text-lime border-lime/30",
  good: "bg-sky-300/15 text-sky-200 border-sky-300/30",
  fair: "bg-amber-300/15 text-amber-200 border-amber-300/30",
  poor: "bg-rose-300/15 text-rose-200 border-rose-300/30",
};

export function LibraryGrid({ assets, onSelect, testId }: LibraryGridProps) {
  if (assets.length === 0) {
    return (
      <div
        data-testid="biz-library-empty"
        className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--hairline-strong)] bg-ink-2/40 px-6 py-10 text-center text-sm text-paper-dim"
      >
        <Camera className="h-5 w-5 text-paper-faint" aria-hidden />
        <span>No assets yet — text Maya a job photo to start your library.</span>
      </div>
    );
  }
  return (
    <div
      data-testid={testId ?? "biz-library-grid"}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
    >
      {assets.map((a) => (
        <button
          key={a._id}
          type="button"
          data-testid="biz-library-tile"
          onClick={() => onSelect?.(a._id)}
          className="group flex flex-col gap-2 overflow-hidden rounded-xl border border-[var(--hairline)] bg-ink-2 text-left transition-colors hover:border-[var(--hairline-strong)]"
        >
          <div className="relative aspect-square overflow-hidden bg-ink-3">
            {a.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element -- R2 signed URLs
              <img
                src={a.storageUrl}
                alt={a.catalog.primarySubject}
                className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-paper-faint">
                {a.mimeType}
              </div>
            )}
            <span
              className={`absolute left-2 top-2 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${QUALITY_BADGE[a.catalog.visualQuality]}`}
            >
              {a.catalog.visualQuality}
            </span>
          </div>
          <div className="flex flex-col gap-1 px-2.5 pb-3">
            <span className="truncate text-sm text-paper">
              {a.catalog.primarySubject}
            </span>
            <div className="flex items-center justify-between text-[10px] text-paper-faint">
              <span className="rounded-full bg-ink-3 px-2 py-0.5 font-mono uppercase tracking-wider">
                {a.catalog.serviceCategory}
              </span>
              <span>{a.usageHistory.length} use</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
