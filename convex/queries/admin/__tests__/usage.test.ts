/**
 * Admin usage queries — Sprint 6E acceptance.
 *
 * Five mandatory categories:
 *   1. Cross-tenant — `creatorEngagementProfile` reads ONLY the requested
 *      creator's events. `topCreatorsByEngagement` returns row identifiers
 *      but the score columns are denormalized so no cross-creator scan
 *      happens.
 *   2. Plan-tier × action — N/A (queries are operator-only via internalQuery
 *      + CLI deploy key; no plan-tier UX surface).
 *   3. Adversarial — empty / inverted ranges return zero-shaped results
 *      rather than throwing.
 *   4. Sibling-file scan — counts here MUST match what `usageEvents.ts`
 *      writes; the test inserts via the public mutation and reads back
 *      through these queries.
 *   5. TODO grep — clean.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";

const NOW = 1_700_000_000_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  opts?: { plan?: "starter" | "pro" | "studio"; primaryHandle?: string }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@test.com`,
      channelPreference: "web",
      timezone: "UTC",
      status: "active",
      plan: opts?.plan ?? "pro",
      primaryHandle: opts?.primaryHandle,
      createdAt: NOW,
    })
  );
}

describe("queries/admin/usage", () => {
  describe("usageRollup", () => {
    it("returns zero-shaped result on inverted range", async () => {
      const t = convexTest(schema, modules);
      const result = await t.query(internal.queries.admin.usage.usageRollup, {
        rangeStart: NOW + 1000,
        rangeEnd: NOW,
      });
      expect(result.totalEvents).toBe(0);
      expect(result.byKind).toEqual({});
      expect(result.byLabel).toEqual([]);
      expect(result.creatorsActive).toBe(0);
    });

    it("aggregates totals + byKind + byLabel + creatorsActive across creators", async () => {
      const t = convexTest(schema, modules);
      const aliceId = await insertCreator(t, "alice4");
      const bobId = await insertCreator(t, "bob4");

      // Alice: 3 morning_briefs, 1 evening_recap, 2 chat_turn_in.
      for (let i = 0; i < 3; i++) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId: aliceId,
          kind: "cron_fired",
          label: "morning_brief",
          ts: NOW + i,
        });
      }
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId: aliceId,
        kind: "cron_fired",
        label: "evening_recap",
        ts: NOW + 100,
      });
      for (let i = 0; i < 2; i++) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId: aliceId,
          kind: "chat_turn_in",
          label: "unclassified",
          ts: NOW + 200 + i,
        });
      }

      // Bob: 1 morning_brief, 1 brand_email_triage event.
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId: bobId,
        kind: "cron_fired",
        label: "morning_brief",
        ts: NOW + 500,
      });
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId: bobId,
        kind: "event_fired",
        label: "brand_email_triage",
        ts: NOW + 600,
      });

      const result = await t.query(internal.queries.admin.usage.usageRollup, {
        rangeStart: NOW,
        rangeEnd: NOW + 10_000,
      });

      expect(result.totalEvents).toBe(8); // 3+1+2 + 1+1
      expect(result.byKind).toEqual({
        cron_fired: 5, // 3 morning + 1 evening for Alice + 1 morning for Bob
        chat_turn_in: 2,
        event_fired: 1,
      });
      // byLabel sorted desc by count, then alpha.
      expect(result.byLabel.map((l) => l.label)).toEqual([
        "morning_brief",
        "unclassified",
        "brand_email_triage",
        "evening_recap",
      ]);
      expect(result.byLabel.find((l) => l.label === "morning_brief")?.count).toBe(4);
      expect(result.creatorsActive).toBe(2);
    });

    it("excludes events outside the time window", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "noah");

      // Inside window
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "cron_fired",
        label: "morning_brief",
        ts: NOW,
      });
      // Before window
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "cron_fired",
        label: "morning_brief",
        ts: NOW - ONE_DAY_MS,
      });
      // At/after end (exclusive)
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "cron_fired",
        label: "morning_brief",
        ts: NOW + ONE_DAY_MS,
      });

      const result = await t.query(internal.queries.admin.usage.usageRollup, {
        rangeStart: NOW,
        rangeEnd: NOW + ONE_DAY_MS,
      });
      expect(result.totalEvents).toBe(1);
    });
  });

  describe("creatorEngagementProfile", () => {
    it("returns zero-shaped result on inverted range", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "olive");
      const result = await t.query(
        internal.queries.admin.usage.creatorEngagementProfile,
        {
          creatorId,
          rangeStart: NOW + 1000,
          rangeEnd: NOW,
        }
      );
      expect(result.eventsByKind).toEqual({});
      expect(result.eventsByLabel).toEqual([]);
      expect(result.reactionDistribution).toEqual({});
      expect(result.replyVsIgnoreRate).toEqual({
        taken: 0,
        ignored: 0,
        ratio: null,
      });
      expect(result.chatTurnsByDay).toEqual([]);
    });

    it("returns the right distributions + chat-turns-by-day", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "paul");

      // Reactions: love × 3, like × 1, dislike × 1.
      for (let i = 0; i < 3; i++) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId,
          kind: "reaction_received",
          signal: "love",
          ts: NOW + i,
        });
      }
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "reaction_received",
        signal: "like",
        ts: NOW + 100,
      });
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "reaction_received",
        signal: "dislike",
        ts: NOW + 200,
      });

      // Action ratio: 4 taken, 1 ignored.
      for (let i = 0; i < 4; i++) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId,
          kind: "action_taken",
          ts: NOW + 1000 + i,
        });
      }
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "action_ignored",
        ts: NOW + 2000,
      });

      // chat_turn_in across two distinct UTC days.
      // Day 1: 2 events at NOW (which is 2023-11-14 UTC).
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "chat_turn_in",
        ts: NOW,
      });
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "chat_turn_in",
        ts: NOW + 60_000,
      });
      // Day 2: 1 event the next day.
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "chat_turn_in",
        ts: NOW + ONE_DAY_MS,
      });

      const result = await t.query(
        internal.queries.admin.usage.creatorEngagementProfile,
        {
          creatorId,
          rangeStart: NOW - 1000,
          rangeEnd: NOW + 10 * ONE_DAY_MS,
        }
      );

      expect(result.reactionDistribution).toEqual({
        love: 3,
        like: 1,
        dislike: 1,
      });
      expect(result.replyVsIgnoreRate.taken).toBe(4);
      expect(result.replyVsIgnoreRate.ignored).toBe(1);
      expect(result.replyVsIgnoreRate.ratio).toBeCloseTo(0.8);

      expect(result.chatTurnsByDay).toHaveLength(2);
      const day1 = result.chatTurnsByDay[0];
      const day2 = result.chatTurnsByDay[1];
      expect(day1.count).toBe(2);
      expect(day2.count).toBe(1);
      expect(day1.day < day2.day).toBe(true); // sorted ascending
    });

    it("ratio is null when neither action_taken nor action_ignored fired", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "quinn");

      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "chat_turn_in",
        ts: NOW,
      });
      const result = await t.query(
        internal.queries.admin.usage.creatorEngagementProfile,
        {
          creatorId,
          rangeStart: NOW - 1000,
          rangeEnd: NOW + 10 * ONE_DAY_MS,
        }
      );
      expect(result.replyVsIgnoreRate.taken).toBe(0);
      expect(result.replyVsIgnoreRate.ignored).toBe(0);
      expect(result.replyVsIgnoreRate.ratio).toBeNull();
    });

    it("CROSS-TENANT: profile reads ONLY the requested creator's events", async () => {
      const t = convexTest(schema, modules);
      const aliceId = await insertCreator(t, "alice5");
      const bobId = await insertCreator(t, "bob5");

      // Bob has 50 events; Alice has 1.
      for (let i = 0; i < 50; i++) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId: bobId,
          kind: "action_taken",
          ts: NOW + i,
        });
      }
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId: aliceId,
        kind: "chat_turn_in",
        ts: NOW,
      });

      const aliceProfile = await t.query(
        internal.queries.admin.usage.creatorEngagementProfile,
        {
          creatorId: aliceId,
          rangeStart: NOW - 1000,
          rangeEnd: NOW + 10 * ONE_DAY_MS,
        }
      );
      // Alice's profile must show 1 event, NOT 51.
      expect(aliceProfile.eventsByKind).toEqual({ chat_turn_in: 1 });
      expect(aliceProfile.replyVsIgnoreRate.taken).toBe(0);
    });

    it("excludes events outside the time window", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "rita");

      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "chat_turn_in",
        ts: NOW,
      });
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "chat_turn_in",
        ts: NOW - 30 * ONE_DAY_MS, // far outside window
      });
      const result = await t.query(
        internal.queries.admin.usage.creatorEngagementProfile,
        {
          creatorId,
          rangeStart: NOW - ONE_DAY_MS,
          rangeEnd: NOW + ONE_DAY_MS,
        }
      );
      expect(result.eventsByKind).toEqual({ chat_turn_in: 1 });
    });
  });

  describe("topCreatorsByEngagement", () => {
    it("sorts by engagementScore7d descending + respects limit", async () => {
      const t = convexTest(schema, modules);
      const aliceId = await insertCreator(t, "alice6", { primaryHandle: "@alice" });
      const bobId = await insertCreator(t, "bob6", { primaryHandle: "@bob" });
      const carolId = await insertCreator(t, "carol6", { primaryHandle: "@carol" });

      // Alice: 5 chat_turn_in (score 15)
      for (let i = 0; i < 5; i++) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId: aliceId,
          kind: "chat_turn_in",
          ts: NOW + i,
        });
      }
      // Bob: 10 action_taken (score 40)
      for (let i = 0; i < 10; i++) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId: bobId,
          kind: "action_taken",
          ts: NOW + i,
        });
      }
      // Carol: 1 chat_turn_in (score 3)
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId: carolId,
        kind: "chat_turn_in",
        ts: NOW,
      });

      const top = await t.query(
        internal.queries.admin.usage.topCreatorsByEngagement,
        {}
      );
      expect(top).toHaveLength(3);
      expect(top[0].handle).toBe("@bob");
      expect(top[0].engagementScore7d).toBe(40);
      expect(top[1].handle).toBe("@alice");
      expect(top[1].engagementScore7d).toBe(15);
      expect(top[2].handle).toBe("@carol");
      expect(top[2].engagementScore7d).toBe(3);

      // Limit
      const top2 = await t.query(
        internal.queries.admin.usage.topCreatorsByEngagement,
        { limit: 2 }
      );
      expect(top2).toHaveLength(2);
      expect(top2[0].handle).toBe("@bob");
      expect(top2[1].handle).toBe("@alice");
    });

    it("treats undefined engagementScore7d as 0", async () => {
      const t = convexTest(schema, modules);
      const a = await insertCreator(t, "no_events_a", { primaryHandle: "@a" });
      const b = await insertCreator(t, "no_events_b", { primaryHandle: "@b" });
      const top = await t.query(
        internal.queries.admin.usage.topCreatorsByEngagement,
        {}
      );
      expect(top).toHaveLength(2);
      for (const row of top) {
        expect(row.engagementScore7d).toBe(0);
      }
    });

    it("clamps limit at MAX_TOP_LIMIT", async () => {
      const t = convexTest(schema, modules);
      await insertCreator(t, "single");
      // 10_000 should be silently clamped to MAX_TOP_LIMIT (500). The query
      // must not throw and must return the single creator.
      const top = await t.query(
        internal.queries.admin.usage.topCreatorsByEngagement,
        { limit: 10_000 }
      );
      expect(top.length).toBeGreaterThanOrEqual(1);
    });

    it("CROSS-TENANT: returns the right creators with their own scoreboards intact", async () => {
      const t = convexTest(schema, modules);
      const a = await insertCreator(t, "a7", { primaryHandle: "@a7" });
      const b = await insertCreator(t, "b7", { primaryHandle: "@b7" });

      // Only A has events.
      for (let i = 0; i < 5; i++) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId: a,
          kind: "action_taken",
          ts: NOW + i,
        });
      }

      const top = await t.query(
        internal.queries.admin.usage.topCreatorsByEngagement,
        {}
      );
      const aRow = top.find((r) => r.creatorId === a);
      const bRow = top.find((r) => r.creatorId === b);
      expect(aRow?.engagementScore7d).toBe(20); // 5 * 4
      expect(bRow?.engagementScore7d).toBe(0);
    });
  });
});
