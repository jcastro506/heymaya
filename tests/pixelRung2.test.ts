/**
 * ⭐ §14.45 rung 2 — the conversion pixel, for the live module.
 *
 * > *"**Pixel** — one snippet on their site | **Per-signup attribution to a
 * > specific post** | one paste | **Precise**"*
 *
 * The pixel, the redirect's `lc_ref` handoff and the CORS plumbing have existed
 * since Sprint 8. But the public handler refused any wrap without an `agentId`
 * — which is **every wrap the live module mints** — and said so in a comment.
 * So rung 2 was off for the only accounts that exist.
 *
 * ## ⚠️ Why the token cannot be the credential
 *
 * It sits in a bio and in published posts. Anyone who reads one can POST to an
 * unauthenticated endpoint. A forged signup is not harmless: it corrupts the
 * number §16.2 says they cancel over, and §14.45's honesty rule is the entire
 * point of the layer.
 *
 * `Origin` is the check. A page on someone else's domain cannot set it to the
 * founder's — the browser does that, not the page.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { modules } from "./_modules";
import { minimalRow, type InsertCtx } from "./lib/minimalRow";

const PRODUCT = JSON.stringify({
  url: "https://theirsite.com",
  name: "Theirs",
});

async function seedWithWrap(
  ctx: unknown,
  token: string,
  productTruthJson: string | null = PRODUCT,
): Promise<string> {
  const c = ctx as InsertCtx & {
    db: { insert: (t: string, v: unknown) => Promise<string> };
  };
  const creatorId = (await c.db.insert(
    "creators",
    await minimalRow(c, "creators", {
      clerkUserId: `u_${token}`,
      email: `${token}@example.com`,
      accountType: "gtm-agent",
    }),
  )) as string;
  const customerId = (await c.db.insert(
    "customers",
    await minimalRow(c, "customers", {
      accountId: creatorId,
      productTruthJson: productTruthJson ?? undefined,
    }),
  )) as string;
  await c.db.insert("gtmLinkWraps", {
    accountId: creatorId,
    customerId,
    token,
    destinationUrl: "https://theirsite.com",
    platform: "x",
    utmMedium: "social",
    createdAt: 1,
  });
  return customerId;
}

async function conversions(
  t: ReturnType<typeof convexTest>,
  customerId: string,
) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query("gtmConversions").collect();
    return rows.filter((r) => r.customerId === customerId);
  });
}

describe("the pixel records a signup for a live customer", () => {
  it("⭐ records when the origin matches the product", async () => {
    const t = convexTest(schema, modules);
    const customerId = await t.run((ctx) => seedWithWrap(ctx, "tok_ok"));

    const out = await t.mutation(
      internal.maya.attribution.recordPixelConversion,
      { token: "tok_ok", kind: "signup", origin: "https://theirsite.com" },
    );

    expect(out.recorded).toBe(true);
    const rows = await conversions(t, customerId);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("pixel");
    // ⭐ The whole point of rung 2: it names the exact post.
    expect(rows[0].linkWrapId).toBeTruthy();
  });

  it("accepts a subdomain — app.theirsite.com is still theirs", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedWithWrap(ctx, "tok_sub"));

    const out = await t.mutation(
      internal.maya.attribution.recordPixelConversion,
      { token: "tok_sub", kind: "signup", origin: "https://app.theirsite.com" },
    );
    expect(out.recorded).toBe(true);
  });

  it("⚠️ REFUSES a forged conversion from another domain", async () => {
    /**
     * The load-bearing case. The token is public — anyone who reads a post has
     * it. Without this, a stranger can inflate a founder's signups from their
     * own page, and the corrupted number is indistinguishable from a real one
     * forever after.
     */
    const t = convexTest(schema, modules);
    const customerId = await t.run((ctx) => seedWithWrap(ctx, "tok_forge"));

    const out = await t.mutation(
      internal.maya.attribution.recordPixelConversion,
      {
        token: "tok_forge",
        kind: "signup",
        origin: "https://attacker.example",
      },
    );

    expect(out.recorded).toBe(false);
    expect(out.reason).toMatch(/origin/i);
    expect(await conversions(t, customerId)).toEqual([]);
  });

  it("⚠️ counts a reloaded signup page once", async () => {
    // An inflated number is worse than a missing one — it is the figure that
    // decides whether they believe any of the rest (§14.45's honesty rule).
    const t = convexTest(schema, modules);
    const customerId = await t.run((ctx) => seedWithWrap(ctx, "tok_dupe"));

    const first = await t.mutation(
      internal.maya.attribution.recordPixelConversion,
      { token: "tok_dupe", kind: "signup", origin: "https://theirsite.com" },
    );
    const second = await t.mutation(
      internal.maya.attribution.recordPixelConversion,
      { token: "tok_dupe", kind: "signup", origin: "https://theirsite.com" },
    );

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(second.reason).toMatch(/already counted/i);
    expect(await conversions(t, customerId)).toHaveLength(1);
  });

  it("still counts a different kind from the same post", async () => {
    // A signup and a demo off one post are two real outcomes, not a duplicate.
    const t = convexTest(schema, modules);
    const customerId = await t.run((ctx) => seedWithWrap(ctx, "tok_kinds"));

    await t.mutation(internal.maya.attribution.recordPixelConversion, {
      token: "tok_kinds",
      kind: "signup",
      origin: "https://theirsite.com",
    });
    await t.mutation(internal.maya.attribution.recordPixelConversion, {
      token: "tok_kinds",
      kind: "demo",
      origin: "https://theirsite.com",
    });

    expect(await conversions(t, customerId)).toHaveLength(2);
  });

  it("says nothing useful about an unknown token", async () => {
    // A stranger probing tokens must not learn which ones are real.
    const t = convexTest(schema, modules);
    const out = await t.mutation(
      internal.maya.attribution.recordPixelConversion,
      { token: "not_a_token", kind: "signup", origin: "https://theirsite.com" },
    );
    expect(out.recorded).toBe(false);
  });

  it("⚠️ refuses when the account has no product URL to match against", async () => {
    /**
     * With nothing to compare the origin to, "does this match?" has no answer —
     * and an unanswerable check must not default to yes.
     */
    const t = convexTest(schema, modules);
    const customerId = await t.run((ctx) =>
      seedWithWrap(ctx, "tok_nourl", null),
    );

    const out = await t.mutation(
      internal.maya.attribution.recordPixelConversion,
      { token: "tok_nourl", kind: "signup", origin: "https://theirsite.com" },
    );

    expect(out.recorded).toBe(false);
    expect(await conversions(t, customerId)).toEqual([]);
  });
});
