/**
 * ReviewCard render tests — sentiment-color, draft-reply, approval strip.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ReviewCard } from "../ReviewCard";
import type { Doc } from "@/convex/_generated/dataModel";

function makeReview(
  overrides: Partial<Doc<"reviews">> = {}
): Doc<"reviews"> {
  return {
    _id: "rev-1" as Doc<"reviews">["_id"],
    _creationTime: 0,
    businessId: "biz-1" as Doc<"reviews">["businessId"],
    platform: "gbp",
    externalReviewId: "ext-1",
    reviewerName: "Sarah Chen",
    starRating: 5,
    body: "Mike was on time and fixed the leak fast.",
    sentiment: "positive",
    receivedAt: Date.now() - 10 * 60_000,
    ...overrides,
  } as Doc<"reviews">;
}

describe("ReviewCard", () => {
  it("renders positive sentiment with lime border", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewCard, { review: makeReview({ sentiment: "positive" }) })
    );
    expect(html).toContain("Sarah Chen");
    expect(html).toContain('data-sentiment="positive"');
    expect(html).toContain("border-lime/30");
  });

  it("renders negative sentiment with rose border", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewCard, {
        review: makeReview({ sentiment: "negative", starRating: 1 }),
      })
    );
    expect(html).toContain("border-rose-300/30");
  });

  it("shows Maya's draft reply inline when present", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewCard, {
        review: makeReview({
          replyStatus: "drafted",
          draftReply: "Thanks Sarah — Mike loved hearing this!",
        }),
      })
    );
    expect(html).toContain("Maya&#x27;s draft");
    expect(html).toContain("Mike loved hearing this");
  });

  it("renders approval strip only when drafted AND callbacks provided", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewCard, {
        review: makeReview({ replyStatus: "drafted", draftReply: "x" }),
        onApprove: () => {},
        onEdit: () => {},
        onReject: () => {},
      })
    );
    expect(html).toContain("biz-review-approve-btn");
    expect(html).toContain("biz-review-edit-btn");
    expect(html).toContain("biz-review-reject-btn");
  });

  it("does NOT render approval strip when not drafted", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewCard, {
        review: makeReview({ replyStatus: "posted" }),
        onApprove: () => {},
      })
    );
    expect(html).not.toContain("biz-review-approve-btn");
    expect(html).toContain("Posted");
  });

  it("renders Unmatched badge when customerMatchedJobId is undefined", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewCard, {
        review: makeReview({ customerMatchedJobId: undefined }),
      })
    );
    expect(html).toContain("Unmatched");
  });
});
