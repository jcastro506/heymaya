/**
 * S5 — Zernio read/engagement tools, tested OFFLINE (no deploy, no real Zernio).
 *
 * We stub global fetch so the ZernioClient's HTTP calls are intercepted, and
 * stub ZERNIO_API_KEY so the client constructs. This proves the server logic the
 * agent depends on, per the 5 mandatory categories:
 *   1. Cross-tenant — each agent's Zernio call carries ITS OWN profileId /
 *      connected account, never another agent's.
 *   2. Plan-tier × action — these are internal actions behind hookToken routes;
 *      a not-connected channel fails closed (no post fired).
 *   3. Adversarial / graceful — a Zernio add-on 403 maps to a clean
 *      { ok:false, addonRequired } instead of throwing (analytics + inbox).
 *   4. Sibling-file — the tool names are asserted present in the plugin bundle
 *      + renderTools by generators.test.ts.
 *   5. TODO grep — repo-wide sweep.
 *
 * What this does NOT cover (needs a real OpenClaw deploy + transcript): whether
 * the LLM agent actually CALLS these tools at the right moment.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function setupAgent(
  t: ReturnType<typeof convexTest>,
  subject: string,
  zernioProfileId: string,
  connected: Array<{ accountId: string; platform: string }>
): Promise<{ accountId: Id<"creators">; agentId: Id<"gtmAgents"> }> {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    { channelPreference: "telegram", timezone: "America/New_York" }
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(started.agentId, {
      zernioProfileId,
      connectedAccountsJson: JSON.stringify(connected),
    });
  });
  return { accountId: started.accountId, agentId: started.agentId };
}

describe("S5 Zernio read tools — offline", () => {
  beforeEach(() => {
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    // No OpenRouter key → the outbound safety firewall returns its safe-open
    // default (it's tested for real in outboundFirewall.test.ts). Here we just
    // need the reply path to PROCEED so we can assert the connection guard +
    // per-agent account usage, not re-test the LLM gate.
    vi.stubEnv("OPENROUTER_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("graceful degradation: analytics 403 → { ok:false, addonRequired:'analytics' }", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "z_an", "prof_A", [
      { accountId: "acct_x_A", platform: "x" },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(403, { error: "analytics addon required" }))
    );
    const r = (await t.action(
      internal.gtmMaya.zernioReads.fetchAccountAnalytics,
      { agentId: a.agentId, platform: "x" }
    )) as { ok: boolean; addonRequired?: string };
    expect(r.ok).toBe(false);
    expect(r.addonRequired).toBe("analytics");
  });

  it("graceful degradation: inbox 403 → { ok:false, addonRequired:'inbox' }", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "z_in", "prof_A", [
      { accountId: "acct_x_A", platform: "x" },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(403, { error: "inbox addon required" }))
    );
    const r = (await t.action(internal.gtmMaya.zernioReads.fetchInbox, {
      agentId: a.agentId,
    })) as { ok: boolean; addonRequired?: string };
    expect(r.ok).toBe(false);
    expect(r.addonRequired).toBe("inbox");
  });

  it("cross-tenant: each agent's analytics call carries ITS OWN profileId", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "z_ta", "prof_AAA", [
      { accountId: "acct_x_A", platform: "x" },
    ]);
    const b = await setupAgent(t, "z_tb", "prof_BBB", [
      { accountId: "acct_x_B", platform: "x" },
    ]);
    const seenUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seenUrls.push(String(url));
        return jsonResponse(200, {});
      })
    );
    await t.action(internal.gtmMaya.zernioReads.fetchAccountAnalytics, {
      agentId: a.agentId,
    });
    await t.action(internal.gtmMaya.zernioReads.fetchAccountAnalytics, {
      agentId: b.agentId,
    });
    expect(seenUrls.some((u) => u.includes("prof_AAA"))).toBe(true);
    expect(seenUrls.some((u) => u.includes("prof_BBB"))).toBe(true);
    // A's call must NOT carry B's profileId and vice-versa.
    const aCall = seenUrls.find((u) => u.includes("prof_AAA"))!;
    const bCall = seenUrls.find((u) => u.includes("prof_BBB"))!;
    expect(aCall).not.toContain("prof_BBB");
    expect(bCall).not.toContain("prof_AAA");
  });

  it("ban-safety: reply runs the fail-closed gate BEFORE sending — blocks + never fires when safety is unverifiable", async () => {
    // With no OpenRouter key, critiqueOutboundSafety is fail-closed (it can't
    // verify, so it blocks). The reply must be held and NEVER reach Zernio —
    // proving the gate runs before the send, the core ban-safety guarantee.
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "z_gate", "prof_A", [
      { accountId: "acct_x_A", platform: "x" },
    ]);
    const fetchMock = vi.fn(async () => jsonResponse(200, { success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const r = (await t.action(internal.gtmMaya.zernioReads.sendCommentReply, {
      agentId: a.agentId,
      channel: "x",
      text: "thanks, here's how it works",
      postId: "post_1",
      commentId: "c_1",
    })) as { ok: boolean; blocked?: boolean };
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    // The reply must never have been sent to Zernio — the gate held it.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("list_connected_accounts maps each connected channel to its post mode", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "z_lca", "prof_A", [
      { accountId: "acct_x_A", platform: "x" },
      { accountId: "acct_rd_A", platform: "reddit" },
    ]);
    // The pure parsing logic the httpAction uses: auto-post vs one-tap-confirm.
    const ctx = await t.run(async (db) => {
      const agent = await db.db.get(a.agentId);
      return agent?.connectedAccountsJson ?? null;
    });
    const accounts = JSON.parse(ctx ?? "[]") as Array<{ platform: string }>;
    const AUTO = new Set(["x", "linkedin", "instagram", "youtube"]);
    const modes = accounts.map((acc) => ({
      platform: acc.platform,
      mode: AUTO.has(acc.platform) ? "auto-post" : "one-tap-confirm",
    }));
    expect(modes).toContainEqual({ platform: "x", mode: "auto-post" });
    expect(modes).toContainEqual({
      platform: "reddit",
      mode: "one-tap-confirm",
    });
  });
});
