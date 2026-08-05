import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Doc, Id } from "../../_generated/dataModel";
import { check, CHANNEL_LIMITS, xWeightedLength } from "../preflight";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);

function channelRow(over: Partial<Doc<"channels">> = {}): Doc<"channels"> {
  return {
    _id: "ch1" as Id<"channels">,
    _creationTime: NOW,
    customerId: "c1" as Id<"customers">,
    channel: "x",
    postingMode: "just_go",
    status: "connected",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as Doc<"channels">;
}

describe("xWeightedLength — X does not count characters", () => {
  it("plain ASCII weighs one each", () => {
    expect(xWeightedLength("hello")).toBe(5);
  });

  it("A URL COUNTS AS 23, however long it is", () => {
    // The rule that matters most. A long tracking link costs 23, so counting
    // literally would reject posts that are actually fine — and the founder
    // would never learn their good post was needlessly cut.
    const short = "https://a.co";
    const long =
      "https://example.com/blog/2026/07/the-migration-that-did-not-roll-back?utm_source=x&utm_campaign=launch";
    expect(xWeightedLength(short)).toBe(23);
    expect(xWeightedLength(long)).toBe(23);
    expect(long.length).toBeGreaterThan(100);
  });

  it("a naive length check would reject a post that actually fits", () => {
    // 250 chars of text + a 105-char URL = 355 by String.length, but 273 by
    // X's rules. This exact case is a false rejection.
    const text = "a".repeat(250);
    const url =
      "https://example.com/blog/2026/07/the-migration-that-did-not-roll-back?utm_source=x&utm_campaign=launch";
    const post = `${text} ${url}`;
    expect(post.length).toBeGreaterThan(280);
    expect(xWeightedLength(post)).toBe(250 + 1 + 23);
    expect(xWeightedLength(post)).toBeLessThanOrEqual(280);
  });

  it("emoji weigh two", () => {
    expect(xWeightedLength("🎉")).toBe(2);
    expect(xWeightedLength("ok 🎉")).toBe(5);
  });

  it("CJK weighs two", () => {
    expect(xWeightedLength("日本語")).toBe(6);
  });

  it("counts several URLs independently", () => {
    expect(xWeightedLength("https://a.co https://b.co")).toBe(23 + 1 + 23);
  });

  it("an empty string is zero", () => {
    expect(xWeightedLength("")).toBe(0);
  });
});

describe("check — named failures, not booleans", () => {
  const ok = { channel: "x", channelRow: channelRow(), duplicateOf: null };

  it("passes a normal post and reports its weighted length", () => {
    const result = check({ ...ok, text: "shipped it. here's what broke." });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.weightedLength).toBe(30);
  });

  it("empty text fails before anything else", () => {
    const result = check({ ...ok, text: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("empty");
  });

  it("over-length says exactly how far over", () => {
    const result = check({ ...ok, text: "a".repeat(295) });
    expect(result.ok).toBe(false);
    if (!result.ok && result.failure.kind === "over_length") {
      expect(result.failure.limit).toBe(280);
      expect(result.failure.actual).toBe(295);
      expect(result.failure.overBy).toBe(15);
      expect(result.message).toMatch(/15 characters too long/);
    }
  });

  it("exactly at the limit passes — the off-by-one that would silently cut posts", () => {
    const result = check({ ...ok, text: "a".repeat(280) });
    expect(result.ok).toBe(true);
  });

  it("one over the limit fails", () => {
    expect(check({ ...ok, text: "a".repeat(281) }).ok).toBe(false);
  });

  it.each([
    ["error" as const],
    ["disconnected" as const],
  ])("a channel in %s is a token problem, surfaced once here not as a 401", (status) => {
    const result = check({ ...ok, text: "hi", channelRow: channelRow({ status }) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("token_expired");
      expect(result.message).toMatch(/reconnect/i);
    }
  });

  it("a missing channel is its own named failure", () => {
    const result = check({ ...ok, text: "hi", channelRow: null });
    if (!result.ok) expect(result.failure.kind).toBe("channel_missing");
  });

  it("a duplicate names the post it already went out as", () => {
    const result = check({
      ...ok,
      text: "hi",
      duplicateOf: { url: "https://x.com/dana/1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("duplicate");
      expect(result.message).toContain("https://x.com/dana/1");
    }
  });

  it("every message is founder-readable — no codes, no field names", () => {
    const cases = [
      { text: "" },
      { text: "a".repeat(400) },
      { text: "hi", channelRow: channelRow({ status: "error" as const }) },
      { text: "hi", duplicateOf: { url: "https://x.com/d/1" } },
    ];
    for (const c of cases) {
      const result = check({ ...ok, ...c });
      if (!result.ok) {
        expect(result.message).not.toMatch(/\b(401|403|null|undefined|snapshotText|kind)\b/);
        expect(result.message.length).toBeGreaterThan(10);
      }
    }
  });

  it("the other channels get their own, looser limits", () => {
    expect(CHANNEL_LIMITS.instagram).toBe(2200);
    const result = check({
      ...ok,
      channel: "instagram",
      text: "a".repeat(1000),
      channelRow: channelRow({ channel: "instagram" }),
    });
    expect(result.ok).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

async function seed(t: ReturnType<typeof convexTest>, suffix: string, text: string) {
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
    await ctx.db.insert("channels", {
      customerId,
      channel: "x",
      postingMode: "just_go",
      status: "connected",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const draftId = await ctx.db.insert("drafts", {
      customerId,
      channel: "x",
      kind: "post",
      snapshotText: text,
      outcome: "pending",
      proposedAt: NOW,
      expiresAt: NOW + 86_400_000,
    });
    return { customerId, draftId };
  });
}

describe("preflightDraft through Convex", () => {
  it("passes a good draft", async () => {
    const t = convexTest(schema, modules);
    const { customerId, draftId } = await seed(t, "good", "a real post");
    const result = await t.query(internal.maya.preflight.preflightDraft, {
      customerId,
      draftId,
    });
    expect(result.ok).toBe(true);
  });

  it("catches a duplicate against this customer's own recent placements", async () => {
    const t = convexTest(schema, modules);
    const { customerId, draftId } = await seed(t, "dup", "the same exact sentence");
    await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        url: "https://x.com/dup/1",
        linkStatus: "live",
        publishedAt: Date.now() - 3600_000,
        snapshotText: "the same exact sentence",
        idempotencyKey: "k1",
      })
    );
    const result = await t.query(internal.maya.preflight.preflightDraft, {
      customerId,
      draftId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("duplicate");
  });

  it("CROSS-TENANT: another founder posting the same sentence is not a duplicate", async () => {
    // Two founders in the same niche will write the same obvious sentence.
    // Treating that as a duplicate would block real posts.
    const t = convexTest(schema, modules);
    const a = await seed(t, "dup_a", "shipped it");
    const b = await seed(t, "dup_b", "shipped it");
    await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId: b.customerId,
        kind: "post",
        channel: "x",
        linkStatus: "live",
        publishedAt: Date.now() - 3600_000,
        snapshotText: "shipped it",
        idempotencyKey: "kb",
      })
    );
    const result = await t.query(internal.maya.preflight.preflightDraft, {
      customerId: a.customerId,
      draftId: a.draftId,
    });
    expect(result.ok).toBe(true);
  });

  it("the same text on a DIFFERENT channel is not a duplicate", async () => {
    const t = convexTest(schema, modules);
    const { customerId, draftId } = await seed(t, "xchan", "cross-posted line");
    await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "instagram",
        linkStatus: "live",
        publishedAt: Date.now() - 3600_000,
        snapshotText: "cross-posted line",
        idempotencyKey: "ki",
      })
    );
    const result = await t.query(internal.maya.preflight.preflightDraft, {
      customerId,
      draftId,
    });
    expect(result.ok).toBe(true);
  });

  it("an old placement past the window no longer counts as a duplicate", async () => {
    const t = convexTest(schema, modules);
    const { customerId, draftId } = await seed(t, "old", "seasonal post");
    await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        linkStatus: "live",
        publishedAt: Date.now() - 90 * 24 * 3600_000,
        snapshotText: "seasonal post",
        idempotencyKey: "kold",
      })
    );
    const result = await t.query(internal.maya.preflight.preflightDraft, {
      customerId,
      draftId,
    });
    expect(result.ok).toBe(true);
  });

  it("a draft from another account never previews", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "iso_a", "mine");
    const b = await seed(t, "iso_b", "theirs");
    const result = await t.query(internal.maya.preflight.preflightDraft, {
      customerId: a.customerId,
      draftId: b.draftId,
    });
    expect(result.ok).toBe(false);
  });
});
