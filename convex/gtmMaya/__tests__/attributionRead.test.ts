/**
 * Sprint C — attribution READ-BACK: `listAgentPostAttribution` internalQuery.
 *
 * This is the runtime twin of the web `getMyPostAttribution` query — keyed off
 * {agentId, accountId} so Maya can pull per-post clicks → signups from inside
 * her Fly machine. The two mandatory + load-bearing behaviors that were
 * previously uncovered:
 *
 *   1. CROSS-TENANT ISOLATION (mandatory): agent A's read never sees agent B's
 *      wraps/clicks/conversions, and a wrap whose accountId mismatches the
 *      agent is excluded even within the same agent's wrap set.
 *   2. The per-post click→conversion join + sort.
 *   3. windowDays temporal filtering (the temporal-fabrication fix).
 *   4. untiedSignups (signups with no wrapped link — surfaced honestly).
 *   5. Empty case (no wraps → silent zeros).
 *
 * Wraps/clicks/conversions are seeded directly via `t.run` so clickedAt /
 * occurredAt timestamps are controllable for the window tests (the HTTP path
 * always stamps Date.now()). Agents themselves are created through the real
 * onboarding mutation so the {accountId, agentId} rows are valid.
 */

import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
});

const DAY = 86_400_000;

async function setupAgent(
  t: ReturnType<typeof convexTest>,
  subject: string
): Promise<{ agentId: Id<"gtmAgents">; accountId: Id<"creators"> }> {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  return { agentId: started.agentId, accountId: started.accountId };
}

async function seedWrap(
  t: ReturnType<typeof convexTest>,
  args: {
    accountId: Id<"creators">;
    agentId: Id<"gtmAgents">;
    token: string;
    platform?: string;
    draftId?: Id<"gtmDraftedContent">;
    createdAt?: number;
  }
): Promise<Id<"gtmLinkWraps">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("gtmLinkWraps", {
      accountId: args.accountId,
      agentId: args.agentId,
      token: args.token,
      destinationUrl: `https://${args.token}.test/signup`,
      platform: args.platform,
      draftId: args.draftId,
      createdAt: args.createdAt ?? Date.now(),
    })
  );
}

async function seedClick(
  t: ReturnType<typeof convexTest>,
  args: {
    accountId: Id<"creators">;
    agentId: Id<"gtmAgents">;
    linkWrapId: Id<"gtmLinkWraps">;
    platform?: string;
    clickedAt: number;
  }
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("gtmLinkClicks", {
      accountId: args.accountId,
      agentId: args.agentId,
      linkWrapId: args.linkWrapId,
      platform: args.platform,
      clickedAt: args.clickedAt,
    });
  });
}

async function seedConversion(
  t: ReturnType<typeof convexTest>,
  args: {
    accountId: Id<"creators">;
    agentId: Id<"gtmAgents">;
    kind: "signup" | "demo" | "feedback" | "revenue";
    count: number;
    linkWrapId?: Id<"gtmLinkWraps">;
    occurredAt: number;
  }
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("gtmConversions", {
      accountId: args.accountId,
      agentId: args.agentId,
      kind: args.kind,
      count: args.count,
      source: "self_report",
      linkWrapId: args.linkWrapId,
      occurredAt: args.occurredAt,
    });
  });
}

function read(
  t: ReturnType<typeof convexTest>,
  args: {
    agentId: Id<"gtmAgents">;
    accountId: Id<"creators">;
    limit?: number;
    windowDays?: number;
  }
) {
  return t.query(internal.gtmMaya.attribution.listAgentPostAttribution, args);
}

