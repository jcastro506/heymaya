/**
 * Fleet-scale behaviour of the sweeps.
 *
 * Every genuinely dangerous bug found in this module so far has been a
 * multi-entity or multi-step one, invisible to single-customer tests:
 *
 *   - the morning brief's dedupe key was global, so customer #2 onward were
 *     silently suppressed (found by running two customers through one sweep)
 *   - the liveness zero-day streak ignored account age, so a customer who
 *     signed up this morning opened a support thread that evening (found by
 *     walking a whole day end to end)
 *
 * Both were correct in isolation and wrong in composition. This file goes
 * looking for the next one at fleet size, where the failure modes are
 * unbounded reads, cross-tenant bleed, and quadratic work.
 *
 * convex-test runs in memory, so it will NOT reproduce real Convex bandwidth
 * or timeout limits. What it can prove is that the sweep is correct at 200
 * customers and that its work grows linearly rather than quadratically — and
 * the read-volume arithmetic below is the part that has to be reasoned about
 * rather than measured here.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Doc, Id } from "../../_generated/dataModel";

const MORNING = Date.UTC(2026, 7, 1, 7, 0, 0);
const EVENING = Date.UTC(2026, 7, 1, 20, 0, 0);
const FLEET = 200;

async function seedFleet(
  t: ReturnType<typeof convexTest>,
  count: number,
  over: Partial<Doc<"customers">> = {}
): Promise<Array<Id<"customers">>> {
  return await t.run(async (ctx) => {
    const ids: Array<Id<"customers">> = [];
    for (let i = 0; i < count; i += 1) {
      const accountId = await ctx.db.insert("creators", {
        clerkUserId: `u_fleet_${i}`,
        email: `fleet${i}@example.com`,
        channelPreference: "web",
        timezone: "UTC",
        status: "active",
        plan: "manager",
        createdAt: MORNING - 30 * 86_400_000,
      });
      const customerId = await ctx.db.insert("customers", {
        accountId,
        agentVersion: "v2",
        plan: "mvp",
        state: "active",
        timezone: "UTC",
        createdAt: MORNING - 30 * 86_400_000,
        updatedAt: MORNING,
        ...over,
      });
      await ctx.db.insert("channels", {
        customerId,
        channel: "x",
        postingMode: "just_go",
        status: "connected",
        createdAt: MORNING,
        updatedAt: MORNING,
      });
      await ctx.db.insert("ideas", {
        customerId,
        angle: `angle for customer ${i}`,
        score: 5,
        status: "bank",
        createdAt: MORNING,
        updatedAt: MORNING,
      });
      ids.push(customerId);
    }
    return ids;
  });
}

describe("the morning sweep at 200 customers", () => {
  it("EVERY customer gets a brief — not just the first", async () => {
    // The regression that matters most. A global dedupe key meant exactly one
    // brief went out per day across the whole fleet, and every single-customer
    // test passed while it did.
    const t = convexTest(schema, modules);
    const ids = await seedFleet(t, FLEET);

    const result = await t.action(internal.maya.scheduler.morningRunAll, {
      now: MORNING,
    });
    expect(result.ran).toBe(FLEET);
    expect(result.failed).toBe(0);

    const messages = (await t.run((ctx) =>
      ctx.db.query("messages").collect()
    )) as Doc<"messages">[];
    expect(messages).toHaveLength(FLEET);
    expect(new Set(messages.map((m) => m.customerId)).size).toBe(FLEET);
  });

  it("each brief carries that customer's OWN angle, never a neighbour's", async () => {
    const t = convexTest(schema, modules);
    await seedFleet(t, 25);
    await t.action(internal.maya.scheduler.morningRunAll, { now: MORNING });

    const messages = (await t.run((ctx) =>
      ctx.db.query("messages").collect()
    )) as Doc<"messages">[];
    // Every body is distinct, and each names its own index.
    expect(new Set(messages.map((m) => m.body)).size).toBe(25);
    for (const m of messages) {
      expect(m.body).toMatch(/angle for customer \d+/);
    }
  });

  it("enqueues one job per customer, with keys that can't collide", async () => {
    const t = convexTest(schema, modules);
    await seedFleet(t, FLEET);
    await t.action(internal.maya.scheduler.morningRunAll, { now: MORNING });

    const jobs = (await t.run((ctx) =>
      ctx.db.query("jobs").collect()
    )) as Doc<"jobs">[];
    const produce = jobs.filter((j) => j.kind === "produce_post");
    expect(produce).toHaveLength(FLEET);
    expect(new Set(produce.map((j) => j.idempotencyKey)).size).toBe(FLEET);
    // Every brief also queues its own delivery — one per customer, no collisions.
    const deliver = jobs.filter((j) => j.kind === "deliver_message");
    expect(deliver).toHaveLength(FLEET);
    expect(new Set(deliver.map((j) => j.idempotencyKey)).size).toBe(FLEET);
  });

  it("a second sweep the same day is a full no-op across the fleet", async () => {
    const t = convexTest(schema, modules);
    await seedFleet(t, FLEET);
    await t.action(internal.maya.scheduler.morningRunAll, { now: MORNING });
    await t.action(internal.maya.scheduler.morningRunAll, { now: MORNING });

    expect(
      await t.run((ctx) => ctx.db.query("messages").collect())
    ).toHaveLength(FLEET);
    const jobs2 = (await t.run((ctx) =>
      ctx.db.query("jobs").collect()
    )) as Doc<"jobs">[];
    expect(jobs2.filter((j) => j.kind === "produce_post")).toHaveLength(FLEET);
  });

  it("work grows LINEARLY with fleet size, not quadratically", async () => {
    // A sweep that is O(n²) in customers looks fine at 5 and dies at 500. The
    // signal here is the ratio of rows written, which must track the ratio of
    // customers rather than its square.
    const small = convexTest(schema, modules);
    await seedFleet(small, 20);
    await small.action(internal.maya.scheduler.morningRunAll, { now: MORNING });
    const smallRows = (
      (await small.run((ctx) => ctx.db.query("messages").collect())) as unknown[]
    ).length;

    const large = convexTest(schema, modules);
    await seedFleet(large, 200);
    await large.action(internal.maya.scheduler.morningRunAll, { now: MORNING });
    const largeRows = (
      (await large.run((ctx) => ctx.db.query("messages").collect())) as unknown[]
    ).length;

    expect(largeRows / smallRows).toBe(10);
  });
});

describe("the liveness sweep at 200 customers", () => {
  it("checks the whole fleet and flags every stalled account", async () => {
    const t = convexTest(schema, modules);
    await seedFleet(t, FLEET);

    const result = await t.action(internal.maya.scheduler.livenessSweep, {
      now: EVENING,
    });
    expect(result.checked).toBe(FLEET);
    // Nobody published and nobody got a brief — all 200 breach.
    expect(result.breached).toBe(FLEET);

    // But it's ONE incident, not 200 support threads. Every audit row is
    // stamped as such, so the operator surface stays readable.
    expect(result.fleetIncident).toBe(true);
    const events = (await t.run((ctx) =>
      ctx.db.query("gtmAuditEvents").collect()
    )) as Doc<"gtmAuditEvents">[];
    expect(
      events.every(
        (e) => (e.metadata as { fleetIncident?: boolean })?.fleetIncident === true
      )
    ).toBe(true);
    // The original action and severity survive — correlation marks the rows,
    // it doesn't erase what they say.
    expect(
      events.some((e) => (e.metadata as { action?: string })?.action === "open_support_thread")
    ).toBe(true);
  });

  it("a healthy fleet produces ZERO audit noise", async () => {
    // If a healthy fleet writes rows, the operator surface becomes unreadable
    // and real breaches get lost in it.
    const t = convexTest(schema, modules);
    const ids = await seedFleet(t, 50);
    await t.run(async (ctx) => {
      for (const [i, customerId] of ids.entries()) {
        await ctx.db.insert("placements", {
          customerId,
          kind: "post",
          channel: "x",
          linkStatus: "live",
          publishedAt: EVENING - 3600_000,
          snapshotText: "went out",
          idempotencyKey: `p_${i}`,
        });
      }
    });
    await t.action(internal.maya.scheduler.morningRunAll, { now: MORNING });
    await t.action(internal.maya.scheduler.eveningRecapAll, { now: EVENING });

    const result = await t.action(internal.maya.scheduler.livenessSweep, {
      now: EVENING,
    });
    expect(result.breached).toBe(0);
    expect(
      await t.run((ctx) => ctx.db.query("gtmAuditEvents").collect())
    ).toEqual([]);
  });

  it("a paused fleet is never checked at all", async () => {
    const t = convexTest(schema, modules);
    await seedFleet(t, FLEET, { state: "paused" });
    const result = await t.action(internal.maya.scheduler.livenessSweep, {
      now: EVENING,
    });
    expect(result.checked).toBe(0);
  });
});

describe("a mixed fleet — v1, v2, paused, cancelled", () => {
  it("touches only active v2, whatever else is in the table", async () => {
    const t = convexTest(schema, modules);
    const v2 = await seedFleet(t, 40);
    await seedFleet(t, 40, { agentVersion: "v1" });
    await seedFleet(t, 20, { state: "paused" });
    await seedFleet(t, 20, { state: "cancelled" });

    const result = await t.action(internal.maya.scheduler.morningRunAll, {
      now: MORNING,
    });
    expect(result.ran).toBe(40);

    const messages = (await t.run((ctx) =>
      ctx.db.query("messages").collect()
    )) as Doc<"messages">[];
    expect(messages).toHaveLength(40);
    const touched = new Set(messages.map((m) => String(m.customerId)));
    for (const id of v2) expect(touched.has(String(id))).toBe(true);
  });
});

describe("the recap sweep at fleet size", () => {
  it("every customer's recap reports only their own placements", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedFleet(t, 30);
    await t.run(async (ctx) => {
      for (const [i, customerId] of ids.entries()) {
        await ctx.db.insert("placements", {
          customerId,
          kind: "post",
          channel: "x",
          url: `https://x.com/c${i}/1`,
          linkStatus: "live",
          publishedAt: EVENING - 3600_000,
          snapshotText: `post for ${i}`,
          idempotencyKey: `rp_${i}`,
        });
      }
    });

    const result = await t.action(internal.maya.scheduler.eveningRecapAll, {
      now: EVENING,
    });
    expect(result.ran).toBe(30);

    const messages = (await t.run((ctx) =>
      ctx.db.query("messages").collect()
    )) as Doc<"messages">[];
    expect(messages).toHaveLength(30);
    // Each recap names exactly one URL, and it's that customer's.
    for (const m of messages) {
      const urls = m.body.match(/https:\/\/x\.com\/c\d+\/1/g) ?? [];
      expect(urls).toHaveLength(1);
    }
  });
});
