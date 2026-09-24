/**
 * The Opportunities screen's read (app spec §6.6). Mandatory categories: cross-tenant
 * isolation and budget × action fail-closed (a plan without partnerships sees no pipeline).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import { seedCreator } from "../../tests/lib/creatorRow";

const DAY = 86_400_000;

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const solo = await seedCreator(ctx, "solo", { clerkUserId: "user_solo", plan: { status: "active", founding: false, tier: "solo" } });
    const partner = await seedCreator(ctx, "partner", { clerkUserId: "user_partner", plan: { status: "active", founding: false, tier: "partner" } });
    for (const [creatorId, handle] of [[solo, "runner_a"], [partner, "chef_b"]] as const) {
      await ctx.db.insert("trackedAccounts", { creatorId, platform: "tiktok", handle, addedBy: "creator", baselineN: 10, status: "active", createdAt: now });
    }
    const obs = (handle: string, postId: string, paid: boolean, ageDays: number) =>
      ctx.db.insert("observations", { platform: "tiktok", postId, authorHandle: handle, url: `https://www.tiktok.com/@${handle}/video/${postId}`, createTime: now - ageDays * DAY, sampledAt: now - ageDays * DAY, ageHours: 5, views: 1000, likes: 1, comments: 1, shares: 1, keywords: [], source: "account.posts", paidPromotion: paid });
    await obs("runner_a", "1", true, 2);
    await obs("runner_a", "1", true, 1); // the same post sampled twice counts once
    await obs("runner_a", "2", false, 1); // organic: not counted
    await obs("runner_a", "3", true, 45); // older than 30 days: not counted
    await obs("chef_b", "9", true, 1); // another creator's lane: never in solo's count
    await ctx.db.insert("partnershipOpportunities", { creatorId: partner, brandDomain: "brand.com", data: { brand: "Brand", campaign: "Spring", type: "ugc", fit: "fits", status: "shortlisted", route: "email", assessment: { verdict: "recommend" } }, updatedAt: now });
    return { solo, partner };
  });
  return { t, ...ids };
}

describe("opportunities read", () => {
  it("a locked plan sees a grounded teaser from its own lane and no pipeline", async () => {
    const { t } = await setup();
    const r = await t.withIdentity({ subject: "user_solo" }).query(api.ui.opportunities, {});
    expect(r?.unlocked).toBe(false);
    expect(r?.teaser).toEqual({ paidPostsInLane: 1, accountsPaid: 1, days: 30 });
    expect(r?.opportunities).toEqual([]);
    expect(r?.unlockTier).toBe("partner");
  });

  it("the partner plan sees only its own pipeline", async () => {
    const { t } = await setup();
    const r = await t.withIdentity({ subject: "user_partner" }).query(api.ui.opportunities, {});
    expect(r?.unlocked).toBe(true);
    expect(r?.opportunities.map((o) => [o.brand, o.type, o.status, o.verdict])).toEqual([["Brand", "ugc", "shortlisted", "recommend"]]);
    expect(r?.teaser.paidPostsInLane).toBe(1);
  });

  it("no identity, or an identity without a creator, sees null", async () => {
    const { t } = await setup();
    expect(await t.query(api.ui.opportunities, {})).toBeNull();
    expect(await t.withIdentity({ subject: "user_nobody" }).query(api.ui.opportunities, {})).toBeNull();
  });

  it("a lapsed partner plan fails closed: no pipeline", async () => {
    const { t, partner } = await setup();
    await t.run((ctx) => ctx.db.patch(partner, { plan: { status: "canceled", founding: false, tier: "partner" } }));
    const r = await t.withIdentity({ subject: "user_partner" }).query(api.ui.opportunities, {});
    expect(r?.unlocked).toBe(false);
    expect(r?.opportunities).toEqual([]);
  });
});
