/**
 * Today queries — Sprint 4 acceptance.
 *
 * Covers the 5 mandatory categories for the Today screen reads:
 *   1. Cross-tenant isolation — Creator A's brief, deals, posts never
 *      surface for Creator B's identity, even when they share IDs/keys.
 *   2. Plan-tier gating — `outlierPosts` returns [] for Starter even when
 *      the brief contains outlier ids (Starter doesn't run the post-publish
 *      reaction; the outlier surface is fail-closed).
 *   3. Adversarial — unauth identity returns nullish/empty cleanly; no
 *      brief for today returns null without throwing; brief with no
 *      pending items + no revenue returns sane defaults.
 *   4. Sibling-file scan — covered repo-wide by sprint1Acceptance.
 *   5. TODO grep — covered repo-wide by sprint1Acceptance.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";

const NOW = 1_700_000_000_000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    plan: "starter" | "pro" | "studio";
  }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

describe("today.latestBrief", () => {
  it("returns null when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const brief = await t.query(api.today.latestBrief, {});
    expect(brief).toBeNull();
  });

  it("returns null when the creator has no brief yet (today not written)", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const brief = await asUser(t, "a").query(api.today.latestBrief, {});
    expect(brief).toBeNull();
  });

  it("returns the most recent brief by creation time", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await t.run((ctx) =>
      ctx.db.insert("dailyBriefs", {
        creatorId: a,
        briefDateLocal: "2026-04-25",
        markdown: "older brief",
        recommendations: [],
        pendingItems: [],
        outlierPostIds: [],
        generatedAt: NOW - 86_400_000,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("dailyBriefs", {
        creatorId: a,
        briefDateLocal: "2026-04-26",
        markdown: "today's brief",
        recommendations: [],
        pendingItems: [],
        outlierPostIds: [],
        generatedAt: NOW,
      })
    );
    const brief = await asUser(t, "a").query(api.today.latestBrief, {});
    expect(brief).not.toBeNull();
    expect(brief?.markdown).toBe("today's brief");
  });

  it("CROSS-TENANT: creator A never sees creator B's brief", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    await t.run((ctx) =>
      ctx.db.insert("dailyBriefs", {
        creatorId: b,
        briefDateLocal: "2026-04-26",
        markdown: "B's brief",
        recommendations: [],
        pendingItems: [],
        outlierPostIds: [],
        generatedAt: NOW,
      })
    );
    // sanity: creator a referenced (consumed)
    expect(a).toBeDefined();
    const brief = await asUser(t, "a").query(api.today.latestBrief, {});
    expect(brief).toBeNull();
  });
});

describe("today.pendingItems", () => {
  it("returns [] when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const items = await t.query(api.today.pendingItems, {});
    expect(items).toEqual([]);
  });

  it("surfaces draft arc entries + active brand deals, sorted by kind priority", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    // a content plan with one draft + one approved entry
    await t.run((ctx) =>
      ctx.db.insert("contentPlans", {
        creatorId: a,
        weekStartLocal: "2026-04-20",
        arc: [
          {
            dayOffset: 0,
            platform: "tiktok",
            format: "video",
            hookOptions: ["POV: …"],
            captionDraft: "x",
            postingTimeLocal: "12:00",
            status: "draft",
          },
          {
            dayOffset: 1,
            platform: "instagram",
            format: "reel",
            hookOptions: ["wait for it"],
            captionDraft: "y",
            postingTimeLocal: "18:00",
            status: "approved",
          },
        ],
        rationale: "test",
        generatedAt: NOW,
      })
    );
    // brand deals: one new (brand-email), one signed (deliverable), one paid (excluded)
    await t.run((ctx) =>
      ctx.db.insert("brandDeals", {
        creatorId: a,
        brand: "Glossier",
        status: "new",
        deliverables: [],
        riskFlags: [],
        replyVariants: [],
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("brandDeals", {
        creatorId: a,
        brand: "Nike",
        status: "signed",
        deliverables: ["1 reel", "1 story"],
        riskFlags: [],
        replyVariants: [],
        dueAt: NOW + 7 * 86_400_000,
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("brandDeals", {
        creatorId: a,
        brand: "Whoop",
        status: "paid",
        deliverables: [],
        riskFlags: [],
        replyVariants: [],
        paidAmountUsd: 1500,
        paidAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      })
    );

    const items = await asUser(t, "a").query(api.today.pendingItems, {});
    // brand-email first, then deliverable, then draft. paid is excluded.
    expect(items.map((i) => i.kind)).toEqual([
      "brand-email",
      "deliverable",
      "draft",
    ]);
    expect(items[0].title).toContain("Glossier");
    expect(items[1].title).toContain("Nike");
  });

  it("CROSS-TENANT: creator A's pending list excludes creator B's deals", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    await t.run((ctx) =>
      ctx.db.insert("brandDeals", {
        creatorId: b,
        brand: "Forbidden",
        status: "new",
        deliverables: [],
        riskFlags: [],
        replyVariants: [],
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    // sanity: a referenced
    expect(a).toBeDefined();
    const items = await asUser(t, "a").query(api.today.pendingItems, {});
    expect(items).toEqual([]);
  });
});

describe("today.revenueWidget", () => {
  it("returns mtdUsd=0 + zeroed 30-day trend when no paid deals", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const r = await asUser(t, "a").query(api.today.revenueWidget, {});
    expect(r).not.toBeNull();
    expect(r?.mtdUsd).toBe(0);
    expect(r?.trend).toHaveLength(30);
    expect(r?.trend.every((v) => v === 0)).toBe(true);
  });

  it("CROSS-TENANT: B's paid deals do not contribute to A's MTD", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    expect(a).toBeDefined();
    await t.run((ctx) =>
      ctx.db.insert("brandDeals", {
        creatorId: b,
        brand: "B-only",
        status: "paid",
        deliverables: [],
        riskFlags: [],
        replyVariants: [],
        paidAmountUsd: 9999,
        paidAt: Date.now(),
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const r = await asUser(t, "a").query(api.today.revenueWidget, {});
    expect(r?.mtdUsd).toBe(0);
  });
});

describe("today.outlierPosts", () => {
  it("PLAN-TIER (CRITICAL): Starter returns [] even if brief has outlier ids", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    const post = await t.run((ctx) =>
      ctx.db.insert("posts", {
        creatorId: a,
        platform: "tiktok",
        platformPostId: "p1",
        url: "https://tt/x",
        caption: "should not surface",
        mediaType: "video",
        postedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("dailyBriefs", {
        creatorId: a,
        briefDateLocal: "2026-04-26",
        markdown: "x",
        recommendations: [],
        pendingItems: [],
        outlierPostIds: [post],
        generatedAt: NOW,
      })
    );
    const out = await asUser(t, "a").query(api.today.outlierPosts, {});
    expect(out).toEqual([]);
  });

  it("PLAN-TIER: Pro returns the outlier posts referenced by the latest brief", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const post = await t.run((ctx) =>
      ctx.db.insert("posts", {
        creatorId: a,
        platform: "tiktok",
        platformPostId: "p1",
        url: "https://tt/x",
        caption: "outlier",
        mediaType: "video",
        postedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("dailyBriefs", {
        creatorId: a,
        briefDateLocal: "2026-04-26",
        markdown: "x",
        recommendations: [],
        pendingItems: [],
        outlierPostIds: [post],
        generatedAt: NOW,
      })
    );
    const out = await asUser(t, "a").query(api.today.outlierPosts, {});
    expect(out).toHaveLength(1);
    expect(out[0]._id).toBe(post);
  });

  it("CROSS-TENANT: defensive filter drops outlier ids that point to another creator's post", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    const bPost = await t.run((ctx) =>
      ctx.db.insert("posts", {
        creatorId: b,
        platform: "tiktok",
        platformPostId: "p1",
        url: "https://tt/x",
        caption: "B's post — must never leak",
        mediaType: "video",
        postedAt: NOW,
      })
    );
    // Pathological brief on A pointing at B's post.
    await t.run((ctx) =>
      ctx.db.insert("dailyBriefs", {
        creatorId: a,
        briefDateLocal: "2026-04-26",
        markdown: "x",
        recommendations: [],
        pendingItems: [],
        outlierPostIds: [bPost],
        generatedAt: NOW,
      })
    );
    const out = await asUser(t, "a").query(api.today.outlierPosts, {});
    expect(out).toEqual([]);
  });

  it("ADVERSARIAL: returns [] when no brief exists", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const out = await asUser(t, "a").query(api.today.outlierPosts, {});
    expect(out).toEqual([]);
  });
});
