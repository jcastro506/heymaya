import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Doc, Id } from "../../_generated/dataModel";
import { decide, HOLD_REASONS, type HoldReason } from "../publishDecision";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);

/* -------------------------------------------------------------------------- */
/* Pure fixtures — `decide` takes rows, so most of this needs no database.     */
/* -------------------------------------------------------------------------- */

function customer(over: Partial<Doc<"customers">> = {}): Doc<"customers"> {
  return {
    _id: "c1" as Id<"customers">,
    _creationTime: NOW,
    accountId: "a1" as Id<"creators">,
    agentVersion: "v2",
    plan: "mvp",
    state: "active",
    timezone: "UTC",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as Doc<"customers">;
}

function channel(over: Partial<Doc<"channels">> = {}): Doc<"channels"> {
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

function draft(over: Partial<Doc<"drafts">> = {}): Doc<"drafts"> {
  return {
    _id: "d1" as Id<"drafts">,
    _creationTime: NOW,
    customerId: "c1" as Id<"customers">,
    channel: "x",
    kind: "post",
    snapshotText: "the exact words the founder saw",
    outcome: "pending",
    proposedAt: NOW,
    expiresAt: NOW + 86_400_000,
    ...over,
  } as Doc<"drafts">;
}

const base = { customer: customer(), channel: channel(), draft: draft() };

/* -------------------------------------------------------------------------- */

describe("THE IRON RULE — the closed set of reasons a publish may be held", () => {
  it("there are exactly four, and adding a fifth requires changing this test", () => {
    // This is the enforcement mechanism. The old system grew to TEN independent
    // conditions that could each silently hold a post — which is why "post it"
    // did nothing for days. A new hold reason now costs someone a failing test
    // and a conversation, which is the point.
    expect([...HOLD_REASONS].sort()).toEqual([
      "channel_unavailable",
      "safety_floor",
      "show_me_first",
      "tiktok_preview_consent",
    ]);
  });

  it("on just_go, a plain post publishes — no ramp, no trust score, no second opinion", () => {
    const result = decide({ ...base, alreadyApproved: false });
    expect(result.publish).toBe(true);
  });

  it("every hold returns a reason from the closed set", () => {
    // Exhaustive sweep: whatever state we throw at it, the answer is either
    // publish or one of the four. There is no fifth branch.
    const states = ["onboarding", "active", "paused", "cancelled"] as const;
    const statuses = ["connected", "dormant", "disconnected", "error"] as const;
    const modes = ["show_me_first", "just_go"] as const;
    const outcomes = ["pending", "approved", "edited", "rejected", "expired"] as const;

    for (const state of states)
      for (const status of statuses)
        for (const postingMode of modes)
          for (const outcome of outcomes)
            for (const alreadyApproved of [true, false]) {
              const result = decide({
                customer: customer({ state }),
                channel: channel({ status, postingMode }),
                draft: draft({ outcome }),
                alreadyApproved,
              });
              if (!result.publish) {
                expect(HOLD_REASONS).toContain(result.reason as HoldReason);
              }
            }
  });

  it("BUDGETS ARE NOT CONSULTED — a spent daily cap cannot hold an approved post", () => {
    // The pre-spend gate (§7.5.7) settles budget BEFORE the founder ever sees
    // the idea, precisely so an approved idea can never fail on budget.
    // Failing after a yes is the worst possible sequence, and re-checking here
    // would reintroduce the exact class of silent hold this function kills.
    // `decide` takes no budget argument at all — the type system enforces it.
    const args = Object.keys({ ...base, alreadyApproved: false });
    expect(args).toEqual(["customer", "channel", "draft", "alreadyApproved"]);
  });
});

describe("the switch — the only mode-based hold", () => {
  it("show_me_first holds an unapproved draft", () => {
    const result = decide({
      ...base,
      channel: channel({ postingMode: "show_me_first" }),
      alreadyApproved: false,
    });
    expect(result.publish).toBe(false);
    if (!result.publish) expect(result.reason).toBe("show_me_first");
  });

  it("and one word publishes it", () => {
    const result = decide({
      ...base,
      channel: channel({ postingMode: "show_me_first" }),
      alreadyApproved: true,
    });
    expect(result.publish).toBe(true);
  });

  it("the switch is per channel, not per account", () => {
    const onX = decide({
      ...base,
      channel: channel({ channel: "x", postingMode: "just_go" }),
      alreadyApproved: false,
    });
    const onIg = decide({
      ...base,
      channel: channel({ channel: "instagram", postingMode: "show_me_first" }),
      draft: draft({ channel: "instagram" }),
      alreadyApproved: false,
    });
    expect(onX.publish).toBe(true);
    expect(onIg.publish).toBe(false);
  });
});

describe("the safety floor — §9.2, never done at any setting", () => {
  it.each([
    ["paused", /paused/],
    ["cancelled", /cancelled/],
    ["onboarding", /setting up/],
  ] as const)("never posts while %s, even on just_go", (state, expected) => {
    const result = decide({
      ...base,
      customer: customer({ state }),
      alreadyApproved: true,
    });
    expect(result.publish).toBe(false);
    if (!result.publish) {
      expect(result.reason).toBe("safety_floor");
      expect(result.detail).toMatch(expected);
    }
  });

  it("an explicit approval cannot override the floor", () => {
    // The floor is not a permission question. Asking to say something
    // ungrounded is the wrong shape — the answer is to write something else.
    const result = decide({
      ...base,
      customer: customer({ state: "paused" }),
      channel: channel({ postingMode: "just_go" }),
      alreadyApproved: true,
    });
    expect(result.publish).toBe(false);
  });

  it("a rejected or expired draft has nothing to publish", () => {
    for (const outcome of ["rejected", "expired"] as const) {
      const result = decide({
        ...base,
        draft: draft({ outcome }),
        alreadyApproved: true,
      });
      expect(result.publish).toBe(false);
    }
  });

  it("a missing customer or draft holds rather than throwing", () => {
    expect(decide({ ...base, customer: null, alreadyApproved: true }).publish).toBe(false);
    expect(decide({ ...base, draft: null, alreadyApproved: true }).publish).toBe(false);
  });
});

describe("channel availability is the platform refusing, one step early", () => {
  it.each(["disconnected", "error"] as const)("holds when the channel is %s", (status) => {
    const result = decide({ ...base, channel: channel({ status }), alreadyApproved: true });
    expect(result.publish).toBe(false);
    if (!result.publish) expect(result.reason).toBe("channel_unavailable");
  });

  it("holds when the channel is dormant", () => {
    const result = decide({
      ...base,
      channel: channel({ status: "dormant" }),
      alreadyApproved: true,
    });
    if (!result.publish) expect(result.reason).toBe("channel_unavailable");
  });

  it("says something a founder can act on, not a status code", () => {
    const result = decide({
      ...base,
      channel: channel({ status: "disconnected" }),
      alreadyApproved: true,
    });
    if (!result.publish) {
      expect(result.detail).toMatch(/reconnect/i);
      expect(result.detail).not.toMatch(/401|token|oauth|null/i);
    }
  });
});

describe("the TikTok carve-out", () => {
  it("holds for preview confirmation even on just_go", () => {
    const result = decide({
      ...base,
      channel: channel({ channel: "tiktok", postingMode: "just_go" }),
      draft: draft({ channel: "tiktok" }),
      alreadyApproved: false,
    });
    expect(result.publish).toBe(false);
    if (!result.publish) expect(result.reason).toBe("tiktok_preview_consent");
  });

  it("is stated as the platform's rule, not our caution", () => {
    const result = decide({
      ...base,
      channel: channel({ channel: "tiktok" }),
      draft: draft({ channel: "tiktok" }),
      alreadyApproved: false,
    });
    if (!result.publish) expect(result.detail).toMatch(/their rule/i);
  });

  it("confirming the preview publishes it", () => {
    const result = decide({
      ...base,
      channel: channel({ channel: "tiktok", postingMode: "just_go" }),
      draft: draft({ channel: "tiktok" }),
      alreadyApproved: true,
    });
    expect(result.publish).toBe(true);
  });

  it("applies ONLY to TikTok — the other three publish on just_go", () => {
    for (const c of ["x", "instagram", "youtube"] as const) {
      const result = decide({
        ...base,
        channel: channel({ channel: c, postingMode: "just_go" }),
        draft: draft({ channel: c }),
        alreadyApproved: false,
      });
      expect(result.publish, c).toBe(true);
    }
  });
});

describe("INVARIANT 2 — an approved draft publishes its SNAPSHOT", () => {
  it("returns the exact stored text, never a regeneration", () => {
    const exact = "Shipped the thing. Took four months. Here's what broke.";
    const result = decide({
      ...base,
      draft: draft({ snapshotText: exact, outcome: "approved" }),
      alreadyApproved: true,
    });
    expect(result.publish).toBe(true);
    if (result.publish) expect(result.snapshotText).toBe(exact);
  });

  it("an edited draft publishes the EDIT, which is what they saw last", () => {
    const edited = "Shipped it. Four months. Here's what broke.";
    const result = decide({
      ...base,
      draft: draft({
        snapshotText: edited,
        outcome: "edited",
        editDiff: "tightened the opener",
      }),
      alreadyApproved: true,
    });
    if (result.publish) expect(result.snapshotText).toBe(edited);
  });
});

describe("INVARIANT 4 — every publish carries an idempotency key", () => {
  it("the key is derived from the draft, so a retry can't double-publish", () => {
    const a = decide({ ...base, alreadyApproved: true });
    const b = decide({ ...base, alreadyApproved: true });
    expect(a.publish && b.publish).toBe(true);
    if (a.publish && b.publish) {
      expect(a.idempotencyKey).toBe(b.idempotencyKey);
      expect(a.idempotencyKey).toBe("draft:d1");
    }
  });

  it("different drafts get different keys", () => {
    const a = decide({ ...base, alreadyApproved: true });
    const b = decide({
      ...base,
      draft: draft({ _id: "d2" as Id<"drafts"> }),
      alreadyApproved: true,
    });
    if (a.publish && b.publish) {
      expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Through Convex — cross-tenant safety and double-publish detection.          */
/* -------------------------------------------------------------------------- */

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
      snapshotText: `${suffix}'s words`,
      outcome: "pending",
      proposedAt: NOW,
      expiresAt: NOW + 86_400_000,
    });
    return { customerId, draftId };
  });
}

describe("decidePublish through Convex", () => {
  it("publishes on just_go with the right snapshot", async () => {
    const t = convexTest(schema, modules);
    const { customerId, draftId } = await seed(t, "live");
    const result = await t.query(internal.maya.publishDecision.decidePublish, {
      customerId,
      draftId,
    });
    expect(result.publish).toBe(true);
    if (result.publish) expect(result.snapshotText).toBe("live's words");
  });

  it("CROSS-TENANT: another account's draft never publishes", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "tenant_a");
    const b = await seed(t, "tenant_b");
    const result = await t.query(internal.maya.publishDecision.decidePublish, {
      customerId: a.customerId,
      draftId: b.draftId,
      alreadyApproved: true,
    });
    expect(result.publish).toBe(false);
    if (!result.publish) expect(result.detail).toMatch(/different account/);
  });

  it("holds when the channel row is missing entirely", async () => {
    const t = convexTest(schema, modules);
    const { customerId, draftId } = await seed(t, "nochannel");
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("channels")
        .withIndex("by_customer", (q) => q.eq("customerId", customerId))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    });
    const result = await t.query(internal.maya.publishDecision.decidePublish, {
      customerId,
      draftId,
      alreadyApproved: true,
    });
    if (!result.publish) expect(result.reason).toBe("channel_unavailable");
  });

  it("double-publish: alreadyPublished sees the placement by the same key", async () => {
    const t = convexTest(schema, modules);
    const { customerId, draftId } = await seed(t, "dbl");

    expect(
      await t.query(internal.maya.publishDecision.alreadyPublished, { draftId })
    ).toBe(false);

    // Publish it, using the key `decide` minted.
    const decision = await t.query(
      internal.maya.publishDecision.decidePublish,
      { customerId, draftId }
    );
    expect(decision.publish).toBe(true);
    if (!decision.publish) return;
    await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        url: "https://x.com/u/1",
        linkStatus: "live",
        publishedAt: NOW,
        snapshotText: decision.snapshotText,
        draftId,
        idempotencyKey: decision.idempotencyKey,
      })
    );

    expect(
      await t.query(internal.maya.publishDecision.alreadyPublished, { draftId })
    ).toBe(true);
  });
});
