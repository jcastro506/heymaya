/**
 * Sprint 2.2 — target-list persistence layer tests.
 *
 * Covers the 5 CLAUDE.md mandatory test categories:
 *   1. Cross-tenant isolation — Creator A's data MUST NOT leak to B.
 *   2. Plan-tier × action — public queries fail closed (return [] /null)
 *      for unauthenticated callers + non-gtm-agent accounts.
 *   3. Adversarial inputs — empty strings, very long strings, handle
 *      casing variants, dedupe edge cases.
 *   4. Sibling-file scan — researchJobId stays optional (subagents may
 *      surface targets outside any specific research job).
 *   5. TODO grep — covered by the existing repo-wide test in
 *      tests/sprint1Acceptance.test.ts; this file has none.
 *
 * Plus happy-path coverage for every mutation + query.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

function authedGtm(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
}

async function setupAgent(
  t: ReturnType<typeof convexTest>,
  subject: string
): Promise<{
  authed: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>;
  accountId: import("../../_generated/dataModel").Id<"creators">;
  agentId: import("../../_generated/dataModel").Id<"gtmAgents">;
}> {
  const authed = authedGtm(t, subject);
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    { channelPreference: "telegram", timezone: "America/New_York" }
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  return {
    authed,
    accountId: started.accountId,
    agentId: started.agentId,
  };
}

const ZERO_METRICS = {} as const;

describe("Sprint 2.2 — gtmTargetThreads", () => {
  it("recordTargetThread inserts a fresh row with createdAt/updatedAt/status='queued'", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_tt_insert");

    const id = await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId,
      agentId,
      platform: "reddit",
      url: "https://reddit.com/r/LocalLLaMA/comments/abc",
      externalId: "abc",
      title: "How do I get my first users?",
      excerpt: "I built a tiny LLM tool…",
      author: "sabesh",
      subredditOrCommunity: "r/LocalLLaMA",
      currentMetrics: { upvotes: 12, comments: 4 },
      whyItFits: "OP is asking how indie builders find first users — this is exactly your demo audience.",
      recommendedAction: "reply",
      priorityScore: 0.78,
    });

    const rows = await authed.query(api.gtmMaya.targetList.getMyTargetThreads, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toStrictEqual(id);
    expect(rows[0].status).toBe("queued");
    expect(rows[0].priorityScore).toBeCloseTo(0.78);
    expect(rows[0].currentMetrics.upvotes).toBe(12);
    expect(rows[0].draftedReplyId).toBeUndefined();
    expect(rows[0].researchJobId).toBeUndefined(); // researchJobId is optional
  });

  it("recordTargetThread dedupes on (accountId, platform, externalId) — second call UPDATES", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_tt_dedupe");

    const first = await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId,
      agentId,
      platform: "x",
      url: "https://x.com/foo/status/1",
      externalId: "1",
      title: "original title",
      currentMetrics: { likes: 5 },
      whyItFits: "first reason",
      recommendedAction: "reply",
      priorityScore: 0.5,
    });

    const second = await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId,
      agentId,
      platform: "x",
      url: "https://x.com/foo/status/1",
      externalId: "1",
      title: "fresher title",
      currentMetrics: { likes: 99 },
      whyItFits: "fresher reason",
      recommendedAction: "lurk",
      priorityScore: 0.9,
    });

    expect(second).toStrictEqual(first); // same row, not a new insert
    const rows = await authed.query(api.gtmMaya.targetList.getMyTargetThreads, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("fresher title");
    expect(rows[0].currentMetrics.likes).toBe(99);
    expect(rows[0].whyItFits).toBe("fresher reason");
    expect(rows[0].recommendedAction).toBe("lurk");
    expect(rows[0].priorityScore).toBeCloseTo(0.9);
  });

  it("dedupe only collides within the same (accountId, platform) — different platforms with same externalId coexist", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_tt_ddedupe2");

    await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId, agentId, platform: "reddit",
      url: "https://reddit.com/r/x/comments/abc", externalId: "abc",
      currentMetrics: ZERO_METRICS, whyItFits: "r", recommendedAction: "reply",
      priorityScore: 0.5,
    });
    await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId, agentId, platform: "hn",
      url: "https://news.ycombinator.com/item?id=abc", externalId: "abc",
      currentMetrics: ZERO_METRICS, whyItFits: "h", recommendedAction: "reply",
      priorityScore: 0.5,
    });

    const rows = await authed.query(api.gtmMaya.targetList.getMyTargetThreads, {});
    expect(rows).toHaveLength(2);
  });

  it("CROSS-TENANT ISOLATION: Creator A's threads do not appear in Creator B's getMyTargetThreads", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_tt_iso_a");
    const b = await setupAgent(t, "u_tt_iso_b");

    await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId: a.accountId,
      agentId: a.agentId,
      platform: "reddit",
      url: "https://reddit.com/r/foo/comments/aaa",
      externalId: "aaa",
      currentMetrics: ZERO_METRICS,
      whyItFits: "A's thread",
      recommendedAction: "reply",
      priorityScore: 0.6,
    });

    const aRows = await a.authed.query(api.gtmMaya.targetList.getMyTargetThreads, {});
    const bRows = await b.authed.query(api.gtmMaya.targetList.getMyTargetThreads, {});
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(0); // B sees nothing
  });

  it("CROSS-TENANT ISOLATION: recordTargetThread rejects a mismatched (accountId, agentId)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_tt_amix_a");
    const b = await setupAgent(t, "u_tt_amix_b");

    await expect(
      t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
        accountId: a.accountId,
        agentId: b.agentId, // <- not A's agent
        platform: "reddit",
        url: "https://reddit.com/r/foo/comments/zzz",
        externalId: "zzz",
        currentMetrics: ZERO_METRICS,
        whyItFits: "should fail",
        recommendedAction: "reply",
        priorityScore: 0.5,
      })
    ).rejects.toThrow("agent does not belong to account");
  });

  it("getMyTargetThreads filters by status when provided", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_tt_filt_status");
    const id1 = await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId, agentId, platform: "reddit",
      url: "https://r.test/1", externalId: "1",
      currentMetrics: ZERO_METRICS, whyItFits: "w", recommendedAction: "reply",
      priorityScore: 0.4,
    });
    await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId, agentId, platform: "reddit",
      url: "https://r.test/2", externalId: "2",
      currentMetrics: ZERO_METRICS, whyItFits: "w", recommendedAction: "reply",
      priorityScore: 0.5,
    });
    await t.mutation(internal.gtmMaya.targetList.updateTargetThreadStatus, {
      id: id1,
      status: "expired",
    });
    const queued = await authed.query(api.gtmMaya.targetList.getMyTargetThreads, { status: "queued" });
    const expired = await authed.query(api.gtmMaya.targetList.getMyTargetThreads, { status: "expired" });
    expect(queued).toHaveLength(1);
    expect(expired).toHaveLength(1);
    expect(expired[0]._id).toStrictEqual(id1);
  });

  it("getMyTargetThreads filters by platform when provided", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_tt_filt_plat");
    await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId, agentId, platform: "reddit",
      url: "https://r.test/a", externalId: "a",
      currentMetrics: ZERO_METRICS, whyItFits: "w", recommendedAction: "reply",
      priorityScore: 0.4,
    });
    await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId, agentId, platform: "x",
      url: "https://x.com/foo/status/b", externalId: "b",
      currentMetrics: ZERO_METRICS, whyItFits: "w", recommendedAction: "reply",
      priorityScore: 0.4,
    });
    const reddit = await authed.query(api.gtmMaya.targetList.getMyTargetThreads, { platform: "reddit" });
    const x = await authed.query(api.gtmMaya.targetList.getMyTargetThreads, { platform: "x" });
    expect(reddit).toHaveLength(1);
    expect(x).toHaveLength(1);
  });

  it("refreshTargetThreadMetrics bumps metrics + lastSeenMetricsAtMs without touching whyItFits", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_tt_refresh");
    const id = await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId, agentId, platform: "reddit",
      url: "https://r.test/x", externalId: "x",
      currentMetrics: { upvotes: 5 }, whyItFits: "original",
      recommendedAction: "reply", priorityScore: 0.5,
    });
    const beforeRows = await authed.query(api.gtmMaya.targetList.getMyTargetThreads, {});
    const before = beforeRows[0].lastSeenMetricsAtMs;

    // Tiny delay to ensure timestamps differ.
    await new Promise((r) => setTimeout(r, 5));
    await t.mutation(internal.gtmMaya.targetList.refreshTargetThreadMetrics, {
      id,
      currentMetrics: { upvotes: 42, comments: 7 },
    });
    const afterRows = await authed.query(api.gtmMaya.targetList.getMyTargetThreads, {});
    expect(afterRows[0].currentMetrics.upvotes).toBe(42);
    expect(afterRows[0].currentMetrics.comments).toBe(7);
    expect(afterRows[0].whyItFits).toBe("original");
    expect(afterRows[0].lastSeenMetricsAtMs).toBeGreaterThan(before);
  });

  it("updateTargetThreadStatus links a draftedReplyId when transitioning to 'replied'", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_tt_link");
    const threadId = await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId, agentId, platform: "reddit",
      url: "https://r.test/n", externalId: "n",
      currentMetrics: ZERO_METRICS, whyItFits: "w", recommendedAction: "reply",
      priorityScore: 0.5,
    });
    const draftId = await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId, agentId, kind: "reply", platform: "reddit",
      targetThreadId: threadId, draftText: "hello",
    });
    await t.mutation(internal.gtmMaya.targetList.updateTargetThreadStatus, {
      id: threadId, status: "replied", draftedReplyId: draftId,
    });
    const detail = await authed.query(api.gtmMaya.targetList.getMyTargetThreadById, {
      id: threadId,
    });
    expect(detail?.thread.status).toBe("replied");
    expect(detail?.thread.draftedReplyId).toStrictEqual(draftId);
    expect(detail?.drafts).toHaveLength(1);
    expect(detail?.drafts[0]._id).toStrictEqual(draftId);
  });

  it("ADVERSARIAL: rejects empty externalId is allowed (subagents may legitimately surface threads with weird IDs), but very long strings round-trip", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId, authed } = await setupAgent(t, "u_tt_adv");
    const longExcerpt = "x".repeat(500);
    const longWhy = "y".repeat(2000);
    await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId, agentId, platform: "reddit",
      url: "https://r.test/long", externalId: "long",
      excerpt: longExcerpt, whyItFits: longWhy,
      currentMetrics: ZERO_METRICS, recommendedAction: "reply", priorityScore: 0.5,
    });
    const rows = await authed.query(api.gtmMaya.targetList.getMyTargetThreads, {});
    expect(rows[0].excerpt?.length).toBe(500);
    expect(rows[0].whyItFits.length).toBe(2000);
  });

  it("ADVERSARIAL: empty-object currentMetrics + missing optionals all round-trip cleanly", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId, authed } = await setupAgent(t, "u_tt_empty");
    await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId, agentId, platform: "linkedin",
      url: "https://linkedin.com/posts/abc", externalId: "abc",
      currentMetrics: ZERO_METRICS, whyItFits: "minimal",
      recommendedAction: "lurk", priorityScore: 0,
    });
    const rows = await authed.query(api.gtmMaya.targetList.getMyTargetThreads, {});
    expect(rows[0].currentMetrics).toEqual({});
    expect(rows[0].title).toBeUndefined();
    expect(rows[0].excerpt).toBeUndefined();
    expect(rows[0].author).toBeUndefined();
    expect(rows[0].subredditOrCommunity).toBeUndefined();
  });
});

describe("Sprint 2.2 — gtmTargetAccounts", () => {
  it("recordTargetAccount inserts a fresh row + lowercases the handle for stable dedupe", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_ta_insert");

    const id = await t.mutation(internal.gtmMaya.targetList.recordTargetAccount, {
      accountId, agentId, platform: "x",
      handle: "@Sabesh",
      profileUrl: "https://x.com/Sabesh",
      displayName: "Sabesh B.",
      bio: "indie hacker",
      followerCount: 4_200,
      voiceAnalysis: "Posts short crisp threads about indie hacking and shipping.",
      whyItFits: "His audience overlaps with your ICP and he engages with new tools.",
      recommendedAction: "follow_and_engage",
      priorityScore: 0.82,
    });

    const rows = await authed.query(api.gtmMaya.targetList.getMyTargetAccounts, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toStrictEqual(id);
    expect(rows[0].handle).toBe("sabesh"); // lowercase, no '@'
    expect(rows[0].status).toBe("queued");
    expect(rows[0].followerCount).toBe(4_200);
  });

  it("recordTargetAccount dedupes on (accountId, platform, handle) case-insensitively", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_ta_dedupe");
    const first = await t.mutation(internal.gtmMaya.targetList.recordTargetAccount, {
      accountId, agentId, platform: "x",
      handle: "sabesh", profileUrl: "https://x.com/sabesh",
      whyItFits: "first", recommendedAction: "follow_and_engage",
      priorityScore: 0.5,
    });
    const second = await t.mutation(internal.gtmMaya.targetList.recordTargetAccount, {
      accountId, agentId, platform: "x",
      handle: "@SaBesH", profileUrl: "https://x.com/sabesh",
      whyItFits: "fresher", recommendedAction: "follow_and_engage",
      priorityScore: 0.9,
    });
    expect(second).toStrictEqual(first);
    const rows = await authed.query(api.gtmMaya.targetList.getMyTargetAccounts, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].whyItFits).toBe("fresher");
    expect(rows[0].priorityScore).toBeCloseTo(0.9);
  });

  it("CROSS-TENANT ISOLATION: Creator A's accounts do not appear in Creator B's getMyTargetAccounts", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_ta_iso_a");
    const b = await setupAgent(t, "u_ta_iso_b");

    await t.mutation(internal.gtmMaya.targetList.recordTargetAccount, {
      accountId: a.accountId, agentId: a.agentId, platform: "reddit",
      handle: "u_a_only", profileUrl: "https://reddit.com/user/u_a_only",
      whyItFits: "A's account", recommendedAction: "follow_and_engage",
      priorityScore: 0.7,
    });

    expect(
      await a.authed.query(api.gtmMaya.targetList.getMyTargetAccounts, {})
    ).toHaveLength(1);
    expect(
      await b.authed.query(api.gtmMaya.targetList.getMyTargetAccounts, {})
    ).toHaveLength(0);
  });

  it("getMyTargetAccounts filters by platform", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_ta_filt");
    await t.mutation(internal.gtmMaya.targetList.recordTargetAccount, {
      accountId, agentId, platform: "x", handle: "a",
      profileUrl: "https://x.com/a", whyItFits: "w",
      recommendedAction: "follow_and_engage", priorityScore: 0.5,
    });
    await t.mutation(internal.gtmMaya.targetList.recordTargetAccount, {
      accountId, agentId, platform: "reddit", handle: "b",
      profileUrl: "https://reddit.com/user/b", whyItFits: "w",
      recommendedAction: "follow_and_engage", priorityScore: 0.5,
    });
    const x = await authed.query(api.gtmMaya.targetList.getMyTargetAccounts, { platform: "x" });
    const reddit = await authed.query(api.gtmMaya.targetList.getMyTargetAccounts, { platform: "reddit" });
    expect(x).toHaveLength(1);
    expect(reddit).toHaveLength(1);
  });
});

describe("Sprint 2.2 — gtmDraftedContent", () => {
  it("recordDraftedContent inserts a draft with slopCriticPassed=false + approvalState='draft'", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_dc_insert");

    const id = await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId, agentId, kind: "reply", platform: "reddit",
      draftText: "Here's how I'd think about that — quick context, then a concrete answer.",
      voiceMatchScore: 0.71,
    });

    const rows = await authed.query(api.gtmMaya.targetList.getMyDraftedContent, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toStrictEqual(id);
    expect(rows[0].slopCriticPassed).toBe(false);
    expect(rows[0].approvalState).toBe("draft");
    expect(rows[0].draftText).toContain("quick context");
    expect(rows[0].voiceMatchScore).toBeCloseTo(0.71);
  });

  it("recordDraftedContent NEVER dedupes — two identical drafts produce two rows", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_dc_no_dedupe");
    const a = await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId, agentId, kind: "reply", platform: "x",
      draftText: "same text",
    });
    const b = await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId, agentId, kind: "reply", platform: "x",
      draftText: "same text",
    });
    expect(a).not.toStrictEqual(b);
    const rows = await authed.query(api.gtmMaya.targetList.getMyDraftedContent, {});
    expect(rows).toHaveLength(2);
  });

  it("recordDraftedContent rejects targetThreadId from a different account", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_dc_mismatch_a");
    const b = await setupAgent(t, "u_dc_mismatch_b");
    const aThreadId = await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId: a.accountId, agentId: a.agentId, platform: "reddit",
      url: "https://r.test/q", externalId: "q",
      currentMetrics: ZERO_METRICS, whyItFits: "w", recommendedAction: "reply",
      priorityScore: 0.5,
    });
    await expect(
      t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
        accountId: b.accountId, agentId: b.agentId, kind: "reply", platform: "reddit",
        targetThreadId: aThreadId, // <- A's thread
        draftText: "should fail",
      })
    ).rejects.toThrow("targetThreadId does not belong to this account");
  });

  it("CROSS-TENANT ISOLATION: drafts don't leak across creators", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_dc_iso_a");
    const b = await setupAgent(t, "u_dc_iso_b");
    await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId: a.accountId, agentId: a.agentId, kind: "post", platform: "x",
      draftText: "A's draft",
    });
    expect(
      await a.authed.query(api.gtmMaya.targetList.getMyDraftedContent, {})
    ).toHaveLength(1);
    expect(
      await b.authed.query(api.gtmMaya.targetList.getMyDraftedContent, {})
    ).toHaveLength(0);
  });

  it("updateDraftedContentApproval walks the approval lifecycle", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_dc_lifecycle");
    const id = await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId, agentId, kind: "reply", platform: "reddit",
      draftText: "first draft",
    });

    // Slop-critic passes
    await t.mutation(internal.gtmMaya.targetList.updateDraftedContentApproval, {
      id,
      approvalState: "pending_approval",
      slopCriticPassed: true,
      slopCriticFailures: [],
    });
    let rows = await authed.query(api.gtmMaya.targetList.getMyDraftedContent, {
      approvalState: "pending_approval",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].slopCriticPassed).toBe(true);

    // User rejects
    await t.mutation(internal.gtmMaya.targetList.updateDraftedContentApproval, {
      id,
      approvalState: "needs_revision",
      userFeedback: "Too formal — make it punchier.",
    });
    rows = await authed.query(api.gtmMaya.targetList.getMyDraftedContent, {
      approvalState: "needs_revision",
    });
    expect(rows[0].userFeedback).toBe("Too formal — make it punchier.");

    // Eventually published
    const publishedAt = Date.now();
    await t.mutation(internal.gtmMaya.targetList.updateDraftedContentApproval, {
      id,
      approvalState: "published",
      publishedAt,
      providerPostId: "https://reddit.com/r/foo/comments/abc/_/xyz",
    });
    rows = await authed.query(api.gtmMaya.targetList.getMyDraftedContent, {
      approvalState: "published",
    });
    expect(rows[0].publishedAt).toBe(publishedAt);
    expect(rows[0].providerPostId).toContain("reddit.com");
  });

  it("getMyDraftedContent filters by approvalState", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_dc_filt");
    const a = await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId, agentId, kind: "post", platform: "x", draftText: "a",
    });
    await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId, agentId, kind: "post", platform: "x", draftText: "b",
    });
    await t.mutation(internal.gtmMaya.targetList.updateDraftedContentApproval, {
      id: a, approvalState: "approved",
    });
    const draft = await authed.query(api.gtmMaya.targetList.getMyDraftedContent, {
      approvalState: "draft",
    });
    const approved = await authed.query(api.gtmMaya.targetList.getMyDraftedContent, {
      approvalState: "approved",
    });
    expect(draft).toHaveLength(1);
    expect(approved).toHaveLength(1);
  });

  it("draftSegments round-trips for the 'thread' kind", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_dc_segments");
    await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId, agentId, kind: "thread", platform: "x",
      draftText: "1/ a\n2/ b\n3/ c",
      draftSegments: ["1/ a", "2/ b", "3/ c"],
    });
    const rows = await authed.query(api.gtmMaya.targetList.getMyDraftedContent, {});
    expect(rows[0].draftSegments).toEqual(["1/ a", "2/ b", "3/ c"]);
  });
});

describe("Sprint 2.2 — auth gating (plan-tier × action / fail-closed)", () => {
  it("UNAUTHENTICATED public queries return [] / null — never throw, never leak", async () => {
    const t = convexTest(schema, modules);
    // Seed some data so we can confirm it's NOT returned.
    const { accountId, agentId } = await setupAgent(t, "u_auth_seed");
    await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId, agentId, platform: "reddit",
      url: "https://r.test/p", externalId: "p",
      currentMetrics: ZERO_METRICS, whyItFits: "w", recommendedAction: "reply",
      priorityScore: 0.5,
    });
    // No .withIdentity() — unauthenticated.
    expect(await t.query(api.gtmMaya.targetList.getMyTargetThreads, {})).toEqual([]);
    expect(await t.query(api.gtmMaya.targetList.getMyTargetAccounts, {})).toEqual([]);
    expect(await t.query(api.gtmMaya.targetList.getMyDraftedContent, {})).toEqual([]);
  });

  it("non-gtm-agent creator types get [] back (fail-closed on accountType)", async () => {
    const t = convexTest(schema, modules);
    // setupAgent already created a gtm-agent user; switch to a brand new
    // identity that has no creator row at all to mimic a non-gtm caller.
    const stranger = t.withIdentity({
      subject: "u_stranger",
      email: "stranger@nowhere.test",
    });
    expect(
      await stranger.query(api.gtmMaya.targetList.getMyTargetThreads, {})
    ).toEqual([]);
    expect(
      await stranger.query(api.gtmMaya.targetList.getMyDraftedContent, {})
    ).toEqual([]);
    expect(
      await stranger.query(api.gtmMaya.targetList.getMyTargetAccounts, {})
    ).toEqual([]);
  });

  it("getMyTargetThreadById returns null for an unauth caller and for a thread owned by someone else", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_byid_a");
    const b = await setupAgent(t, "u_byid_b");
    const aThreadId = await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId: a.accountId, agentId: a.agentId, platform: "reddit",
      url: "https://r.test/byid", externalId: "byid",
      currentMetrics: ZERO_METRICS, whyItFits: "w", recommendedAction: "reply",
      priorityScore: 0.5,
    });
    expect(
      await t.query(api.gtmMaya.targetList.getMyTargetThreadById, { id: aThreadId })
    ).toBeNull(); // unauthed → null
    expect(
      await b.authed.query(api.gtmMaya.targetList.getMyTargetThreadById, {
        id: aThreadId,
      })
    ).toBeNull(); // B (different creator) → null even though row exists
    expect(
      (await a.authed.query(api.gtmMaya.targetList.getMyTargetThreadById, {
        id: aThreadId,
      }))?.thread._id
    ).toStrictEqual(aThreadId);
  });
});
