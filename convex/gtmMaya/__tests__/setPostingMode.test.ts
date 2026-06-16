/**
 * W2 — setMyPostingMode (founder changes their autonomy preference).
 *  - round-trips to gtmAgents; switching INTO confirm_first_week stamps the
 *    ramp clock if none is running.
 *  1. Cross-tenant — A's change never touches B's agent.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

async function setup(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    { channelPreference: "telegram", timezone: "America/New_York" }
  );
  return { authed, agentId: started.agentId as Id<"gtmAgents"> };
}

describe("setMyPostingMode", () => {
  it("defaults a new agent to confirm_first_week with a started ramp clock", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setup(t, "pm_default");
    const agent = await t.run((ctx) => ctx.db.get(agentId));
    expect(agent?.autonomousPosting).toBe("confirm_first_week");
    expect(typeof agent?.autonomousSince).toBe("number");
    expect(agent?.confirmedPostCount).toBe(0);
  });

  it("round-trips a mode change", async () => {
    const t = convexTest(schema, modules);
    const { authed, agentId } = await setup(t, "pm_change");
    await authed.mutation(api.gtmMaya.researchLifecycle.setMyPostingMode, {
      mode: "autonomous",
    });
    const agent = await t.run((ctx) => ctx.db.get(agentId));
    expect(agent?.autonomousPosting).toBe("autonomous");
  });

  it("is cross-tenant isolated", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t, "pm_a");
    const b = await setup(t, "pm_b");
    await a.authed.mutation(api.gtmMaya.researchLifecycle.setMyPostingMode, {
      mode: "confirm_each",
    });
    const agentA = await t.run((ctx) => ctx.db.get(a.agentId));
    const agentB = await t.run((ctx) => ctx.db.get(b.agentId));
    expect(agentA?.autonomousPosting).toBe("confirm_each");
    expect(agentB?.autonomousPosting).toBe("confirm_first_week");
  });
});
