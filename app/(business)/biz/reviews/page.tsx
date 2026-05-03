/**
 * Reviews screen — `/biz/reviews`.
 *
 * Per Service Sprint Plan § 12.3:
 *   - Multi-platform feed (GBP / FB / Yelp)
 *   - Drafted-replies inline approval queue
 *   - Reply-status tracker (Google ReviewReplyState moderation)
 *   - Sentiment trend (last 90d)
 *   - Unmatched-customer surfacing
 */

"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Star } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import { Section } from "@/components/business/Section";
import { EmptyState } from "@/components/business/EmptyState";
import { ReviewCard } from "@/components/business/ReviewCard";
import { SentimentTrend } from "@/components/business/SentimentTrend";

type Platform = Doc<"reviews">["platform"];

const PLATFORM_TABS: { key: Platform | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "gbp", label: "Google" },
  { key: "fb", label: "Facebook" },
  { key: "yelp", label: "Yelp" },
];

export default function ReviewsPage() {
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const [showOnlyDrafted, setShowOnlyDrafted] = useState(false);

  const profile = useQuery(api.queries.business.profile.getProfile);
  const drafted = useQuery(api.queries.business.reviews.getDraftedReplies);
  const reviews = useQuery(api.queries.business.reviews.listReviews, {
    platform: platform === "all" ? undefined : platform,
    replyStatus: showOnlyDrafted ? "drafted" : undefined,
  });
  const trend = useQuery(api.queries.business.reviews.getSentimentTrend);
  const unmatched = useQuery(api.queries.business.reviews.getUnmatchedReviews);

  if (profile === undefined) return <Skeleton />;
  if (profile === null) {
    return (
      <div className="px-5 py-10 sm:px-8">
        <EmptyState
          stage="fresh"
          title="Finish onboarding"
          body="Connect your GBP to start showing reviews."
          cta={{ label: "Onboarding", href: "/onboarding/business" }}
        />
      </div>
    );
  }

  return (
    <div className="pb-12 pt-4 sm:pt-6">
      {drafted && drafted.length > 0 && (
        <Section
          eyebrow="Approval queue"
          title={`${drafted.length} reply draft${drafted.length === 1 ? "" : "s"} awaiting your tap`}
          caption="Google requires operator approval on every review reply at every plan tier."
        >
          <div data-testid="biz-reviews-approval-queue" className="space-y-3">
            {drafted.slice(0, 5).map((r) => (
              <ReviewCard
                key={r._id}
                review={r}
                onApprove={() => {
                  /* approve mutation wired in Wave C CRM agent */
                }}
                onEdit={() => {
                  /* edit mutation wired in Wave C CRM agent */
                }}
                onReject={() => {
                  /* reject mutation wired in Wave C CRM agent */
                }}
              />
            ))}
          </div>
        </Section>
      )}

      <Section
        eyebrow="Sentiment trend"
        title="90-day pulse"
        caption="Each bar is one day with reviews. Lime is positive, rose is negative."
      >
        {trend !== undefined ? (
          <SentimentTrend buckets={trend} />
        ) : (
          <div className="h-[110px] animate-pulse rounded-xl bg-ink-3/60" />
        )}
      </Section>

      <Section
        eyebrow="Feed"
        title="All reviews"
        rightSlot={
          <button
            type="button"
            onClick={() => setShowOnlyDrafted(!showOnlyDrafted)}
            data-testid="biz-reviews-drafted-only-toggle"
            data-active={showOnlyDrafted ? "true" : "false"}
            className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider ${
              showOnlyDrafted
                ? "border-lime/40 bg-lime/5 text-lime"
                : "border-[var(--hairline)] text-paper-dim"
            }`}
          >
            Drafted only
          </button>
        }
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {PLATFORM_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              data-testid={`biz-reviews-platform-${t.key}`}
              data-active={platform === t.key ? "true" : "false"}
              onClick={() => setPlatform(t.key)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                platform === t.key
                  ? "border-lime/40 bg-lime/5 text-lime"
                  : "border-[var(--hairline)] text-paper-dim hover:bg-ink-3"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {reviews === undefined ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-2xl bg-ink-3/60"
              />
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <EmptyState
            stage="ready"
            title="No reviews in this view"
            body="Once your customers leave reviews, Maya drafts replies overnight. You approve, she posts."
            icon={Star}
          />
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <ReviewCard key={r._id} review={r} />
            ))}
          </div>
        )}
      </Section>

      {unmatched && unmatched.length > 0 && (
        <Section
          eyebrow="Heads up"
          title="Reviews Maya could not match"
          caption="The reviewer's name doesn't appear in your customer list. Add them manually if relevant."
        >
          <div className="space-y-2">
            {unmatched.slice(0, 5).map((r) => (
              <div
                key={r._id}
                data-testid="biz-reviews-unmatched-row"
                className="rounded-xl border border-amber-300/30 bg-amber-300/5 p-3 text-sm"
              >
                <div className="font-medium text-paper">
                  {r.reviewerName} · {r.starRating}-star · {r.platform}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-paper-dim">
                  {r.body}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="px-5 py-10 sm:px-8" data-testid="biz-reviews-skeleton">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="h-9 w-1/3 animate-pulse rounded bg-ink-3" />
        <div className="h-32 animate-pulse rounded-2xl bg-ink-3" />
      </div>
    </div>
  );
}
