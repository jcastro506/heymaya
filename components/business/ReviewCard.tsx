/**
 * Single review row for the Reviews feed.
 *
 * Sentiment color-coding per Service Sprint Plan § 12.3:
 *   - positive  → lime (matches HQ accent)
 *   - neutral   → paper-dim
 *   - negative  → rose-300 (urgency without being alarming)
 *
 * Renders the draft reply inline if `replyStatus === "drafted"` so the
 * approval queue doesn't need a separate detail panel for the most common
 * action ("approve this reply"). Approve / edit / reject buttons are
 * parent-supplied callbacks.
 */

import type { Doc } from "@/convex/_generated/dataModel";
import { Star } from "lucide-react";

export interface ReviewCardProps {
  review: Doc<"reviews">;
  /** When provided, renders the inline approve/edit/reject strip. */
  onApprove?: () => void;
  onEdit?: () => void;
  onReject?: () => void;
  testId?: string;
}

const PLATFORM_LABEL: Record<Doc<"reviews">["platform"], string> = {
  gbp: "Google",
  fb: "Facebook",
  yelp: "Yelp",
};

export function ReviewCard({
  review,
  onApprove,
  onEdit,
  onReject,
  testId,
}: ReviewCardProps) {
  const sentimentClass =
    review.sentiment === "positive"
      ? "border-lime/30 bg-lime/5"
      : review.sentiment === "negative"
      ? "border-rose-300/30 bg-rose-300/5"
      : "border-[var(--hairline)] bg-ink-2/60";

  const showApproval =
    review.replyStatus === "drafted" &&
    (onApprove || onEdit || onReject);

  return (
    <article
      data-testid={testId ?? "biz-review-card"}
      data-sentiment={review.sentiment ?? "unknown"}
      data-reply-status={review.replyStatus ?? "none"}
      className={`flex flex-col gap-3 rounded-2xl border p-4 ${sentimentClass}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-paper">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className={`h-3.5 w-3.5 ${
                i < review.starRating
                  ? "fill-lime text-lime"
                  : "text-paper-faint"
              }`}
              aria-hidden
            />
          ))}
          <span className="ml-2 text-sm font-medium">{review.reviewerName}</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
          {PLATFORM_LABEL[review.platform]}
        </span>
        {review.customerMatchedJobId === undefined && (
          <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-200">
            Unmatched
          </span>
        )}
        <span className="ml-auto text-xs text-paper-faint">
          {timeAgo(review.receivedAt)}
        </span>
      </header>

      <p className="text-sm leading-relaxed text-paper-dim">{review.body}</p>

      {review.draftReply && (
        <div className="rounded-xl border border-[var(--hairline)] bg-ink-3/60 p-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
            Maya's draft
          </span>
          <p className="mt-1.5 text-sm text-paper">{review.draftReply}</p>
        </div>
      )}

      {showApproval && (
        <div className="flex flex-wrap gap-2 border-t border-[var(--hairline)] pt-3">
          {onApprove && (
            <button
              type="button"
              onClick={onApprove}
              data-testid="biz-review-approve-btn"
              className="rounded-full bg-lime px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-lime/85"
            >
              Approve + post
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              data-testid="biz-review-edit-btn"
              className="rounded-full border border-[var(--hairline-strong)] px-3 py-1.5 text-xs text-paper transition-colors hover:bg-ink-3"
            >
              Edit
            </button>
          )}
          {onReject && (
            <button
              type="button"
              onClick={onReject}
              data-testid="biz-review-reject-btn"
              className="rounded-full border border-[var(--hairline-strong)] px-3 py-1.5 text-xs text-paper-dim transition-colors hover:bg-ink-3"
            >
              Reject
            </button>
          )}
        </div>
      )}

      {review.replyStatus === "posted" && (
        <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
          Posted {review.publishedAt ? timeAgo(review.publishedAt) : ""}
        </span>
      )}
    </article>
  );
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}
