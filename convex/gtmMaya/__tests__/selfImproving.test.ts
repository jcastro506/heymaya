/**
 * Sprint J — self-improving skills (Layer 2, governed).
 * /lc_gtm/propose_skill_improvement + the core-contract guard.
 *
 * Mandatory categories: happy path, the safety guard (core contracts NEVER
 * self-editable), validation, idempotency, auth.
 */

import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
});

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: `App ${subject}`,
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  const hookToken = "fake-hook-" + Math.random().toString(36).slice(2);
  await t.run(async (ctx) => {
    await ctx.db.patch(started.agentId, { hookToken });
  });
  return { agentId: started.agentId, hookToken };
}

function propose(
  t: ReturnType<typeof convexTest>,
  hookToken: string,
  body: Record<string, unknown>
) {
  return t.fetch("/lc_gtm/propose_skill_improvement", {
    method: "POST",
    headers: {
      authorization: `Bearer ${hookToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("Sprint J — propose_skill_improvement", () => {
  it("records a proposed shared-skill improvement", async () => {
    const t = convexTest(schema, modules);
    const { agentId, hookToken } = await setupAgent(t, "u_si_happy");
    const res = await propose(t, hookToken, {
      idempotencyKey: "p1",
      targetSkill: "maya-reddit-demand-researcher",
      archetype: "dev-tool",
      proposal: "mine the OP's profile for prior threads before drafting",
      groundedInOutcome: "OP-reply rate 2x when the reply referenced their history",
    });
    expect(res.status).toBe(200);
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("gtmSkillImprovementProposals")
        .withIndex("by_target_skill", (q) =>
          q.eq("targetSkill", "maya-reddit-demand-researcher")
        )
        .collect()
    );
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("proposed");
    expect(rows[0].agentId).toBe(agentId);
  });

  it("REJECTS proposals targeting core-contract skills (never self-editable)", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_si_guard");
    for (const targetSkill of [
      "outboundFirewall",
      "maya-evidence-guard",
      "the safety gate",
    ]) {
      const res = await propose(t, hookToken, {
        idempotencyKey: "g-" + targetSkill,
        targetSkill,
        proposal: "loosen this",
        groundedInOutcome: "n/a",
      });
      expect(res.status).toBe(400);
    }
    // Nothing persisted.
    const rows = await t.run(async (ctx) =>
      ctx.db.query("gtmSkillImprovementProposals").collect()
    );
    expect(rows.length).toBe(0);
  });

  it("rejects missing fields + idempotency replays + auth", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_si_bad");

    expect(
      (await propose(t, hookToken, { targetSkill: "x", proposal: "y" })).status
    ).toBe(400);

    await propose(t, hookToken, {
      idempotencyKey: "dup",
      targetSkill: "maya-x-founder-led-researcher",
      proposal: "first",
      groundedInOutcome: "o",
    });
    const replay = await propose(t, hookToken, {
      idempotencyKey: "dup",
      targetSkill: "maya-x-founder-led-researcher",
      proposal: "second",
      groundedInOutcome: "o",
    });
    expect((await replay.text())).toContain("replay");

    const noAuth = await propose(t, "bad-token", {
      idempotencyKey: "z",
      targetSkill: "maya-x-founder-led-researcher",
      proposal: "p",
      groundedInOutcome: "o",
    });
    expect(noAuth.status).toBe(401);
  });
});
