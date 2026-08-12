/**
 * ⭐ §14.45 rung 1 — the bio link. "None — always on."
 *
 * ## Why a bio link, not a link in every caption
 *
 * §16.3's worked example names the bridge directly:
 *
 * > *"the gap is the bio link — 310 people looked at your profile and 38
 * > clicked."*
 *
 * And L3 measures *"profile visits, link clicks"*. On TikTok and Instagram an
 * in-post link is not clickable at all, so the bio is the only bridge — and
 * pushing a URL into every caption would cost reach on the one channel where
 * it does work, trading the product's core job for a metric.
 *
 * ## ⚠️ The property everything rests on: it NEVER changes
 *
 * The founder pastes this into their profile **by hand**. There is no
 * bio-write API and the product never logs in as them (§5). So a token that
 * rotates points every already-pasted bio at nothing — and the clicks simply
 * stop, with no error raised anywhere and no way for anyone to notice.
 *
 * That is the single most important assertion in this file.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { modules } from "./_modules";
import { bioLinkUrl } from "../convex/maya/attribution";
import { bioLinkAsk } from "../convex/maya/weeklyReport";
import { minimalRow, type InsertCtx } from "./lib/minimalRow";

const PRODUCT = JSON.stringify({ url: "https://hey-maya.ai", name: "HeyMaya" });

/**
 * ⚠️ `productTruthJson` takes `null` for "absent", not `undefined`.
 *
 * Passing `undefined` explicitly triggers the JS DEFAULT PARAMETER, so the
 * no-URL case silently got the product URL and the test passed for the wrong
 * reason — it asserted a refusal that never happened.
 */
async function seed(
  ctx: unknown,
  clerkUserId: string,
  productTruthJson: string | null = PRODUCT,
): Promise<string> {
  const c = ctx as InsertCtx & {
    db: { insert: (t: string, v: unknown) => Promise<string> };
  };
  const creatorId = (await c.db.insert(
    "creators",
    await minimalRow(c, "creators", {
      clerkUserId,
      email: `${clerkUserId}@example.com`,
      accountType: "gtm-agent",
    }),
  )) as string;
  return (await c.db.insert(
    "customers",
    await minimalRow(c, "customers", {
      accountId: creatorId,
      productTruthJson: productTruthJson ?? undefined,
    }),
  )) as string;
}

describe("the bio link never changes", () => {
  it("⭐ returns the SAME token every time it is asked", async () => {
    const t = convexTest(schema, modules);
    const customerId = await t.run((ctx) => seed(ctx, "user_bio"));

    const first = await t.mutation(internal.maya.attribution.ensureBioLink, {
      customerId: customerId as never,
      channel: "tiktok",
    });
    const second = await t.mutation(internal.maya.attribution.ensureBioLink, {
      customerId: customerId as never,
      channel: "tiktok",
    });
    const third = await t.mutation(internal.maya.attribution.ensureBioLink, {
      customerId: customerId as never,
      channel: "tiktok",
    });

    expect(first.ok).toBe(true);
    expect(first.token).toBeTruthy();
    /**
     * ⚠️ If this ever fails, every founder who already pasted the link has a
     * dead bio and nothing anywhere reports it. There is deliberately no
     * "regenerate" path for this reason.
     */
    expect(second.token).toBe(first.token);
    expect(third.token).toBe(first.token);

    // And exactly one row — not three that happen to agree.
    await t.run(async (ctx) => {
      const wraps = await ctx.db.query("gtmLinkWraps").collect();
      expect(wraps).toHaveLength(1);
    });
  });

  it("gives each channel its own link, so clicks are attributable", async () => {
    // §14.45's own reporting example: "3 traced from the TikTok bio link, 2
    // likely from the Shorts description" — which needs per-channel tokens.
    const t = convexTest(schema, modules);
    const customerId = await t.run((ctx) => seed(ctx, "user_multi"));

    const tiktok = await t.mutation(internal.maya.attribution.ensureBioLink, {
      customerId: customerId as never,
      channel: "tiktok",
    });
    const instagram = await t.mutation(
      internal.maya.attribution.ensureBioLink,
      {
        customerId: customerId as never,
        channel: "instagram",
      },
    );

    expect(tiktok.token).not.toBe(instagram.token);
  });

  it("⚠️ two customers never share a token", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await t.run(async (ctx) => ({
      a: await seed(ctx, "user_a"),
      b: await seed(ctx, "user_b"),
    }));

    const one = await t.mutation(internal.maya.attribution.ensureBioLink, {
      customerId: a as never,
      channel: "tiktok",
    });
    const two = await t.mutation(internal.maya.attribution.ensureBioLink, {
      customerId: b as never,
      channel: "tiktok",
    });

    // A shared token would send one founder's audience to another's product.
    expect(one.token).not.toBe(two.token);
  });

  it("⚠️ refuses when there is no product URL", async () => {
    /**
     * Grounded or silent (§2.7). A bio link pointing at a placeholder is worse
     * than none: the founder pastes it once and it is wrong forever, and we
     * would be counting clicks to nowhere as a result.
     */
    const t = convexTest(schema, modules);
    const customerId = await t.run((ctx) => seed(ctx, "user_nourl", null));

    const out = await t.mutation(internal.maya.attribution.ensureBioLink, {
      customerId: customerId as never,
      channel: "tiktok",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/product URL/i);

    await t.run(async (ctx) => {
      expect(await ctx.db.query("gtmLinkWraps").collect()).toEqual([]);
    });
  });
});

describe("the URL the founder pastes", () => {
  it("is absolute", () => {
    expect(bioLinkUrl("https://hey-maya.ai", "abc123")).toBe(
      "https://hey-maya.ai/r/abc123",
    );
    // Trailing slashes are the classic way to produce a double-slash URL.
    expect(bioLinkUrl("https://hey-maya.ai/", "abc123")).toBe(
      "https://hey-maya.ai/r/abc123",
    );
  });

  it("⚠️ returns null rather than a half-formed URL", () => {
    /**
     * A relative path in someone's Instagram bio is not a link, and it is
     * permanent damage — they will not go back and fix it. Better to have no
     * link than a broken one pasted into a profile.
     */
    expect(bioLinkUrl("", "abc123")).toBeNull();
    expect(bioLinkUrl("hey-maya.ai", "abc123")).toBeNull();
  });
});

describe("the ask", () => {
  it("leads with the reason, not the request", () => {
    // §14.45 — "that converts far better than a setup step, because the value
    // is already demonstrated."
    const ask = bioLinkAsk("https://hey-maya.ai/r/abc123", "TikTok");
    expect(ask).toContain("https://hey-maya.ai/r/abc123");
    expect(ask).toContain("TikTok");
    expect(ask).toMatch(/which posts are actually sending people/i);
    // Never our vocabulary — no "attribution", no "UTM", no "link wrap" (§11).
    expect(ask).not.toMatch(/attribution|utm|wrap|token/i);
  });
});
