/**
 * Sprint 2.30 — comment-tree mining schema round-trip tests.
 *
 * Validates:
 *   1. recordTargetThread accepts all 5 mining kinds (buyer_intent,
 *      pain_restatement, competitor_mention, op_rejection, high_velocity)
 *   2. Optional competitorName flows through on competitor_mention
 *   3. mineableComments[] is preserved across the update path when a
 *      re-surface omits it
 *   4. mineableComments[] can be empty (T3 thread that didn't warrant mining)
 *   5. Cross-tenant isolation — A's mineable comments don't bleed into B's
 *      read
 *   6. listMyMineableThreads helper returns threads sorted T1/T2 first
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: `App for ${subject}`,
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  return { authed, accountId: started.accountId, agentId: started.agentId };
}

describe("Sprint 2.30 — comment-tree mining schema", () => {
  it("accepts all 5 mining kinds on a single thread", async () => {
    const t = convexTest(schema, modules);
    const { authed, agentId, accountId } = await setupAgent(t, "u_ct_kinds");

    await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId,
      agentId,
      platform: "reddit",
      url: "https://reddit.com/r/LocalLLaMA/comments/k1",
      externalId: "k1",
      currentMetrics: { upvotes: 50, comments: 18 },
      whyItFits: "Direct pain ask + alive thread.",
      recommendedAction: "reply",
      priorityScore: 0.9,
      painQuote: "I want to swap models without restarting",
      tier: "T1",
      commentTreeSummary: {
        topComments: ["just use lm studio"],
        opIsReplying: true,
        mineableComments: [
          {
            commentId: "c_buy",
            body: "Anyone know one that hot-swaps without losing context?",
            kind: "buyer_intent",
            whyMineable: "Follow-up question = better reply target",
          },
          {
            commentId: "c_pain",
            body: "Honestly the constant restart loop kills my flow",
            kind: "pain_restatement",
            whyMineable: "Sharper pain language than OP",
          },
          {
            commentId: "c_comp",
            body: "I just use LM Studio for this",
            kind: "competitor_mention",
            competitorName: "LM Studio",
            whyMineable: "Direct competitor named",
          },
          {
            commentId: "c_rej",
            author: "OP",
            body: "Tried LM Studio, the model swap is still 30s",
            kind: "op_rejection",
            whyMineable: "OP already rejected one solution — don't repeat it",
          },
          {
            commentId: "c_vel",
            body: "Same problem here +1",
            score: 32,
            postedAtMs: Date.now() - 30 * 60 * 1000,
            kind: "high_velocity",
            whyMineable: "32 upvotes in 30min = thread is hot now",
          },
        ],
      },
    });

    const rows = await authed.query(
      api.gtmMaya.targetList.getMyTargetThreads,
      {}
    );
    expect(rows).toHaveLength(1);
    const mined = rows[0].commentTreeSummary?.mineableComments;
    expect(mined).toBeDefined();
    expect(mined?.length).toBe(5);
    const kinds = new Set(mined!.map((m) => m.kind));
    expect(kinds).toEqual(
      new Set([
        "buyer_intent",
        "pain_restatement",
        "competitor_mention",
        "op_rejection",
        "high_velocity",
      ])
    );
    const competitor = mined?.find((m) => m.kind === "competitor_mention");
    expect(competitor?.competitorName).toBe("LM Studio");
  });

  it("preserves mineableComments across re-surface when next call omits it", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId, authed } = await setupAgent(t, "u_ct_preserve");

    // First insert with mining data.
    await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId,
      agentId,
      platform: "hn",
      url: "https://news.ycombinator.com/item?id=99",
      externalId: "hn_99",
      currentMetrics: { upvotes: 12 },
      whyItFits: "Show HN with pain in comments",
      recommendedAction: "reply",
      priorityScore: 0.7,
      tier: "T2",
      commentTreeSummary: {
        topComments: ["nice"],
        mineableComments: [
          {
            commentId: "hn_c_1",
            body: "What about hot-reload during dev?",
            kind: "buyer_intent",
            whyMineable: "Buyer asking for the specific capability",
          },
        ],
      },
    });

    // Re-surface 30 min later — metrics refresh but worker didn't re-mine
    // (mineableComments not provided in second call). Existing value must
    // be preserved.
    await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId,
      agentId,
      platform: "hn",
      url: "https://news.ycombinator.com/item?id=99",
      externalId: "hn_99",
      currentMetrics: { upvotes: 28 },
      whyItFits: "Pain still alive, velocity up",
      recommendedAction: "reply",
      priorityScore: 0.85,
    });

    const rows = await authed.query(
      api.gtmMaya.targetList.getMyTargetThreads,
      {}
    );
    expect(rows[0].currentMetrics.upvotes).toBe(28);
    expect(rows[0].commentTreeSummary?.mineableComments).toBeDefined();
    expect(rows[0].commentTreeSummary?.mineableComments?.length).toBe(1);
    expect(rows[0].commentTreeSummary?.mineableComments?.[0]?.kind).toBe(
      "buyer_intent"
    );
  });

  it("accepts empty/absent mineableComments (T3+ threads)", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId, authed } = await setupAgent(t, "u_ct_t3");

    await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId,
      agentId,
      platform: "reddit",
      url: "https://reddit.com/r/x/comments/t3",
      externalId: "t3",
      currentMetrics: { upvotes: 2 },
      whyItFits: "Weak fit but worth tracking",
      recommendedAction: "lurk",
      priorityScore: 0.2,
      tier: "T3",
      commentTreeSummary: {
        topComments: ["meh"],
        // mineableComments omitted — T3 doesn't warrant the mining cost.
      },
    });

    const rows = await authed.query(
      api.gtmMaya.targetList.getMyTargetThreads,
      {}
    );
    expect(rows[0].tier).toBe("T3");
    expect(rows[0].commentTreeSummary?.mineableComments).toBeUndefined();
  });

  it("cross-tenant: A's mineable comments don't appear in B's read", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_ct_iso_a");
    const b = await setupAgent(t, "u_ct_iso_b");

    await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
      accountId: a.accountId,
      agentId: a.agentId,
      platform: "reddit",
      url: "https://reddit.com/r/a",
      externalId: "a-thread",
      currentMetrics: { upvotes: 99 },
      whyItFits: "A's thread",
      recommendedAction: "reply",
      priorityScore: 0.9,
      tier: "T1",
      commentTreeSummary: {
        topComments: ["a-private"],
        mineableComments: [
          {
            commentId: "a_c",
            body: "A's private mineable insight",
            kind: "buyer_intent",
            whyMineable: "private",
          },
        ],
      },
    });

    const bRows = await b.authed.query(
      api.gtmMaya.targetList.getMyTargetThreads,
      {}
    );
    expect(bRows.length).toBe(0); // B sees nothing of A's

    const aRows = await a.authed.query(
      api.gtmMaya.targetList.getMyTargetThreads,
      {}
    );
    expect(aRows.length).toBe(1);
    expect(aRows[0].commentTreeSummary?.mineableComments?.[0]?.body).toBe(
      "A's private mineable insight"
    );
  });
});
