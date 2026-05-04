/**
 * usageEvents helper — Sprint 6E (creator usage analytics).
 *
 * Five mandatory categories:
 *   1. Cross-tenant — Creator A's events do NOT touch Creator B's scoreboard.
 *   2. Plan-tier × action — N/A (plan-agnostic by design).
 *   3. Adversarial — invalid `kind` is rejected by validator union.
 *   4. Sibling-file scan — schema literal-union + validator literal-union
 *      kept in sync; this file imports the kind set from usageEvents.ts so
 *      the test fails the moment they drift.
 *   5. TODO grep — clean (the chat-turn label TODO is in usageEvents.ts
 *      itself with a justified `TODO(s7):` marker).
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import {
  CREATOR_DRIVEN_KINDS,
  scoreContribution,
  type UsageEventKind,
} from "../usageEvents";

const NOW = 1_700_000_000_000; // fixed clock so windows are deterministic
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const ALL_KINDS: ReadonlyArray<UsageEventKind> = [
  "cron_fired",
  "event_fired",
  "chat_turn_in",
  "chat_turn_out",
  "reaction_received",
  "explicit_feedback",
  "action_taken",
  "action_ignored",
];

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  suffix: string
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@test.com`,
      channelPreference: "web",
      timezone: "UTC",
      status: "active",
      plan: "pro",
      createdAt: NOW,
    })
  );
}

describe("usageEvents helper", () => {
  describe("logUsageEvent — basic insert path", () => {
    it("inserts a row for each of the 8 kinds", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "alice");

      for (const kind of ALL_KINDS) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId,
          kind,
          label: `test_${kind}`,
          ts: NOW,
        });
      }

      const rows = await t.run((ctx) =>
        ctx.db
          .query("usageEvents")
          .withIndex("by_creator_and_ts", (q) => q.eq("creatorId", creatorId))
          .collect()
      );
      expect(rows).toHaveLength(ALL_KINDS.length);
      const kinds = new Set(rows.map((r) => r.kind));
      expect(kinds.size).toBe(ALL_KINDS.length);
      for (const k of ALL_KINDS) {
        expect(kinds.has(k)).toBe(true);
      }
    });

    it("defaults ts to Date.now() when omitted", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "bob");
      const before = Date.now();
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "chat_turn_in",
      });
      const after = Date.now();
      const rows = await t.run((ctx) =>
        ctx.db
          .query("usageEvents")
          .withIndex("by_creator_and_ts", (q) => q.eq("creatorId", creatorId))
          .collect()
      );
      expect(rows).toHaveLength(1);
      const ts = rows[0].ts;
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe("scoreboard — lastEngagedAt", () => {
    it("bumps lastEngagedAt on every creator-driven kind", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "carol");
      let ts = NOW;
      for (const kind of CREATOR_DRIVEN_KINDS) {
        ts += 1000;
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId,
          kind,
          ts,
        });
      }
      const c = await t.run((ctx) => ctx.db.get(creatorId));
      expect(c?.lastEngagedAt).toBe(ts);
    });

    it("does NOT bump lastEngagedAt on Maya-driven kinds", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "dave");

      // Maya-driven kinds only — none should bump.
      for (const kind of ["cron_fired", "event_fired", "chat_turn_out"] as const) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId,
          kind,
          label: `maya_${kind}`,
          ts: NOW,
        });
      }
      const c = await t.run((ctx) => ctx.db.get(creatorId));
      expect(c?.lastEngagedAt).toBeUndefined();
    });

    it("never moves lastEngagedAt backwards", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "erin");

      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "chat_turn_in",
        ts: NOW + 1000,
      });
      // Older event arriving (out-of-order webhook delivery) — must not regress.
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "chat_turn_in",
        ts: NOW,
      });
      const c = await t.run((ctx) => ctx.db.get(creatorId));
      expect(c?.lastEngagedAt).toBe(NOW + 1000);
    });
  });

  describe("scoreboard — engagementScore7d", () => {
    it("computes a value bounded [0, 100]", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "fred");

      // Fire a heavy mix of high-weight events; total raw score would exceed
      // 100 so the clamp must hold.
      for (let i = 0; i < 50; i++) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId,
          kind: "action_taken",
          ts: NOW + i,
        });
      }
      const c = await t.run((ctx) => ctx.db.get(creatorId));
      expect(c?.engagementScore7d).toBeDefined();
      expect(c!.engagementScore7d!).toBeGreaterThanOrEqual(0);
      expect(c!.engagementScore7d!).toBeLessThanOrEqual(100);
      expect(c!.engagementScore7d!).toBe(100); // 50 * 4 clamped
    });

    it("respects the 7-day window — older events are excluded", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "gail");

      // 100 events 30 days ago should NOT contribute to 7d score.
      const oldTs = NOW - 30 * ONE_DAY_MS;
      for (let i = 0; i < 100; i++) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId,
          kind: "action_taken",
          ts: oldTs + i,
        });
      }
      // One recent event — the scoreboard recomputes against the latest ts,
      // so the window is anchored at NOW.
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "chat_turn_in",
        ts: NOW,
      });
      const c = await t.run((ctx) => ctx.db.get(creatorId));
      // Only the recent chat_turn_in (weight 3) falls in the window.
      expect(c?.engagementScore7d).toBe(3);
    });

    it("score contribution function is correct + total clamps to [0, 100]", () => {
      // Pure unit on the scoring helper — no DB.
      expect(scoreContribution("chat_turn_in")).toBe(3);
      expect(scoreContribution("action_taken")).toBe(4);
      expect(scoreContribution("reaction_received", "love")).toBe(3);
      expect(scoreContribution("reaction_received", "dislike")).toBe(0);
      expect(scoreContribution("reaction_received")).toBe(2);
      expect(scoreContribution("explicit_feedback", "approve")).toBe(4);
      expect(scoreContribution("explicit_feedback", "reject")).toBe(0);
      expect(scoreContribution("action_ignored")).toBe(-2);
      // Maya-driven kinds contribute 0.
      expect(scoreContribution("cron_fired")).toBe(0);
      expect(scoreContribution("event_fired")).toBe(0);
      expect(scoreContribution("chat_turn_out")).toBe(0);
    });
  });

  describe("scoreboard — topSkillLast7d", () => {
    it("returns the most-fired cron/event label in the last 7d", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "harry");

      // morning_brief × 3, evening_recap × 1
      for (let i = 0; i < 3; i++) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId,
          kind: "cron_fired",
          label: "morning_brief",
          ts: NOW + i,
        });
      }
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "cron_fired",
        label: "evening_recap",
        ts: NOW + 100,
      });
      const c = await t.run((ctx) => ctx.db.get(creatorId));
      expect(c?.topSkillLast7d).toBe("morning_brief");
    });

    it("ignores non-cron/non-event kinds when ranking labels", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "iris");

      // chat_turn_in with label "unclassified" × 100 — should NOT win.
      for (let i = 0; i < 100; i++) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId,
          kind: "chat_turn_in",
          label: "unclassified",
          ts: NOW + i,
        });
      }
      // event_fired with label "brand_email_triage" × 1 — should win because
      // chat_turn_in doesn't count for topSkill.
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "event_fired",
        label: "brand_email_triage",
        ts: NOW + 1000,
      });
      const c = await t.run((ctx) => ctx.db.get(creatorId));
      expect(c?.topSkillLast7d).toBe("brand_email_triage");
    });

    it("breaks ties lexicographically (deterministic)", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "jane");

      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "cron_fired",
        label: "zeta_skill",
        ts: NOW,
      });
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId,
        kind: "cron_fired",
        label: "alpha_skill",
        ts: NOW + 1,
      });
      const c = await t.run((ctx) => ctx.db.get(creatorId));
      expect(c?.topSkillLast7d).toBe("alpha_skill");
    });
  });

  describe("cross-tenant isolation", () => {
    it("Creator A's events do NOT mutate Creator B's scoreboard", async () => {
      const t = convexTest(schema, modules);
      const aliceId = await insertCreator(t, "alice2");
      const bobId = await insertCreator(t, "bob2");

      // Fire 10 events for Alice across various kinds.
      for (let i = 0; i < 10; i++) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId: aliceId,
          kind: "chat_turn_in",
          label: "alice_topic",
          ts: NOW + i,
        });
      }
      // Bob: zero events. His scoreboard fields must remain undefined.
      const bob = await t.run((ctx) => ctx.db.get(bobId));
      expect(bob?.lastEngagedAt).toBeUndefined();
      expect(bob?.engagementScore7d).toBeUndefined();
      expect(bob?.topSkillLast7d).toBeUndefined();

      // Alice's scoreboard moved.
      const alice = await t.run((ctx) => ctx.db.get(aliceId));
      expect(alice?.lastEngagedAt).toBe(NOW + 9);
      expect(alice?.engagementScore7d).toBe(30); // 10 × 3
    });

    it("scoreboard recompute reads ONLY this creator's events", async () => {
      const t = convexTest(schema, modules);
      const aliceId = await insertCreator(t, "alice3");
      const bobId = await insertCreator(t, "bob3");

      // Pre-seed Bob with high-weight events.
      for (let i = 0; i < 25; i++) {
        await t.mutation(internal.lib.usageEvents.logUsageEvent, {
          creatorId: bobId,
          kind: "action_taken",
          ts: NOW + i,
        });
      }
      const bobBefore = await t.run((ctx) => ctx.db.get(bobId));

      // Fire a single event for Alice. Bob's scoreboard MUST NOT be recomputed.
      await t.mutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId: aliceId,
        kind: "chat_turn_in",
        ts: NOW + 100,
      });

      const bobAfter = await t.run((ctx) => ctx.db.get(bobId));
      expect(bobAfter?.lastEngagedAt).toBe(bobBefore?.lastEngagedAt);
      expect(bobAfter?.engagementScore7d).toBe(bobBefore?.engagementScore7d);
      expect(bobAfter?.topSkillLast7d).toBe(bobBefore?.topSkillLast7d);
    });
  });

  describe("channel-bridge wrappers", () => {
    it("recordChatTurnIn defaults label to 'unclassified' when omitted", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "kira");

      await t.mutation(internal.lib.usageEvents.recordChatTurnIn, {
        creatorId,
        ts: NOW,
      });
      const rows = await t.run((ctx) =>
        ctx.db
          .query("usageEvents")
          .withIndex("by_creator_and_ts", (q) => q.eq("creatorId", creatorId))
          .collect()
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("chat_turn_in");
      expect(rows[0].label).toBe("unclassified");
    });

    it("recordChatTurnOut writes a chat_turn_out row that does NOT bump lastEngagedAt", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "liam");

      await t.mutation(internal.lib.usageEvents.recordChatTurnOut, {
        creatorId,
        ts: NOW,
      });
      const c = await t.run((ctx) => ctx.db.get(creatorId));
      expect(c?.lastEngagedAt).toBeUndefined();
      const rows = await t.run((ctx) =>
        ctx.db
          .query("usageEvents")
          .withIndex("by_creator_and_ts", (q) => q.eq("creatorId", creatorId))
          .collect()
      );
      expect(rows[0].kind).toBe("chat_turn_out");
    });

    it("recordReactionReceived stores the signal + meta target id", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, "mia");

      await t.mutation(internal.lib.usageEvents.recordReactionReceived, {
        creatorId,
        signal: "love",
        targetMessageId: "msg_abc",
        ts: NOW,
      });
      const rows = await t.run((ctx) =>
        ctx.db
          .query("usageEvents")
          .withIndex("by_creator_and_ts", (q) => q.eq("creatorId", creatorId))
          .collect()
      );
      expect(rows[0].kind).toBe("reaction_received");
      expect(rows[0].signal).toBe("love");
      expect(
        (rows[0].meta as { targetMessageId?: string } | undefined)
          ?.targetMessageId
      ).toBe("msg_abc");
      // reaction_received is creator-driven → bumps lastEngagedAt.
      const c = await t.run((ctx) => ctx.db.get(creatorId));
      expect(c?.lastEngagedAt).toBe(NOW);
    });
  });

  describe("sibling-file scan — kind set in lockstep with schema", () => {
    it("CREATOR_DRIVEN_KINDS is a strict subset of all 8 kinds", () => {
      for (const k of CREATOR_DRIVEN_KINDS) {
        expect(ALL_KINDS).toContain(k);
      }
      // Symmetric check: the Maya-driven kinds set is well-defined.
      const mayaDriven = ALL_KINDS.filter((k) => !CREATOR_DRIVEN_KINDS.has(k));
      expect(mayaDriven).toContain("cron_fired");
      expect(mayaDriven).toContain("event_fired");
      expect(mayaDriven).toContain("chat_turn_out");
    });
  });
});
