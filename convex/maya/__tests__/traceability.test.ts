/**
 * ⭐ Complaint → content tracking (§5.0.0) — the number that tests the pitch.
 *
 * > *"The pitch is **not** 'she posts for you' — open-source schedulers do that
 * > for free. It's that **she does the homework**."*
 *
 * A scheduler cannot produce this number at all. If it sits near zero we are a
 * scheduler with better prose.
 *
 * First live run, 2026-08-08: **1 of 7**.
 */
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { BUYER_SOURCES, COMPLAINT_SOURCES } from "../traceability";

const NOW = Date.UTC(2026, 7, 8, 12, 0);

async function seed(t: ReturnType<typeof convexTest>): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: "u_trace",
      email: "trace@example.com",
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function post(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  key: string,
  idea?: { source: string; quote?: string; url?: string }
) {
  return await t.run(async (ctx) => {
    let ideaId: Id<"ideas"> | undefined;
    if (idea) {
      ideaId = await ctx.db.insert("ideas", {
        customerId,
        angle: `angle ${key}`,
        status: "used",
        sourceKind: idea.source,
        evidenceJson: JSON.stringify({
          quote: idea.quote ?? "someone actually said this",
          sourceUrls: idea.url === undefined ? ["https://x.com/a/status/1"] : idea.url ? [idea.url] : [],
        }),
        createdAt: NOW,
        updatedAt: NOW,
      });
    }
    return await ctx.db.insert("placements", {
      customerId,
      kind: "post",
      channel: "x",
      linkStatus: "live",
      url: `https://x.com/w/status/${key}`,
      publishedAt: NOW,
      snapshotText: `post ${key}`,
      idempotencyKey: key,
      ideaId,
    });
  });
}

describe("what counts as homework", () => {
  it("a post from a mined complaint counts, and counts twice over", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await post(t, customerId, "a", { source: "complaint" });

    const r = await t.query(internal.maya.traceability.traceability, {
      customerId,
      now: NOW,
    });
    expect(r.traceable).toBe(1);
    expect(r.fromComplaints).toBe(1);
  });

  it("a post from a real observation counts, but not as a complaint", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await post(t, customerId, "a", { source: "observation" });

    const r = await t.query(internal.maya.traceability.traceability, {
      customerId,
      now: NOW,
    });
    expect(r.traceable).toBe(1);
    expect(r.fromComplaints).toBe(0);
  });

  it("⛔ a format card and the founder's own idea do NOT count", async () => {
    // Both are real, neither is a buyer saying something. Counting them would
    // make the number measure activity instead of listening.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await post(t, customerId, "a", { source: "format_card" });
    await post(t, customerId, "b", { source: "founder" });
    await post(t, customerId, "c", { source: "performance" });

    const r = await t.query(internal.maya.traceability.traceability, {
      customerId,
      now: NOW,
    });
    expect(r.traceable).toBe(0);
    expect(r.untraced).toBe(3);
  });

  it("⚠️ evidence with no openable URL does not count", async () => {
    // Otherwise the number rises by RELABELLING an idea rather than by doing
    // the work — the failure mode every self-reported metric has.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await post(t, customerId, "a", { source: "complaint", url: "" });

    const r = await t.query(internal.maya.traceability.traceability, {
      customerId,
      now: NOW,
    });
    expect(r.traceable).toBe(0);
  });

  it("a post with no idea at all is untraced, not an error", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await post(t, customerId, "a");

    const r = await t.query(internal.maya.traceability.traceability, {
      customerId,
      now: NOW,
    });
    expect(r.untraced).toBe(1);
    expect(r.share).toBe(0);
  });
});

describe("the number is reported so it can be argued with", () => {
  it("⭐ carries an openable example, not just a percentage", async () => {
    // A share with no receipt is a claim. The live run's example was a real
    // tweet asking "what is the hardest part about growing on X for you?".
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await post(t, customerId, "a", {
      source: "complaint",
      quote: "what is the hardest part about growing on X for you?",
      url: "https://x.com/andreyiscoding/status/2085057182752505980",
    });

    const r = await t.query(internal.maya.traceability.traceability, {
      customerId,
      now: NOW,
    });
    expect(r.example?.quote).toContain("hardest part");
    expect(r.example?.sourceUrl).toContain("x.com");
  });

  it("always states the denominator", async () => {
    // "71%" of seven posts is five, and five is a number a founder can argue
    // with. §14.3: this product cannot report trends at founder volume.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await post(t, customerId, "a", { source: "complaint" });
    await post(t, customerId, "b");

    const r = await t.query(internal.maya.traceability.traceability, {
      customerId,
      now: NOW,
    });
    expect(r.detail).toMatch(/1 of 2/);
  });

  it("nothing published is null, never zero percent", async () => {
    // 0% reads as failure; "nothing went live" is a different fact.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const r = await t.query(internal.maya.traceability.traceability, {
      customerId,
      now: NOW,
    });
    expect(r.share).toBeNull();
    expect(r.detail).toMatch(/nothing went live/);
  });

  it("a dead link stops counting, in the numerator and denominator both", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const id = await post(t, customerId, "a", { source: "complaint" });
    await t.run((ctx) => ctx.db.patch(id, { linkStatus: "gone" }));

    const r = await t.query(internal.maya.traceability.traceability, {
      customerId,
      now: NOW,
    });
    expect(r.posts).toBe(0);
    expect(r.share).toBeNull();
  });
});

describe("the source lists say what they mean", () => {
  it("every complaint source is also a buyer source", () => {
    for (const s of COMPLAINT_SOURCES) {
      expect(BUYER_SOURCES as readonly string[]).toContain(s);
    }
  });
});
