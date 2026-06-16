/**
 * W3.1 — getMyFoundationInsights (the grounded-reasoning source for the
 * redesigned Thinking view).
 *
 *  1. Cross-tenant — founder B never sees A's foundation; the query resolves
 *     the caller's own agent only.
 *  - empty-foundation agent returns hasFoundation:false (graceful).
 *  - shapes buyer/competitors/channels(bet-first)/angles with verbatim quotes.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

async function setupAgent(
  t: ReturnType<typeof convexTest>,
  subject: string
): Promise<{
  authed: ReturnType<typeof t.withIdentity>;
  accountId: Id<"creators">;
  agentId: Id<"gtmAgents">;
}> {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    { channelPreference: "telegram", timezone: "America/New_York" }
  );
  return {
    authed,
    accountId: started.accountId,
    agentId: started.agentId,
  };
}

async function seedFoundation(
  t: ReturnType<typeof convexTest>,
  accountId: Id<"creators">,
  agentId: Id<"gtmAgents">
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("gtmBuyerMap", {
      accountId,
      agentId,
      icpDescription: "Indie founders shipping AI apps.",
      buyerJourneyStages: [
        {
          stage: "aware",
          whereTheyHangOut: "r/SaaS",
          intentLanguage: "how do I get my first users",
          complaints: ["marketing is a black hole"],
        },
      ],
      intentPhrases: ["launching my app"],
      trustedVoices: [
        { handle: "@levelsio", platform: "x", whyTrusted: "indie hero" },
      ],
      synthesizedAt: 1000,
    });
    await ctx.db.insert("gtmCompetitiveMap", {
      accountId,
      agentId,
      competitorKey: "replyguy",
      competitorName: "ReplyGuy",
      kind: "direct",
      positioning: "automated reply tool",
      complaints: [{ quote: "got me banned", sourceUrl: "https://reddit.com/x" }],
      vulnerabilities: ["ban-risk"],
      synthesizedAt: 1000,
      updatedAt: 1000,
    });
    await ctx.db.insert("gtmChannelScorecard", {
      accountId,
      agentId,
      channel: "reddit",
      audienceFit: 0.6,
      cadenceFit: 0.8,
      uniqueUnlock: "high-intent threads",
      bet: false,
      synthesizedAt: 1000,
      updatedAt: 1000,
    });
    await ctx.db.insert("gtmChannelScorecard", {
      accountId,
      agentId,
      channel: "x",
      audienceFit: 0.9,
      cadenceFit: 0.7,
      uniqueUnlock: "reply-driven reach",
      bet: true,
      synthesizedAt: 1000,
      updatedAt: 1000,
    });
    await ctx.db.insert("gtmContentAngles", {
      accountId,
      agentId,
      angleKey: "ban-safe",
      angle: "ban-safe outbound",
      painCitation: {
        quote: "got banned for spamming",
        sourceUrl: "https://news.ycombinator.com/item?id=1",
      },
      hookVariants: ["Tired of getting shadowbanned?"],
      usageCount: 0,
      synthesizedAt: 1000,
      updatedAt: 1000,
    });
  });
}

describe("getMyFoundationInsights", () => {
  it("returns the empty shape for a pre-foundation agent", async () => {
    const t = convexTest(schema, modules);
    const { authed } = await setupAgent(t, "fi_empty");
    const res = await authed.query(
      api.gtmMaya.missionControl.getMyFoundationInsights,
      {}
    );
    expect(res.hasFoundation).toBe(false);
    expect(res.buyer).toBeNull();
    expect(res.competitors).toEqual([]);
  });

  it("shapes buyer/competitors/channels/angles with verbatim quotes", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "fi_full");
    await seedFoundation(t, accountId, agentId);
    const res = await authed.query(
      api.gtmMaya.missionControl.getMyFoundationInsights,
      {}
    );
    expect(res.hasFoundation).toBe(true);
    expect(res.buyer?.icpDescription).toContain("Indie founders");
    expect(res.competitors[0].complaints[0].quote).toBe("got me banned");
    // Bet channel (x) sorts before non-bet (reddit).
    expect(res.channels[0].channel).toBe("x");
    expect(res.channels[0].bet).toBe(true);
    expect(res.angles[0].painQuote).toContain("banned");
    expect(res.angles[0].painSourceUrl).toContain("ycombinator");
  });

  it("is cross-tenant isolated — B never sees A's foundation", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "fi_a");
    await seedFoundation(t, a.accountId, a.agentId);
    const b = await setupAgent(t, "fi_b");
    const resB = await b.authed.query(
      api.gtmMaya.missionControl.getMyFoundationInsights,
      {}
    );
    expect(resB.hasFoundation).toBe(false);
    expect(resB.competitors).toEqual([]);
  });
});
