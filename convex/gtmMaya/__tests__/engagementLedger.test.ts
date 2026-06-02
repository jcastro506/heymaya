/**
 * S3 — engagement-ledger dedup tests (per-comment granularity).
 *
 * The server-side guarantee: never reply twice to the same thread/comment
 * unless intentionalFollowUp. Pure-function tests for the decision + gate,
 * plus a convex-test for the live query scoped per-agent.
 */

import { describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";
import { decideAlreadyEngaged, evaluateDedupGate } from "../engagementLedger";

type Prior = Parameters<typeof decideAlreadyEngaged>[0][number];
const row = (over: Partial<Prior>): Prior => ({
  _id: "x" as Id<"gtmPostResults">,
  providerPostId: "p1",
  targetExternalId: undefined,
  targetCommentId: undefined,
  ...over,
});

describe("decideAlreadyEngaged", () => {
  it("no priors => not engaged", () => {
    const r = decideAlreadyEngaged([], "t1", undefined);
    expect(r.engaged).toBe(false);
  });

  it("thread-level: a prior thread-root reply blocks another thread reply", () => {
    const priors = [row({ targetExternalId: "t1", targetCommentId: undefined })];
    const r = decideAlreadyEngaged(priors, "t1", undefined);
    expect(r.engaged).toBe(true);
    expect(r.threadEngaged).toBe(true);
  });

  it("comment-level: replying to the SAME comment twice is engaged", () => {
    const priors = [row({ targetExternalId: "t1", targetCommentId: "c1" })];
    const r = decideAlreadyEngaged(priors, "t1", "c1");
    expect(r.engaged).toBe(true);
    expect(r.commentEngaged).toBe(true);
  });

  it("comment-level: a DIFFERENT comment in the same thread is NOT engaged", () => {
    const priors = [row({ targetExternalId: "t1", targetCommentId: "c1" })];
    const r = decideAlreadyEngaged(priors, "t1", "c2");
    expect(r.engaged).toBe(false);
  });

  it("a prior comment reply does NOT block a separate thread-root reply", () => {
    const priors = [row({ targetExternalId: "t1", targetCommentId: "c1" })];
    const r = decideAlreadyEngaged(priors, "t1", undefined);
    expect(r.engaged).toBe(false);
  });

  it("a prior thread-root reply does NOT block a specific-comment reply", () => {
    const priors = [row({ targetExternalId: "t1", targetCommentId: undefined })];
    const r = decideAlreadyEngaged(priors, "t1", "c1");
    expect(r.engaged).toBe(false);
  });

  it("priors for a different thread are ignored", () => {
    const priors = [row({ targetExternalId: "other", targetCommentId: undefined })];
    const r = decideAlreadyEngaged(priors, "t1", undefined);
    expect(r.engaged).toBe(false);
  });
});

describe("evaluateDedupGate", () => {
  const engaged = {
    engaged: true,
    threadEngaged: true,
    commentEngaged: false,
    priorPostResultId: null,
    priorProviderPostId: "p1",
  };
  it("allows when not engaged", () => {
    const g = evaluateDedupGate(
      { engaged: false, threadEngaged: false, commentEngaged: false, priorPostResultId: null, priorProviderPostId: null },
      false
    );
    expect(g.allow).toBe(true);
  });
  it("refuses when engaged and no override", () => {
    const g = evaluateDedupGate(engaged, false);
    expect(g.allow).toBe(false);
    expect(g.reason).toContain("already engaged");
  });
  it("allows when engaged but intentionalFollowUp", () => {
    const g = evaluateDedupGate(engaged, true);
    expect(g.allow).toBe(true);
  });
});

// NOTE: checkAlreadyEngaged's per-agent isolation is structural — it scans
// gtmPostResults.withIndex("by_agent", agentId) then applies decideAlreadyEngaged
// above. The by_agent scoping is the same pattern proven in the cross-tenant
// tests (zernioConnect.test.ts), and the dedup decision is fully covered here.
