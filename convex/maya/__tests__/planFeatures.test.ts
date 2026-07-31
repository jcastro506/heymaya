import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import {
  budgetsFor,
  MVP_BUDGETS,
  verdictFor,
  ZERO_BUDGETS,
  type Budgets,
} from "../planFeatures";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);

async function seed(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  state: "onboarding" | "active" | "paused" | "cancelled" = "active"
): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "web",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state,
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

describe("budgets, never booleans", () => {
  it("every budget is a NUMBER — no capability flags anywhere", () => {
    // The rule that stops `canImage: false` from shipping again. Under this
    // channel set that flag made three of four channels unusable.
    for (const [key, value] of Object.entries(MVP_BUDGETS)) {
      expect(typeof value, key).toBe("number");
    }
  });

  it("MVP unlocks all four channels — the tier is a volume, not a subset", () => {
    expect(MVP_BUDGETS.maxChannels).toBe(4);
  });

  it("zero is a valid budget, not a missing capability", () => {
    // A future Solo tier sets videosPerMonth: 0 and still plans video, still
    // asks for footage, and degrades. It must not become a capability wall.
    const soloish: Budgets = { ...MVP_BUDGETS, videosPerMonth: 0 };
    const check = verdictFor("videosPerMonth", 0, soloish);
    expect(check.verdict).toBe("graceful_degrade");
    expect(check.verdict).not.toBe("hard_block");
  });
});

describe("fail-closed", () => {
  it("an unknown customer gets zero of everything", () => {
    expect(budgetsFor(null)).toEqual(ZERO_BUDGETS);
  });

  it("a paused account can't act on the world", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "paused", "paused");
    const budgets = await t.query(internal.maya.planFeatures.planFeatures, {
      customerId,
    });
    expect(budgets).toEqual(ZERO_BUDGETS);
  });

  it("a cancelled account likewise — but the row survives", async () => {
    // Paused and cancelled stop the work; neither deletes data. Trial expiry
    // without a card lands here, not in a purge.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "cancelled", "cancelled");
    expect(
      await t.query(internal.maya.planFeatures.planFeatures, { customerId })
    ).toEqual(ZERO_BUDGETS);
    expect(await t.run((ctx) => ctx.db.get(customerId))).not.toBeNull();
  });

  it("an onboarding account still has its budgets — it just hasn't used them", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "onboarding", "onboarding");
    expect(
      await t.query(internal.maya.planFeatures.planFeatures, { customerId })
    ).toEqual(MVP_BUDGETS);
  });

  it("a post check against a nonexistent customer hard-blocks", async () => {
    const t = convexTest(schema, modules);
    const real = await seed(t, "ghost");
    await t.run((ctx) => ctx.db.delete(real));
    const check = await t.query(internal.maya.planFeatures.checkPostBudget, {
      customerId: real,
      channel: "x",
    });
    expect(check.verdict).toBe("hard_block");
    expect(check.reason).toBe("account not found");
  });
});

describe("verdictFor", () => {
  it("under the limit is full, with the remainder reported", () => {
    const check = verdictFor("postsPerDayPerChannel", 1, MVP_BUDGETS);
    expect(check.verdict).toBe("full");
    expect(check.remaining).toBe(1);
  });

  it("at the limit is exhausted, not still-allowed (off-by-one guard)", () => {
    const check = verdictFor("postsPerDayPerChannel", 2, MVP_BUDGETS);
    expect(check.verdict).toBe("hard_block");
    expect(check.remaining).toBe(0);
  });

  it("video exhaustion degrades rather than blocks — a cheaper rung exists", () => {
    expect(verdictFor("videosPerMonth", 4, MVP_BUDGETS).verdict).toBe(
      "graceful_degrade"
    );
  });

  it("the spend ceiling throttles rather than stopping dead", () => {
    // Caps THROTTLE, never destroy — destroying the machine on cap is a
    // design bug this product already shipped once.
    expect(verdictFor("dailySpendCeilingUsd", 5, MVP_BUDGETS).verdict).toBe(
      "graceful_degrade"
    );
  });

  it("overshooting never reports negative remaining", () => {
    expect(verdictFor("postsPerDayPerChannel", 99, MVP_BUDGETS).remaining).toBe(0);
  });

  it("reasons are plain language, with no jargon or symbols", () => {
    for (const used of [0, 2, 99]) {
      const { reason } = verdictFor("postsPerDayPerChannel", used, MVP_BUDGETS);
      expect(reason).not.toMatch(/[_{}]|verdict|hard_block/);
    }
  });
});

