/**
 * Real-time operator Phase-1 — founder STEERING directives.
 *
 * Mandatory categories exercised here:
 *  1. Cross-tenant — agent A's directives are NEVER returned for agent B
 *     (saveSteeringDirective + getActiveSteeringDirectives are scoped to the
 *     resolved accountId only).
 *  3. Adversarial — empty / whitespace / oversized / non-steering chit-chat;
 *     questions naming a channel are NOT directives; oversized directive text
 *     is clamped on write.
 *  (+ classifier unit coverage: steering vs non-steering, lane + intent
 *   extraction; supersede-opposing-lane behavior on write.)
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { classifySteeringIntent, MAX_DIRECTIVE_CHARS } from "../steering";

// ── classifier (pure, no I/O) ──────────────────────────────────────────────
describe("classifySteeringIntent", () => {
  it("captures a focus directive naming a channel", () => {
    const r = classifySteeringIntent("focus more on LinkedIn this week");
    expect(r.isSteering).toBe(true);
    expect(r.intent).toBe("focus");
    expect(r.laneHints).toContain("linkedin");
  });

  it("captures an avoid directive and supersedes intent over focus", () => {
    const r = classifySteeringIntent("stop posting on X");
    expect(r.isSteering).toBe(true);
    expect(r.intent).toBe("avoid");
    expect(r.laneHints).toContain("x");
  });

  it("captures an angle directive with an angle lane", () => {
    const r = classifySteeringIntent("go harder on the pricing angle");
    expect(r.isSteering).toBe(true);
    // "go harder on" is a focus cue, but the pricing angle lane is extracted.
    expect(r.laneHints).toContain("pricing");
  });

  it("captures a pace directive even with no lane", () => {
    const r = classifySteeringIntent("post less this week, slow down");
    expect(r.isSteering).toBe(true);
    expect(r.intent).toBe("pace");
    expect(r.laneHints).toEqual([]);
  });

  it("does NOT capture a question that names a channel", () => {
    const r = classifySteeringIntent("how is LinkedIn doing this week?");
    expect(r.isSteering).toBe(false);
    expect(r.laneHints).toEqual([]);
  });

  it("does NOT capture a leading-interrogative question without a '?'", () => {
    expect(classifySteeringIntent("should we focus on reddit").isSteering).toBe(
      false
    );
  });

  it("does NOT capture chit-chat / a bare channel mention with no verb", () => {
    expect(classifySteeringIntent("I really like LinkedIn").isSteering).toBe(
      false
    );
    expect(classifySteeringIntent("nice work today!").isSteering).toBe(false);
  });

  it("handles empty / whitespace / non-string adversarial input", () => {
    expect(classifySteeringIntent("").isSteering).toBe(false);
    expect(classifySteeringIntent("    ").isSteering).toBe(false);
    // @ts-expect-error — defensive: non-string input must not throw.
    expect(classifySteeringIntent(null).isSteering).toBe(false);
  });

  it("rejects absurdly long input as non-steering", () => {
    expect(
      classifySteeringIntent("focus on linkedin ".repeat(2000)).isSteering
    ).toBe(false);
  });

  it("is case-insensitive", () => {
    const r = classifySteeringIntent("STOP POSTING ON X");
    expect(r.isSteering).toBe(true);
    expect(r.intent).toBe("avoid");
  });
});

// ── storage: mutation + query, cross-tenant isolation ───────────────────────
async function seedAgent(
  t: ReturnType<typeof convexTest>,
  subject: string
): Promise<{ accountId: Id<"creators">; agentId: Id<"gtmAgents"> }> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: subject,
      email: `${subject}@clawlaunch.test`,
      channelPreference: "telegram",
      timezone: "America/New_York",
      status: "active",
      plan: "manager",
      accountType: "gtm-agent",
      createdAt: Date.now(),
    } as never);
    const agentId = await ctx.db.insert("gtmAgents", {
      accountId,
      onboardingStep: "active",
      channelPreference: "telegram",
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    return { accountId, agentId };
  });
}

describe("saveSteeringDirective + getActiveSteeringDirectives", () => {
  it("round-trips a directive and reads it back active", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await seedAgent(t, "founder_steer_rt");
    await t.mutation(internal.gtmMaya.steering.saveSteeringDirective, {
      accountId,
      agentId,
      directive: "focus more on LinkedIn",
      laneHints: ["linkedin"],
      intent: "focus",
      source: "founder",
    });
    const rows = await t.query(
      internal.gtmMaya.steering.getActiveSteeringDirectives,
      { accountId }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].directive).toBe("focus more on LinkedIn");
    expect(rows[0].laneHints).toContain("linkedin");
    expect(rows[0].active).toBe(true);
  });

  it("clamps oversized directive text on write (adversarial)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await seedAgent(t, "founder_steer_clamp");
    await t.mutation(internal.gtmMaya.steering.saveSteeringDirective, {
      accountId,
      agentId,
      directive: "x".repeat(MAX_DIRECTIVE_CHARS * 3),
      source: "founder",
    });
    const rows = await t.query(
      internal.gtmMaya.steering.getActiveSteeringDirectives,
      { accountId }
    );
    expect(rows[0].directive.length).toBe(MAX_DIRECTIVE_CHARS);
  });

  it("supersedes an opposing same-lane directive (focus X then avoid X)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await seedAgent(t, "founder_steer_super");
    await t.mutation(internal.gtmMaya.steering.saveSteeringDirective, {
      accountId,
      agentId,
      directive: "focus on x",
      laneHints: ["x"],
      intent: "focus",
      source: "founder",
    });
    await t.mutation(internal.gtmMaya.steering.saveSteeringDirective, {
      accountId,
      agentId,
      directive: "stop posting on x",
      laneHints: ["x"],
      intent: "avoid",
      source: "founder",
    });
    const active = await t.query(
      internal.gtmMaya.steering.getActiveSteeringDirectives,
      { accountId }
    );
    // Only the avoid directive remains active; the focus one was superseded.
    expect(active).toHaveLength(1);
    expect(active[0].intent).toBe("avoid");
  });

  it("does NOT supersede a same-lane same-intent repeat", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await seedAgent(t, "founder_steer_repeat");
    for (let i = 0; i < 2; i++) {
      await t.mutation(internal.gtmMaya.steering.saveSteeringDirective, {
        accountId,
        agentId,
        directive: "focus on linkedin",
        laneHints: ["linkedin"],
        intent: "focus",
        source: "founder",
      });
    }
    const active = await t.query(
      internal.gtmMaya.steering.getActiveSteeringDirectives,
      { accountId }
    );
    expect(active).toHaveLength(2);
  });

  it("is cross-tenant isolated — A's directives never read for B", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAgent(t, "founder_steer_a");
    const b = await seedAgent(t, "founder_steer_b");
    await t.mutation(internal.gtmMaya.steering.saveSteeringDirective, {
      accountId: a.accountId,
      agentId: a.agentId,
      directive: "focus on reddit",
      laneHints: ["reddit"],
      intent: "focus",
      source: "founder",
    });
    const bRows = await t.query(
      internal.gtmMaya.steering.getActiveSteeringDirectives,
      { accountId: b.accountId }
    );
    expect(bRows).toHaveLength(0);
    const aRows = await t.query(
      internal.gtmMaya.steering.getActiveSteeringDirectives,
      { accountId: a.accountId }
    );
    expect(aRows).toHaveLength(1);
  });
});
