/**
 * Attribution (§14.45, Sprint 8) — "which post got the signup".
 *
 * That sentence is the product's central claim, so the thing under test is not
 * really whether the chain joins up. It's whether the answer is honest when a
 * hop is missing — because a confident line built on a guessed hop is worse
 * than no line at all, and it is the specific lie this product exists not to
 * tell.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { TOKEN_LENGTH, makeToken } from "../attribution";
import type { Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);

async function seed(t: ReturnType<typeof convexTest>, suffix: string) {
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
    const customerId = await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const placementId = await ctx.db.insert("placements", {
      customerId,
      channel: "x",
      kind: "post",
      url: "https://x.com/i/status/1",
      idempotencyKey: `idem_${suffix}`,
      publishedAt: NOW,
      snapshotText: "the post text",
      linkStatus: "live",
    });
    return { accountId, customerId, placementId };
  });
}

/**
 * Insert a placement-bound wrap directly.
 *
 * ⚠️ `attribution.wrapForPlacement` was deleted 2026-08-12 — it had no
 * production caller. The live path mints at DRAFT time (`wrapForDraft`) and
 * binds after publish (`bindWrapToPlacement`), because `publish.ts` may not
 * alter approved text. These tests are about `traceConversion`, so the wrap is
 * fixture setup and a direct insert says so plainly.
 */
async function wrapFor(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  placementId: Id<"placements">,
  token: string,
): Promise<{ token: string }> {
  await t.run(async (ctx) => {
    const customer = await ctx.db.get(customerId);
    await ctx.db.insert("gtmLinkWraps", {
      accountId: (customer as { accountId: Id<"creators"> }).accountId,
      customerId,
      placementId,
      token,
      destinationUrl: "https://example.com",
      platform: "x",
      utmMedium: "social",
      createdAt: NOW,
    });
  });
  return { token };
}

describe("makeToken", () => {
  it("is the right length", () => {
    expect(makeToken(() => 0.5)).toHaveLength(TOKEN_LENGTH);
  });

  /**
   * ⚠️ A founder reads these aloud and types them by hand more often than you'd
   * expect, and a token that resolves to the WRONG post is worse than one that
   * resolves to nothing.
   */
  it("omits the characters people misread", () => {
    const all = Array.from({ length: 200 }, (_, i) =>
      makeToken(() => i / 200),
    ).join("");
    for (const ch of ["l", "o", "0", "1"]) {
      expect(all, `token alphabet must not contain "${ch}"`).not.toContain(ch);
    }
  });
});

describe("traceConversion", () => {
  it("traces a pixel-reported signup to the post and the idea", async () => {
    const t = convexTest(schema, modules);
    const { customerId, placementId } = await seed(t, "trace_full");

    // The idea the post was built from — the provenance half of the chain.
    const ideaId = await t.run(async (ctx) =>
      ctx.db.insert("ideas", {
        customerId,
        angle: "people keep asking how to export",
        evidenceJson: JSON.stringify({
          sourceUrls: ["https://reddit.com/r/x/1"],
        }),
        status: "used",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    await t.run(async (ctx) => ctx.db.patch(placementId, { ideaId }));

    const { token } = await wrapFor(t, customerId, placementId, "tok_trace");
    const { conversionId } = await t.mutation(
      internal.maya.attribution.recordConversion,
      {
        customerId,
        kind: "signup",
        count: 1,
        source: "pixel",
        token,
        now: NOW,
      },
    );

    const trace = await t.query(internal.maya.attribution.traceConversion, {
      conversionId: conversionId as Id<"gtmConversions">,
    });
    expect(trace.ok).toBe(true);
    expect(trace.hops.map((h) => h.step)).toEqual([
      "conversion",
      "link",
      "placement",
      "idea",
    ]);
    // ⭐ §6: a source you can't open isn't a source.
    expect(trace.hops.find((h) => h.step === "placement")?.url).toBeTruthy();
    expect(trace.hops.find((h) => h.step === "idea")?.url).toBeTruthy();
  });

  /**
   * ⭐ The one that matters most.
   *
   * A self-reported signup with no token is a REAL signup and an UNPROVEN
   * attribution. Naming a post would be invented certainty (§2.7) — so the
   * trace has to stop and say where.
   */
  it("refuses to name a post it cannot prove", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seed(t, "trace_break");

    const { conversionId } = await t.mutation(
      internal.maya.attribution.recordConversion,
      { customerId, kind: "signup", count: 2, source: "self_report", now: NOW },
    );
    const trace = await t.query(internal.maya.attribution.traceConversion, {
      conversionId: conversionId as Id<"gtmConversions">,
    });

    expect(trace.ok).toBe(false);
    expect(trace.breaksAt).toBe("link");
    expect(trace.hops).toHaveLength(1);
    // The signup itself is still reported — it happened.
    expect(trace.hops[0].step).toBe("conversion");
    expect(trace.detail).toMatch(/can't say which post/i);
  });

  it("ignores a token belonging to another account", async () => {
    // The pixel runs on the founder's own site; its input is not ours.
    const t = convexTest(schema, modules);
    const a = await seed(t, "tok_a");
    const b = await seed(t, "tok_b");
    const { token } = await wrapFor(
      t,
      b.customerId,
      b.placementId,
      "tok_other",
    );
    const { conversionId } = await t.mutation(
      internal.maya.attribution.recordConversion,
      {
        customerId: a.customerId,
        kind: "signup",
        count: 1,
        source: "pixel",
        token,
        now: NOW,
      },
    );
    const trace = await t.query(internal.maya.attribution.traceConversion, {
      conversionId: conversionId as Id<"gtmConversions">,
    });
    expect(trace.ok).toBe(false);
    expect(trace.breaksAt).toBe("link");
  });
});

describe("recentConversions", () => {
  /**
   * ⚠️ Untraceable conversions are INCLUDED. A results view showing only the
   * attributable ones overstates how much we can explain — the same failure
   * §18's "never report inventory as results" test exists to catch, pointed at
   * attribution instead of drafts.
   */
  it("includes the ones it couldn't trace, marked as such", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seed(t, "recent");
    await t.mutation(internal.maya.attribution.recordConversion, {
      customerId,
      kind: "signup",
      count: 1,
      source: "self_report",
      now: NOW,
    });
    const rows = await t.query(internal.maya.attribution.recentConversions, {
      customerId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].traced).toBe(false);
  });
});