describe("listAgentPostAttribution — read-back", () => {
  it("CROSS-TENANT: agent A never sees agent B's data; account-mismatched wrap excluded", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_read_a");
    const b = await setupAgent(t, "u_read_b");

    // Agent A: one wrap with 2 clicks + 1 signup.
    const aWrap = await seedWrap(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      token: "aaa1",
      platform: "reddit",
    });
    await seedClick(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      linkWrapId: aWrap,
      clickedAt: Date.now(),
    });
    await seedClick(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      linkWrapId: aWrap,
      clickedAt: Date.now(),
    });
    await seedConversion(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      kind: "signup",
      count: 1,
      linkWrapId: aWrap,
      occurredAt: Date.now(),
    });

    // Agent B: its OWN wrap with very different volume — must never leak into A.
    const bWrap = await seedWrap(t, {
      accountId: b.accountId,
      agentId: b.agentId,
      token: "bbb1",
      platform: "x",
    });
    for (let i = 0; i < 9; i++) {
      await seedClick(t, {
        accountId: b.accountId,
        agentId: b.agentId,
        linkWrapId: bWrap,
        clickedAt: Date.now(),
      });
    }
    await seedConversion(t, {
      accountId: b.accountId,
      agentId: b.agentId,
      kind: "signup",
      count: 7,
      linkWrapId: bWrap,
      occurredAt: Date.now(),
    });

    // Poison row: a wrap carrying agent A's agentId but agent B's accountId.
    // The by_agent index picks it up; the accountId filter must drop it.
    const poison = await seedWrap(t, {
      accountId: b.accountId, // mismatched account
      agentId: a.agentId, // A's agent
      token: "poison1",
      platform: "hn",
    });
    await seedClick(t, {
      accountId: b.accountId,
      agentId: a.agentId,
      linkWrapId: poison,
      clickedAt: Date.now(),
    });

    // Read as A.
    const resA = await read(t, { agentId: a.agentId, accountId: a.accountId });
    expect(resA.posts.length).toBe(1);
    expect(resA.posts[0].platform).toBe("reddit");
    expect(resA.posts[0].clicks).toBe(2);
    expect(resA.posts[0].signups).toBe(1);
    expect(resA.totals.clicks).toBe(2);
    expect(resA.totals.signups).toBe(1);
    // B's 9 clicks / 7 signups and the poison wrap never appear.
    const aPlatforms = resA.posts.map((p) => p.platform);
    expect(aPlatforms).not.toContain("x");
    expect(aPlatforms).not.toContain("hn");

    // Read as B — symmetric isolation.
    const resB = await read(t, { agentId: b.agentId, accountId: b.accountId });
    expect(resB.posts.length).toBe(1);
    expect(resB.posts[0].platform).toBe("x");
    expect(resB.posts[0].clicks).toBe(9);
    expect(resB.posts[0].signups).toBe(7);
    expect(resB.totals.clicks).toBe(9);
    expect(resB.totals.signups).toBe(7);
  });

  it("per-post join: N clicks + a linked signup surface together; sorted signups desc then clicks desc", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_read_join");

    // A draft so the title resolves to draft text (same-account verified).
    const draftId = await t.run(async (ctx) =>
      ctx.db.insert("gtmDraftedContent", {
        accountId: a.accountId,
        agentId: a.agentId,
        kind: "post",
        platform: "reddit",
        draftText: "Show HN: we built a bug-report tool",
        slopCriticPassed: true,
        approvalState: "published",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

    // Wrap 1: 4 clicks, 1 signup → should sort FIRST (has the signup).
    const w1 = await seedWrap(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      token: "join1",
      platform: "reddit",
      draftId,
    });
    for (let i = 0; i < 4; i++) {
      await seedClick(t, {
        accountId: a.accountId,
        agentId: a.agentId,
        linkWrapId: w1,
        clickedAt: Date.now(),
      });
    }
    await seedConversion(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      kind: "signup",
      count: 1,
      linkWrapId: w1,
      occurredAt: Date.now(),
    });

    // Wrap 2: 10 clicks, 0 signups → more clicks but no signup, sorts SECOND.
    const w2 = await seedWrap(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      token: "join2",
      platform: "x",
    });
    for (let i = 0; i < 10; i++) {
      await seedClick(t, {
        accountId: a.accountId,
        agentId: a.agentId,
        linkWrapId: w2,
        clickedAt: Date.now(),
      });
    }

    // Wrap 3: 2 clicks, 0 signups → fewest clicks, sorts THIRD.
    const w3 = await seedWrap(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      token: "join3",
      platform: "hn",
    });
    await seedClick(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      linkWrapId: w3,
      clickedAt: Date.now(),
    });
    await seedClick(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      linkWrapId: w3,
      clickedAt: Date.now(),
    });

    const res = await read(t, { agentId: a.agentId, accountId: a.accountId });
    expect(res.posts.length).toBe(3);

    // Sort: signups desc, then clicks desc.
    expect(res.posts[0].platform).toBe("reddit"); // 1 signup wins
    expect(res.posts[0].signups).toBe(1);
    expect(res.posts[0].clicks).toBe(4);
    expect(res.posts[0].draftId).toBe(draftId);
    expect(res.posts[0].title).toBe("Show HN: we built a bug-report tool");
    expect(res.posts[1].platform).toBe("x"); // 0 signups, 10 clicks
    expect(res.posts[1].clicks).toBe(10);
    expect(res.posts[2].platform).toBe("hn"); // 0 signups, 2 clicks
    expect(res.posts[2].clicks).toBe(2);

    // Totals roll up across the surfaced posts.
    expect(res.totals.clicks).toBe(16);
    expect(res.totals.signups).toBe(1);
    expect(res.totals.untiedSignups).toBe(0);
  });

  it("windowDays: a click/conversion older than the window is EXCLUDED when set, INCLUDED when omitted", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_read_window");
    const now = Date.now();

    const wrap = await seedWrap(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      token: "win1",
      platform: "reddit",
    });

    // One recent click (1 day ago) + one stale click (10 days ago).
    await seedClick(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      linkWrapId: wrap,
      clickedAt: now - 1 * DAY,
    });
    await seedClick(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      linkWrapId: wrap,
      clickedAt: now - 10 * DAY,
    });

    // One recent signup (1 day ago) + one stale signup (10 days ago).
    await seedConversion(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      kind: "signup",
      count: 1,
      linkWrapId: wrap,
      occurredAt: now - 1 * DAY,
    });
    await seedConversion(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      kind: "signup",
      count: 1,
      linkWrapId: wrap,
      occurredAt: now - 10 * DAY,
    });

    // Lifetime (omitted) — everything counts.
    const lifetime = await read(t, {
      agentId: a.agentId,
      accountId: a.accountId,
    });
    expect(lifetime.windowDays).toBeNull();
    expect(lifetime.posts.length).toBe(1);
    expect(lifetime.posts[0].clicks).toBe(2);
    expect(lifetime.posts[0].signups).toBe(2);
    expect(lifetime.totals.clicks).toBe(2);
    expect(lifetime.totals.signups).toBe(2);

    // 7-day window — the 10-day-old click + signup drop out.
    const windowed = await read(t, {
      agentId: a.agentId,
      accountId: a.accountId,
      windowDays: 7,
    });
    expect(windowed.windowDays).toBe(7);
    expect(windowed.posts.length).toBe(1);
    expect(windowed.posts[0].clicks).toBe(1);
    expect(windowed.posts[0].signups).toBe(1);
    expect(windowed.totals.clicks).toBe(1);
    expect(windowed.totals.signups).toBe(1);
  });

  it("untiedSignups: a signup with no linkWrapId shows in totals.untiedSignups, tied to no post", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_read_untied");

    // A wrap with clicks but NO conversion (so a post still surfaces).
    const wrap = await seedWrap(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      token: "untied1",
      platform: "reddit",
    });
    await seedClick(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      linkWrapId: wrap,
      clickedAt: Date.now(),
    });

    // A signup with NO linkWrapId — real, but un-attributable to any post.
    await seedConversion(t, {
      accountId: a.accountId,
      agentId: a.agentId,
      kind: "signup",
      count: 3,
      occurredAt: Date.now(),
    });

    const res = await read(t, { agentId: a.agentId, accountId: a.accountId });
    expect(res.totals.untiedSignups).toBe(3);
    // The untied signup is NOT attributed to the surfaced post.
    expect(res.posts.length).toBe(1);
    expect(res.posts[0].signups).toBe(0);
    expect(res.totals.signups).toBe(0);
    expect(res.posts[0].clicks).toBe(1);
  });

  it("empty case: agent with no wraps → posts:[], all totals zero", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_read_empty");

    const res = await read(t, { agentId: a.agentId, accountId: a.accountId });
    expect(res.posts).toEqual([]);
    expect(res.totals).toEqual({
      clicks: 0,
      signups: 0,
      demos: 0,
      feedback: 0,
      revenue: 0,
      activated: 0,
      untiedSignups: 0,
    });
    expect(res.windowDays).toBeNull();
  });
});