describe("checkPostBudget — counts real placements", () => {
  async function placePost(
    t: ReturnType<typeof convexTest>,
    customerId: Id<"customers">,
    channel: string,
    publishedAt: number,
    key: string
  ) {
    await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId,
        kind: "post",
        channel,
        linkStatus: "live",
        publishedAt,
        snapshotText: "x",
        idempotencyKey: key,
      })
    );
  }

  it("allows the first post of the day and blocks past the cap", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "posts");

    let check = await t.query(internal.maya.planFeatures.checkPostBudget, {
      customerId,
      channel: "x",
      now: NOW,
    });
    expect(check.verdict).toBe("full");

    await placePost(t, customerId, "x", NOW, "p1");
    await placePost(t, customerId, "x", NOW, "p2");

    check = await t.query(internal.maya.planFeatures.checkPostBudget, {
      customerId,
      channel: "x",
      now: NOW,
    });
    expect(check.verdict).toBe("hard_block");
    expect(check.used).toBe(2);
  });

  it("the cap is PER CHANNEL — a full X day doesn't block TikTok", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "per_channel");
    await placePost(t, customerId, "x", NOW, "c1");
    await placePost(t, customerId, "x", NOW, "c2");

    const check = await t.query(internal.maya.planFeatures.checkPostBudget, {
      customerId,
      channel: "tiktok",
      now: NOW,
    });
    expect(check.verdict).toBe("full");
  });

  it("yesterday's posts don't count against today", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "rollover");
    await placePost(t, customerId, "x", NOW - 86_400_000, "y1");
    await placePost(t, customerId, "x", NOW - 86_400_000, "y2");

    const check = await t.query(internal.maya.planFeatures.checkPostBudget, {
      customerId,
      channel: "x",
      now: NOW,
    });
    expect(check.verdict).toBe("full");
    expect(check.used).toBe(0);
  });

  it("replies don't consume the POST budget", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "replies");
    await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId,
        kind: "reply",
        channel: "x",
        linkStatus: "live",
        publishedAt: NOW,
        snapshotText: "answering someone",
        idempotencyKey: "r1",
      })
    );
    const check = await t.query(internal.maya.planFeatures.checkPostBudget, {
      customerId,
      channel: "x",
      now: NOW,
    });
    // Answering is unlimited and always — gating community management is the
    // one thing the product refuses to do.
    expect(check.used).toBe(0);
  });

  it("another tenant's posts never consume this one's budget", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "budget_a");
    const b = await seed(t, "budget_b");
    await placePost(t, b, "x", NOW, "b1");
    await placePost(t, b, "x", NOW, "b2");

    const check = await t.query(internal.maya.planFeatures.checkPostBudget, {
      customerId: a,
      channel: "x",
      now: NOW,
    });
    expect(check.verdict).toBe("full");
    expect(check.used).toBe(0);
  });
});

describe("checkChannelBudget", () => {
  async function connect(
    t: ReturnType<typeof convexTest>,
    customerId: Id<"customers">,
    channel: "tiktok" | "instagram" | "youtube" | "x",
    status: "connected" | "dormant"
  ) {
    await t.run((ctx) =>
      ctx.db.insert("channels", {
        customerId,
        channel,
        postingMode: "show_me_first",
        status,
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
  }

  it("counts connected channels against maxChannels", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "channels");
    for (const c of ["tiktok", "instagram", "youtube", "x"] as const) {
      await connect(t, customerId, c, "connected");
    }
    const check = await t.query(internal.maya.planFeatures.checkChannelBudget, {
      customerId,
    });
    expect(check.used).toBe(4);
    expect(check.verdict).toBe("hard_block");
  });

  it("dormant channels don't count — they exist to be reactivated", async () => {
    // An over-cap channel after a downgrade keeps its OAuth grant. Counting it
    // would block the reactivation it's preserved for.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "dormant");
    await connect(t, customerId, "tiktok", "connected");
    await connect(t, customerId, "instagram", "dormant");

    const check = await t.query(internal.maya.planFeatures.checkChannelBudget, {
      customerId,
    });
    expect(check.used).toBe(1);
    expect(check.verdict).toBe("full");
  });
});

describe("checkVideoBudget", () => {
  async function renderJob(
    t: ReturnType<typeof convexTest>,
    customerId: Id<"customers">,
    status: "succeeded" | "failed",
    createdAt: number,
    key: string
  ) {
    await t.run((ctx) =>
      ctx.db.insert("jobs", {
        customerId,
        kind: "render_video",
        idempotencyKey: key,
        status,
        attempts: 1,
        maxAttempts: 3,
        runAfter: createdAt,
        deadlineAt: createdAt + 60_000,
        createdAt,
        updatedAt: createdAt,
      })
    );
  }

  it("degrades once the monthly allowance is spent", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "video");
    for (let i = 0; i < 4; i += 1) {
      await renderJob(t, customerId, "succeeded", NOW, `v${i}`);
    }
    const check = await t.query(internal.maya.planFeatures.checkVideoBudget, {
      customerId,
      now: NOW,
    });
    expect(check.verdict).toBe("graceful_degrade");
    expect(check.reason).toMatch(/cheaper option/);
  });

  it("a FAILED render doesn't burn the allowance", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "video_failed");
    await renderJob(t, customerId, "failed", NOW, "vf");
    const check = await t.query(internal.maya.planFeatures.checkVideoBudget, {
      customerId,
      now: NOW,
    });
    expect(check.used).toBe(0);
  });

  it("last month's renders don't count against this month", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "video_month");
    for (let i = 0; i < 4; i += 1) {
      await renderJob(t, customerId, "succeeded", Date.UTC(2026, 5, 15), `p${i}`);
    }
    const check = await t.query(internal.maya.planFeatures.checkVideoBudget, {
      customerId,
      now: NOW,
    });
    expect(check.used).toBe(0);
    expect(check.verdict).toBe("full");
  });
});
