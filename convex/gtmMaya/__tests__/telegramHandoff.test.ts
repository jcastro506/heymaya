import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { buildHandoffPrompt } from "../telegramHandoff";

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  const appId = await authed.mutation(
    api.gtmMaya.researchLifecycle.setAppProfile,
    {
      name: `App for ${subject}`,
      url: `https://${subject}.test`,
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
    }
  );
  const researchJobId = await authed.mutation(
    api.gtmMaya.researchLifecycle.createResearchJob,
    { appId, budgetUsd: 3 }
  );
  return {
    authed,
    accountId: started.accountId,
    agentId: started.agentId,
    researchJobId,
  };
}

describe("Sprint 10 — buildHandoffPrompt (pure)", () => {
  it("includes status / evidence count / spend / primary channel", () => {
    const prompt = buildHandoffPrompt({
      researchJobId: "j123" as never,
      primaryChannel: "reddit",
      secondaryChannel: "x",
      evidenceCount: 11,
      spentUsd: 0.27,
      status: "ready_for_review",
      succeededPlatformCount: 3,
      insufficientPlatformCount: 1,
      topEvidenceUrls: [
        "https://reddit.com/r/SaaS/comments/xyz/",
        "https://x.com/founder/status/123",
      ],
    });
    expect(prompt).toContain("j123");
    expect(prompt).toContain("ready_for_review");
    expect(prompt).toContain("11");
    expect(prompt).toContain("$0.27");
    expect(prompt).toContain("reddit");
    expect(prompt).toContain("Top evidence URLs:");
    expect(prompt).toContain("3-sentence Telegram message");
  });

  it("forbids slop phrases in the prompt itself + bans paid spend", () => {
    const prompt = buildHandoffPrompt({
      researchJobId: "j" as never,
      evidenceCount: 0,
      spentUsd: 0,
      status: "needs_more_evidence",
      succeededPlatformCount: 0,
      insufficientPlatformCount: 5,
      topEvidenceUrls: [],
    });
    expect(prompt).toContain("Excited to announce");
    expect(prompt).toContain("supercharge");
    expect(prompt).toContain("anti-slop");
    expect(prompt).toContain("Do NOT spend");
  });

  it("omits primary/secondary lines when not provided", () => {
    const prompt = buildHandoffPrompt({
      researchJobId: "j" as never,
      evidenceCount: 0,
      spentUsd: 0,
      status: "needs_more_evidence",
      succeededPlatformCount: 0,
      insufficientPlatformCount: 0,
      topEvidenceUrls: [],
    });
    expect(prompt).not.toContain("Recommended primary channel:");
    expect(prompt).not.toContain("Recommended secondary channel:");
  });
});

describe("Sprint 10 — getHandoffContext", () => {
  it("returns null when agent doesn't exist", async () => {
    const t = convexTest(schema, modules);
    // Create then delete an agent so we have a structurally valid id
    // pointing at a row that no longer exists.
    const { agentId } = await setupAgent(t, "u_handoff_null");
    await t.run((ctx) => ctx.db.delete(agentId));
    const result = await t.query(
      internal.gtmMaya.telegramHandoff.getHandoffContext,
      { agentId }
    );
    expect(result).toBeNull();
  });

  it("returns context with hookBaseUrl when openClawFlyAppId is set", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_handoff_ctx");
    await t.run((ctx) =>
      ctx.db.patch(agentId, {
        openClawFlyAppId: "maya-gtm-test",
        hookToken: "smoke-tok",
        telegramChatId: "555111",
        updatedAt: Date.now(),
      })
    );
    const ctxRow = await t.query(
      internal.gtmMaya.telegramHandoff.getHandoffContext,
      { agentId }
    );
    expect(ctxRow?.hookBaseUrl).toBe("https://maya-gtm-test.fly.dev/hooks");
    expect(ctxRow?.hookToken).toBe("smoke-tok");
    expect(ctxRow?.telegramChatId).toBe("555111");
  });

  it("returns undefined hookBaseUrl when agent is not deployed", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_handoff_undeployed");
    const ctxRow = await t.query(
      internal.gtmMaya.telegramHandoff.getHandoffContext,
      { agentId }
    );
    expect(ctxRow?.hookBaseUrl).toBeUndefined();
  });
});

describe("Sprint 10 — handoffResearchToTelegram skip paths", () => {
  it("skips when agent is not deployed (no Fly app)", async () => {
    const t = convexTest(schema, modules);
    const { agentId, researchJobId } = await setupAgent(t, "u_handoff_skip_deploy");
    const result = await t.action(
      internal.gtmMaya.telegramHandoff.handoffResearchToTelegram,
      {
        agentId,
        summary: {
          researchJobId,
          evidenceCount: 0,
          spentUsd: 0,
          status: "needs_more_evidence",
          succeededPlatformCount: 0,
          insufficientPlatformCount: 0,
          topEvidenceUrls: [],
        },
      }
    );
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("not deployed");
  });

  it("skips when hookToken is missing", async () => {
    const t = convexTest(schema, modules);
    const { agentId, researchJobId } = await setupAgent(t, "u_handoff_skip_token");
    await t.run((ctx) =>
      ctx.db.patch(agentId, {
        openClawFlyAppId: "maya-gtm-no-token",
        updatedAt: Date.now(),
      })
    );
    const result = await t.action(
      internal.gtmMaya.telegramHandoff.handoffResearchToTelegram,
      {
        agentId,
        summary: {
          researchJobId,
          evidenceCount: 0,
          spentUsd: 0,
          status: "needs_more_evidence",
          succeededPlatformCount: 0,
          insufficientPlatformCount: 0,
          topEvidenceUrls: [],
        },
      }
    );
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("hookToken missing");
  });
});
