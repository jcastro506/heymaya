import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../../_generated/api";
import schema from "../../../schema";
import { modules } from "../../../../tests/_modules";

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
  const jobId = await authed.mutation(
    api.gtmMaya.researchLifecycle.createResearchJob,
    { appId, budgetUsd: 3 }
  );
  const hookToken = `tok-${subject}-${Math.random().toString(36).slice(2, 30)}`;
  await t.run((ctx) =>
    ctx.db.patch(started.agentId, {
      openClawFlyAppId: `maya-gtm-${subject}`,
      hookToken,
      updatedAt: Date.now(),
    })
  );
  return {
    authed,
    accountId: started.accountId,
    agentId: started.agentId,
    appId,
    jobId,
    hookToken,
  };
}

describe("Sprint 16 — Convex ↔ Maya hook bridge", () => {
  describe("resolveAgentFromHookToken", () => {
    it("returns the agent for the matching token", async () => {
      const t = convexTest(schema, modules);
      const a = await setupAgent(t, "u_hook_resolve_a");
      const resolved = await t.query(
        internal.gtmMaya.openclaw.inboundCallback.resolveAgentFromHookToken,
        { presentedToken: a.hookToken }
      );
      expect(resolved).not.toBeNull();
      expect(resolved?.agentId).toBe(a.agentId);
      expect(resolved?.accountId).toBe(a.accountId);
    });

    it("returns null for unknown token", async () => {
      const t = convexTest(schema, modules);
      await setupAgent(t, "u_hook_resolve_unknown");
      const resolved = await t.query(
        internal.gtmMaya.openclaw.inboundCallback.resolveAgentFromHookToken,
        { presentedToken: "ghost-token-not-in-db" }
      );
      expect(resolved).toBeNull();
    });

    it("isolates cross-tenant — A's token cannot resolve to B's agent", async () => {
      const t = convexTest(schema, modules);
      const a = await setupAgent(t, "u_hook_iso_a");
      const b = await setupAgent(t, "u_hook_iso_b");
      const aResolved = await t.query(
        internal.gtmMaya.openclaw.inboundCallback.resolveAgentFromHookToken,
        { presentedToken: a.hookToken }
      );
      const bResolved = await t.query(
        internal.gtmMaya.openclaw.inboundCallback.resolveAgentFromHookToken,
        { presentedToken: b.hookToken }
      );
      expect(aResolved?.agentId).toBe(a.agentId);
      expect(bResolved?.agentId).toBe(b.agentId);
      // Sanity: A's token never resolves to B's agent.
      expect(aResolved?.agentId).not.toBe(b.agentId);
    });
  });

  describe("claimIdempotencyKey", () => {
    it("fresh on first claim, duplicate on second", async () => {
      const t = convexTest(schema, modules);
      const a = await setupAgent(t, "u_hook_idem_first");
      const key = "idem-aaaaaa-1234";
      const first = await t.mutation(
        internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
        {
          agentId: a.agentId,
          accountId: a.accountId,
          kind: "research_callback",
          idempotencyKey: key,
        }
      );
      const second = await t.mutation(
        internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
        {
          agentId: a.agentId,
          accountId: a.accountId,
          kind: "research_callback",
          idempotencyKey: key,
        }
      );
      expect(first).toBe("fresh");
      expect(second).toBe("duplicate");
    });

    it("rejects reusing a key across different agents", async () => {
      const t = convexTest(schema, modules);
      const a = await setupAgent(t, "u_hook_idem_iso_a");
      const b = await setupAgent(t, "u_hook_idem_iso_b");
      const key = "idem-shared-cccc";
      await t.mutation(
        internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
        {
          agentId: a.agentId,
          accountId: a.accountId,
          kind: "research_callback",
          idempotencyKey: key,
        }
      );
      await expect(
        t.mutation(
          internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
          {
            agentId: b.agentId,
            accountId: b.accountId,
            kind: "research_callback",
            idempotencyKey: key,
          }
        )
      ).rejects.toThrow("idempotency key collision across agents");
    });

    it("rejects reusing a key with a different kind (agent bug)", async () => {
      const t = convexTest(schema, modules);
      const a = await setupAgent(t, "u_hook_idem_kind");
      const key = "idem-kind-bug-7777";
      await t.mutation(
        internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
        {
          agentId: a.agentId,
          accountId: a.accountId,
          kind: "research_callback",
          idempotencyKey: key,
        }
      );
      await expect(
        t.mutation(
          internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
          {
            agentId: a.agentId,
            accountId: a.accountId,
            kind: "approval_decision",
            idempotencyKey: key,
          }
        )
      ).rejects.toThrow("idempotency key reused with different kind");
    });
  });

  describe("applyResearchCallback", () => {
    it("advances the research job's phase + stores lastAgentNote", async () => {
      const t = convexTest(schema, modules);
      const a = await setupAgent(t, "u_hook_research_apply");
      await t.mutation(
        internal.gtmMaya.openclaw.inboundCallback.applyResearchCallback,
        {
          agentId: a.agentId,
          accountId: a.accountId,
          researchJobId: a.jobId,
          phase: "channel_research",
          note: "subagent completed reddit pass; 4 new evidence cards",
        }
      );
      const job = await t.run((ctx) => ctx.db.get(a.jobId));
      expect(job?.phase).toBe("channel_research");
      expect(job?.lastAgentNote).toContain("subagent completed reddit pass");
    });

    it("rejects when the job does not belong to the claiming account (cross-tenant defense)", async () => {
      const t = convexTest(schema, modules);
      const a = await setupAgent(t, "u_hook_research_cross_a");
      const b = await setupAgent(t, "u_hook_research_cross_b");
      // Try to advance A's job using B's account.
      await expect(
        t.mutation(
          internal.gtmMaya.openclaw.inboundCallback.applyResearchCallback,
          {
            agentId: b.agentId,
            accountId: b.accountId,
            researchJobId: a.jobId,
            phase: "channel_research",
          }
        )
      ).rejects.toThrow("research job does not belong to this account");
    });
  });

  describe("getMyRecentCallbacks", () => {
    it("returns only the signed-in user's callback log", async () => {
      const t = convexTest(schema, modules);
      const a = await setupAgent(t, "u_hook_query_a");
      const b = await setupAgent(t, "u_hook_query_b");
      // Plant a callback row for A.
      await t.mutation(
        internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
        {
          agentId: a.agentId,
          accountId: a.accountId,
          kind: "research_callback",
          idempotencyKey: "idem-query-aaaa",
        }
      );
      const aRows = await a.authed.query(
        api.gtmMaya.openclaw.inboundCallback.getMyRecentCallbacks,
        {}
      );
      const bRows = await b.authed.query(
        api.gtmMaya.openclaw.inboundCallback.getMyRecentCallbacks,
        {}
      );
      expect(aRows).toHaveLength(1);
      expect(bRows).toHaveLength(0);
    });

    it("returns empty for unauthenticated callers", async () => {
      const t = convexTest(schema, modules);
      const rows = await t.query(
        api.gtmMaya.openclaw.inboundCallback.getMyRecentCallbacks,
        {}
      );
      expect(rows).toEqual([]);
    });
  });
});

