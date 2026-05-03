/**
 * Posts screen — `/biz/posts`. Two tabs: Calendar (default) + Library.
 *
 * Per Service Sprint Plan § 12.4 + § 10.5.
 */

"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Camera } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Section } from "@/components/business/Section";
import { EmptyState } from "@/components/business/EmptyState";
import { PostCalendar } from "@/components/business/PostCalendar";
import { LibraryGrid } from "@/components/business/LibraryGrid";
import { AssetDetailPanel } from "@/components/business/AssetDetailPanel";

type Tab = "calendar" | "library";

export default function PostsPage() {
  const [tab, setTab] = useState<Tab>("calendar");
  const [selectedAssetId, setSelectedAssetId] =
    useState<Id<"mediaAssets"> | null>(null);

  const profile = useQuery(api.queries.business.profile.getProfile);
  const calendarPosts = useQuery(api.queries.business.posts.listPosts, {});
  const pendingPosts = useQuery(api.queries.business.posts.getPendingPosts);
  const library = useQuery(api.queries.business.posts.listAssets, {});
  const rejuvenator = useQuery(
    api.queries.business.posts.getRejuvenatorPicks,
    {}
  );

  if (profile === undefined) return <Skeleton />;
  if (profile === null) {
    return (
      <div className="px-5 py-10 sm:px-8">
        <EmptyState
          stage="fresh"
          title="Finish onboarding"
          body="Connect a GBP and Maya will start drafting posts."
          cta={{ label: "Onboarding", href: "/onboarding/business" }}
        />
      </div>
    );
  }

  const selectedAsset =
    library?.rows.find((a) => a._id === selectedAssetId) ?? null;

  return (
    <div className="pb-12 pt-4 sm:pt-6">
      <Section
        eyebrow="Posts"
        title={tab === "calendar" ? "Calendar" : "Library"}
        caption={
          tab === "calendar"
            ? "Drafted, scheduled, and posted GBP local posts. Library tab shows your full asset catalog."
            : "Every photo Maya has cataloged. Filter by category, quality, or what hasn't been posted yet."
        }
        rightSlot={
          <div className="flex items-center gap-1 rounded-full border border-[var(--hairline)] bg-ink-3/40 p-1">
            {(["calendar", "library"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                data-testid={`biz-posts-tab-${t}`}
                data-active={tab === t ? "true" : "false"}
                onClick={() => setTab(t)}
                className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  tab === t ? "bg-lime text-ink" : "text-paper-dim"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        }
      />

      {tab === "calendar" && (
        <>
          <div className="mx-auto mt-6 max-w-5xl px-5 sm:px-8">
            {calendarPosts === undefined ? (
              <div className="h-40 animate-pulse rounded-2xl bg-ink-3/60" />
            ) : (
              <PostCalendar posts={calendarPosts} />
            )}
          </div>

          <Section
            eyebrow="Drafted, awaiting your approval"
            title={
              pendingPosts && pendingPosts.length > 0
                ? `${pendingPosts.length} draft${pendingPosts.length === 1 ? "" : "s"}`
                : "No drafts pending"
            }
          >
            {pendingPosts && pendingPosts.length > 0 ? (
              <div className="space-y-3">
                {pendingPosts.slice(0, 10).map((p) => (
                  <article
                    key={p._id}
                    data-testid="biz-posts-pending-card"
                    className="rounded-xl border border-amber-300/30 bg-amber-300/5 p-4"
                  >
                    <p className="text-sm text-paper">{p.text}</p>
                    {p.cta?.url && (
                      <p className="mt-1 text-xs text-paper-faint">
                        CTA: {p.cta.type} → {p.cta.url}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                stage="ready"
                title="No drafts pending"
                body="Maya queues GBP posts on the cadence in your Profile settings. Posted history shows on the calendar above."
              />
            )}
          </Section>
        </>
      )}

      {tab === "library" && (
        <>
          {library?.canSeeRejuvenator && rejuvenator && rejuvenator.length > 0 && (
            <Section
              eyebrow="Maya's picks"
              title="Recommended for next post"
              caption="Unposted assets that would do well on GBP, ranked by Maya."
            >
              <LibraryGrid
                assets={rejuvenator}
                onSelect={(id) => setSelectedAssetId(id)}
                testId="biz-posts-rejuvenator-grid"
              />
            </Section>
          )}

          {library && !library.canSeeRejuvenator && (
            <div className="mx-auto mt-6 max-w-5xl px-5 sm:px-8">
              <div className="rounded-2xl border border-amber-300/30 bg-amber-300/5 p-4 text-sm text-paper-dim">
                <span className="font-medium text-paper">Upgrade to Pro</span>{" "}
                — Maya can pick unposted library assets to refresh your GBP
                feed automatically. Library viewing is open at every plan.
              </div>
            </div>
          )}

          <Section eyebrow="Library" title="All assets">
            {library === undefined ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-square animate-pulse rounded-xl bg-ink-3/60"
                  />
                ))}
              </div>
            ) : library.rows.length === 0 ? (
              <EmptyState
                stage="fresh"
                title="No assets yet"
                body="Text Maya a job photo. She catalogs each one and surfaces them here."
                icon={Camera}
              />
            ) : (
              <LibraryGrid
                assets={library.rows}
                onSelect={(id) => setSelectedAssetId(id)}
              />
            )}
          </Section>
        </>
      )}

      {selectedAsset && (
        <AssetDetailPanel
          asset={selectedAsset}
          onClose={() => setSelectedAssetId(null)}
        />
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="px-5 py-10 sm:px-8" data-testid="biz-posts-skeleton">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="h-9 w-1/3 animate-pulse rounded bg-ink-3" />
        <div className="h-32 animate-pulse rounded-2xl bg-ink-3" />
      </div>
    </div>
  );
}
