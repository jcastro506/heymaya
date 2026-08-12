/**
 * ⭐ §14.45 rung 1, in-post — draft → wrap → publish → bind → clicks.
 *
 * ## The constraint that shapes the whole design
 *
 * `publish.ts` is explicit: *"The text we publish is the text that was
 * approved. Re-generating or re-formatting here would break the snapshot
 * guarantee — the founder said yes to a specific string."*
 *
 * ⚠️ So the tracked link cannot be swapped in at publish — that would publish
 * something the founder never read. It has to be in the text BEFORE they
 * approve it, which is why the wrap is minted at draft time and bound to the
 * placement afterwards.
 *
 * ## And it never invents a link
 *
 * Only a product URL the draft ALREADY contains is rewritten. Adding one would
 * change what she wrote to serve our metrics — and on TikTok and Instagram an
 * in-post link isn't clickable anyway, so it would be caption noise for
 * nothing.
 */

import { describe, expect, it, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { modules } from "./_modules";
import { minimalRow, type InsertCtx } from "./lib/minimalRow";

const PRODUCT = JSON.stringify({ url: "https://hey-maya.ai", name: "HeyMaya" });

const ORIGINAL_APP_URL = process.env.APP_URL;
afterEach(() => {
  if (ORIGINAL_APP_URL === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = ORIGINAL_APP_URL;
});

async function seedCustomer(ctx: unknown): Promise<string> {
  const c = ctx as InsertCtx & {
    db: { insert: (t: string, v: unknown) => Promise<string> };
  };
  const creatorId = (await c.db.insert(
    "creators",
    await minimalRow(c, "creators", {
      clerkUserId: `u_${Math.floor(Math.random() * 1e9)}`,
      email: "founder@example.com",
      accountType: "gtm-agent",
    }),
  )) as string;
  return (await c.db.insert(
    "customers",
    await minimalRow(c, "customers", {
      accountId: creatorId,
      productTruthJson: PRODUCT,
    }),
  )) as string;
}

/** Insert a draft directly — `create` enforces idea-provenance we don't need here. */
async function insertDraft(
  ctx: unknown,
  customerId: string,
  text: string,
): Promise<string> {
  const c = ctx as {
    db: { insert: (t: string, v: unknown) => Promise<string> };
  };
  return await c.db.insert("drafts", {
    customerId,
    channel: "x",
    kind: "post",
    snapshotText: text,
    outcome: "pending",
    proposedAt: 1,
    expiresAt: 10_000_000_000_000,
  });
}

describe("a product link in a post is tracked", () => {
  it("⭐ wraps the link the draft already has, and keeps the deep path", async () => {
    process.env.APP_URL = "https://hey-maya.ai";
    const t = convexTest(schema, modules);

    const { customerId, draftId } = await t.run(async (ctx) => {
      const customerId = await seedCustomer(ctx);
      const draftId = await insertDraft(
        ctx,
        customerId,
        "we rebuilt pricing: https://hey-maya.ai/pricing take a look",
      );
      return { customerId, draftId };
    });

    const wrap = await t.mutation(internal.maya.attribution.wrapForDraft, {
      customerId: customerId as never,
      draftId: draftId as never,
      // ⭐ The deep link, not the product root. Sending someone to the homepage
      // when the post promised a pricing page is worse than not tracking it.
      destinationUrl: "https://hey-maya.ai/pricing",
      channel: "x",
    });

    expect(wrap.ok).toBe(true);
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("gtmLinkWraps").collect();
      expect(row.destinationUrl).toBe("https://hey-maya.ai/pricing");
      expect(row.mayaDraftId).toBe(draftId);
      // Not yet bound — the post doesn't exist at draft time.
      expect(row.placementId).toBeUndefined();
    });
  });

  it("mints one wrap per draft, never two", async () => {
    process.env.APP_URL = "https://hey-maya.ai";
    const t = convexTest(schema, modules);
    const { customerId, draftId } = await t.run(async (ctx) => {
      const customerId = await seedCustomer(ctx);
      return {
        customerId,
        draftId: await insertDraft(ctx, customerId, "x https://hey-maya.ai"),
      };
    });

    const a = await t.mutation(internal.maya.attribution.wrapForDraft, {
      customerId: customerId as never,
      draftId: draftId as never,
      destinationUrl: "https://hey-maya.ai",
      channel: "x",
    });
    const b = await t.mutation(internal.maya.attribution.wrapForDraft, {
      customerId: customerId as never,
      draftId: draftId as never,
      destinationUrl: "https://hey-maya.ai",
      channel: "x",
    });

    // ⚠️ Two wraps would split one post's clicks across two tokens and make
    // both halves quietly wrong — the kind of error that survives because
    // each number looks plausible.
    expect(b.token).toBe(a.token);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("gtmLinkWraps").collect()).toHaveLength(1);
    });
  });

  it("⭐ binds to the placement, and counts clicks against it", async () => {
    const t = convexTest(schema, modules);

    const { customerId, draftId } = await t.run(async (ctx) => {
      const customerId = await seedCustomer(ctx);
      return {
        customerId,
        draftId: await insertDraft(ctx, customerId, "see https://hey-maya.ai"),
      };
    });

    await t.mutation(internal.maya.attribution.wrapForDraft, {
      customerId: customerId as never,
      draftId: draftId as never,
      destinationUrl: "https://hey-maya.ai",
      channel: "x",
    });

    const placementId = await t.run(async (ctx) => {
      const c = ctx as unknown as {
        db: { insert: (t: string, v: unknown) => Promise<string> };
      };
      return await c.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        linkStatus: "live",
        url: "https://x.com/status/1",
        publishedAt: 2,
        snapshotText: "see https://hey-maya.ai",
        draftId,
        idempotencyKey: `k_${Math.floor(Math.random() * 1e9)}`,
      });
    });

    const bound = await t.mutation(
      internal.maya.attribution.bindWrapToPlacement,
      {
        draftId: draftId as never,
        placementId: placementId as never,
        customerId: customerId as never,
      },
    );
    expect(bound.bound).toBe(true);

    // Two clicks arrive.
    await t.run(async (ctx) => {
      const [wrap] = await ctx.db.query("gtmLinkWraps").collect();
      const c = ctx as unknown as {
        db: { insert: (t: string, v: unknown) => Promise<string> };
      };
      for (let i = 0; i < 2; i += 1) {
        await c.db.insert("gtmLinkClicks", {
          accountId: wrap.accountId,
          customerId,
          placementId,
          linkWrapId: wrap._id,
          platform: "x",
          clickedAt: 3,
        });
      }
    });

    const counts = await t.query(
      internal.maya.attribution.clicksForPlacements,
      { customerId: customerId as never },
    );
    expect(counts[String(placementId)]).toBe(2);
  });

  it("⚠️ counts a click that beat the bind", async () => {
    /**
     * `recordClick` stamps `placementId` off the wrap AT CLICK TIME, so a click
     * landing in the milliseconds between publish and bind carries none.
     * Counting through `by_link_wrap` instead of `placementId` is what stops
     * that click being orphaned forever.
     */
    const t = convexTest(schema, modules);
    const { customerId, draftId } = await t.run(async (ctx) => {
      const customerId = await seedCustomer(ctx);
      return {
        customerId,
        draftId: await insertDraft(ctx, customerId, "see https://hey-maya.ai"),
      };
    });

    await t.mutation(internal.maya.attribution.wrapForDraft, {
      customerId: customerId as never,
      draftId: draftId as never,
      destinationUrl: "https://hey-maya.ai",
      channel: "x",
    });

    // The click arrives BEFORE the placement exists — no placementId on it.
    await t.run(async (ctx) => {
      const [wrap] = await ctx.db.query("gtmLinkWraps").collect();
      const c = ctx as unknown as {
        db: { insert: (t: string, v: unknown) => Promise<string> };
      };
      await c.db.insert("gtmLinkClicks", {
        accountId: wrap.accountId,
        customerId,
        linkWrapId: wrap._id,
        platform: "x",
        clickedAt: 1,
      });
    });

    const placementId = await t.run(async (ctx) => {
      const c = ctx as unknown as {
        db: { insert: (t: string, v: unknown) => Promise<string> };
      };
      return await c.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        linkStatus: "live",
        publishedAt: 2,
        snapshotText: "see https://hey-maya.ai",
        draftId,
        idempotencyKey: `k_${Math.floor(Math.random() * 1e9)}`,
      });
    });
    await t.mutation(internal.maya.attribution.bindWrapToPlacement, {
      draftId: draftId as never,
      placementId: placementId as never,
      customerId: customerId as never,
    });

    const counts = await t.query(
      internal.maya.attribution.clicksForPlacements,
      { customerId: customerId as never },
    );
    // The early click still belongs to the post.
    expect(counts[String(placementId)]).toBe(1);
  });

  it("⚠️ will not bind another account's draft", async () => {
    const t = convexTest(schema, modules);
    const { mine, theirDraft, myPlacement } = await t.run(async (ctx) => {
      const mine = await seedCustomer(ctx);
      const theirs = await seedCustomer(ctx);
      const theirDraft = await insertDraft(ctx, theirs, "https://hey-maya.ai");
      const c = ctx as unknown as {
        db: { insert: (t: string, v: unknown) => Promise<string> };
      };
      const myPlacement = await c.db.insert("placements", {
        customerId: mine,
        kind: "post",
        channel: "x",
        linkStatus: "live",
        publishedAt: 2,
        snapshotText: "mine",
        idempotencyKey: `k_${Math.floor(Math.random() * 1e9)}`,
      });
      return { mine, theirDraft, myPlacement };
    });

    await t.mutation(internal.maya.attribution.wrapForDraft, {
      customerId: (await t.run(async (ctx) => {
        const d = await ctx.db.get(theirDraft as never);
        return (d as unknown as { customerId: string }).customerId;
      })) as never,
      draftId: theirDraft as never,
      destinationUrl: "https://hey-maya.ai",
      channel: "x",
    });

    const out = await t.mutation(
      internal.maya.attribution.bindWrapToPlacement,
      {
        draftId: theirDraft as never,
        placementId: myPlacement as never,
        customerId: mine as never,
      },
    );
    // Their clicks must never be credited to my post.
    expect(out.bound).toBe(false);
  });
});