describe("Sprint 16 — hookClient pure helpers", () => {
  it("mintHookToken produces a 43-char base64url string", async () => {
    const mod = await import("../hookClient");
    const tok = mod.mintHookToken();
    expect(tok).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(tok).not.toContain("+");
    expect(tok).not.toContain("/");
    expect(tok).not.toContain("=");
  });

  it("deriveHookBaseUrl uses the standard fly subdomain", async () => {
    const mod = await import("../hookClient");
    expect(mod.deriveHookBaseUrl("maya-gtm-abc123")).toBe(
      "https://maya-gtm-abc123.fly.dev/hooks"
    );
  });

  it("buildResearchPhasePrompt mentions PLAYBOOK + APP + GTM + evidence", async () => {
    const mod = await import("../hookClient");
    const prompt = mod.buildResearchPhasePrompt({
      researchJobId: "j123" as never,
      phase: "channel_research",
      newEvidenceCount: 4,
    });
    expect(prompt).toContain("PLAYBOOK.md");
    expect(prompt).toContain("APP.md");
    expect(prompt).toContain("GTM.md");
    expect(prompt).toContain("4 new evidence");
    expect(prompt).toContain("channel_research");
    // Anti-spend: cron prompt MUST disallow paid spend from this turn.
    expect(prompt).toContain("Do not spend");
  });

  it("runAgentTurn includes Authorization: Bearer header", async () => {
    const mod = await import("../hookClient");
    let observed: { headers?: Record<string, string>; body?: string } = {};
    const fakeFetch: typeof fetch = async (url, init) => {
      observed = {
        headers: Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>)
        ),
        body: init?.body as string,
      };
      return new Response("ok", { status: 200 });
    };
    await mod.runAgentTurn(
      { baseUrl: "https://maya.test/hooks", token: "secret-tok" },
      { message: "hello" },
      fakeFetch
    );
    expect(observed.headers?.Authorization).toBe("Bearer secret-tok");
    expect(observed.body).toContain("hello");
  });

  it("runAgentTurn reports non-ok status with an error string", async () => {
    const mod = await import("../hookClient");
    const fakeFetch: typeof fetch = async () =>
      new Response("forbidden", { status: 403 });
    const result = await mod.runAgentTurn(
      { baseUrl: "https://maya.test/hooks", token: "bad" },
      { message: "x" },
      fakeFetch
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("403");
  });
});
