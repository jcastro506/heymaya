/**
 * Per-asset detail panel for the Library tab.
 *
 * Per Service Sprint Plan § 12.4: full catalog, usage history, manual
 * override, archive action.
 *
 * Pure render — archive + manual-override callbacks are parent-supplied.
 */

"use client";

import { Archive, X } from "lucide-react";
import type { AssetSummary } from "@/convex/queries/business/posts";

export interface AssetDetailPanelProps {
  asset: AssetSummary;
  onClose: () => void;
  onArchive?: () => void;
}

export function AssetDetailPanel({
  asset,
  onClose,
  onArchive,
}: AssetDetailPanelProps) {
  return (
    <aside
      data-testid="biz-asset-detail-panel"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-[var(--hairline)] bg-ink-2 shadow-[ -16px_0_40px_-20px_rgba(0,0,0,0.6)] sm:max-w-md"
    >
      <header className="flex items-center justify-between border-b border-[var(--hairline)] px-6 py-5">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
            Asset · {asset.catalog.serviceCategory}
          </span>
          <h3 className="mt-1 font-display text-2xl tracking-tight text-paper">
            {asset.catalog.primarySubject}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail"
          className="rounded-full border border-[var(--hairline)] p-2 text-paper-dim transition-colors hover:bg-ink-3"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
        {asset.mimeType.startsWith("image/") && (
          // eslint-disable-next-line @next/next/no-img-element -- R2 signed URLs
          <img
            src={asset.storageUrl}
            alt={asset.catalog.primarySubject}
            className="w-full rounded-xl border border-[var(--hairline)]"
          />
        )}
        <section className="space-y-2 text-sm text-paper-dim">
          <div className="flex justify-between">
            <span className="text-paper-faint">Quality</span>
            <span className="text-paper">
              {asset.catalog.visualQuality}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-paper-faint">Source</span>
            <span>{asset.source}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-paper-faint">Received</span>
            <span>{new Date(asset.receivedAt).toLocaleDateString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-paper-faint">Bytes</span>
            <span>{(asset.storageBytes / 1024).toFixed(1)} KB</span>
          </div>
        </section>
        <section>
          <h4 className="mb-2 font-display text-base text-paper">
            Maya's notes
          </h4>
          <p className="text-sm text-paper-dim">{asset.catalog.framingNotes}</p>
          {asset.catalog.captionDraft && (
            <p className="mt-3 rounded-xl bg-ink-3/60 p-3 text-sm text-paper">
              {asset.catalog.captionDraft}
            </p>
          )}
        </section>
        {asset.catalog.suggestedUses.length > 0 && (
          <section>
            <h4 className="mb-2 font-display text-base text-paper">
              Suggested uses
            </h4>
            <ul className="space-y-1 text-sm text-paper-dim">
              {asset.catalog.suggestedUses.map((s, i) => (
                <li key={i}>• {s}</li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h4 className="mb-2 font-display text-base text-paper">
            Usage history
          </h4>
          {asset.usageHistory.length === 0 ? (
            <p className="text-sm text-paper-faint">Not posted yet.</p>
          ) : (
            <ul className="space-y-1 text-sm text-paper-dim">
              {asset.usageHistory.map((u, i) => (
                <li key={i} className="flex justify-between">
                  <span className="font-mono text-xs uppercase">
                    {u.platform}
                  </span>
                  <span>{new Date(u.postedAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {onArchive && asset.archivedAt === undefined && (
          <button
            type="button"
            onClick={onArchive}
            data-testid="biz-asset-archive-btn"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline-strong)] px-4 py-2 text-xs text-paper-dim transition-colors hover:bg-ink-3"
          >
            <Archive className="h-3.5 w-3.5" /> Archive asset
          </button>
        )}
        {asset.archivedAt !== undefined && (
          <p className="text-xs text-paper-faint">
            Archived {new Date(asset.archivedAt).toLocaleDateString()}.
          </p>
        )}
      </div>
    </aside>
  );
}
