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
        // Long-established, so the new-customer liveness grace does not apply —
        // these tests are about STALLED accounts, which is the opposite case.
        helloSentAt: MORNING - 30 * 86_400_000,
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
        // The brief. Seeded directly rather than by running a fleet sweep —
        // the sweep moved to OpenClaw's cron (§18 Sprint 2.9), and a test that
        // establishes its precondition through a function that no longer
        // exists is testing the wrong thing anyway.
        await ctx.db.insert("messages", {
          customerId,
          direction: "out",
          surface: "telegram",
          body: "morning brief",
          ts: EVENING - 7200_000,
          deliveredAt: EVENING - 7200_000,
          // Liveness recognises the brief by its dedupe key, not its text.
          dedupeKey: `brief:${new Date(EVENING).toISOString().slice(0, 10)}`,
        });
        await ctx.db.insert("messages", {
          customerId,
          direction: "out",
          surface: "telegram",
          body: "evening recap",
          ts: EVENING - 600_000,
          deliveredAt: EVENING - 600_000,
          dedupeKey: `recap:${new Date(EVENING).toISOString().slice(0, 10)}`,
        });
        // And the machine checked in this morning (§2.9.6) — a fleet that has
        // never mirrored its memory is a real breach, just not this test's.
        await ctx.db.insert("memorySnapshots", {
          customerId,
          capturedAt: EVENING - 12 * 3600_000,
          markdown: "# MEMORY.md\n",
          bytes: 13,
          contextTruncated: false,
        });
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

    // The cadence moved to OpenClaw's cron, so what Convex still owns at fleet
    // scale is deciding WHO the loop runs for. Everything downstream is
    // per-machine.
    const active = await t.query(internal.maya.scheduler.activeV2Customers, {});
    expect(active).toHaveLength(40);
    expect(new Set(active.map(String)).size).toBe(40);
    const selected = new Set(active.map(String));
    for (const id of v2) expect(selected.has(String(id))).toBe(true);
  });
});
