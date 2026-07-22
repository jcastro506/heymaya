/**
 * 2026-07-20 — the confirm-chain hardening pack, tested OFFLINE.
 *
 * Born from a live dogfood failure: the founder said "yea postem", the publish
 * raced an expired Zernio token by ONE SECOND, both events went terminally
 * 'failed', and no retry path existed. These tests pin the new contract:
 *
 *   1. RE-ARM, never dead-end — a failed founder-confirmed publish flips the
 *      event BACK to needs_confirm so the next "post it" / tap retries.
 *   2. A gate block (lapsed plan) on confirm is NOT a terminal failure.
 *   3. The dedup ledger stamps on EVERY reply publish, draftId or not.
 *   4. draftId + firstComment persist through the confirm chain.
 *   5. get_agent_lifecycle rides the pendingConfirms queue (session-restart
 *      recovery for a chat "post it").
 *   6. record_published accepts a calendar eventId (the paste flow's
 *      done-state) and refuses foreign/unknown ids honestly.
 *   7. confirm_event refuses any decision that isn't exactly post/skip.
 *   8. Zernio reads fail closed with no zernioProfileId (cross-tenant guard).
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

const zernioSuccess = () =>
  jsonResponse(200, {
    _id: "zp_ok",
    platforms: [
      { platform: "reddit", status: "published", platformPostId: "rd_live_1" },
    ],
  });

const zernioFailure = () =>
  jsonResponse(200, {
    _id: "zp_fail",
    platforms: [
      { platform: "reddit", status: "failed", error: "token expired" },
    ],
  });

async function setupAgent(
  t: ReturnType<typeof convexTest>,
  subject: string,
  opts: { activePlan?: boolean; hookToken?: string; zernioProfileId?: string } = {}
): Promise<{ accountId: Id<"creators">; agentId: Id<"gtmAgents"> }> {
  const authed = t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
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
      connectedAccountsJson: JSON.stringify([
        { accountId: "acct_rd", platform: "reddit" },
      ]),
      ...(opts.activePlan
        ? { gtmPlanJson: JSON.stringify({ status: "active", tier: "starter" }) }
        : {}),
      ...(opts.hookToken ? { hookToken: opts.hookToken } : {}),
      ...(opts.zernioProfileId ? { zernioProfileId: opts.zernioProfileId } : {}),
    });
  });
  return { accountId: started.accountId, agentId: started.agentId };
}

async function makeNeedsConfirmEvent(
  t: ReturnType<typeof convexTest>,
  agentId: Id<"gtmAgents">,
  accountId: Id<"creators">,
  extraAutoPost: Record<string, unknown> = {}
): Promise<Id<"gtmCalendarEvents">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("gtmCalendarEvents", {
      accountId,
      agentId,
      title: "reddit reply",
      draftText: "a genuinely helpful reply",
      startsAtMs: now,
      endsAtMs: now + 3_600_000,
      timezone: "America/New_York",
      status: "needs_confirm",
      createdBy: "maya",
      autoPostJson: JSON.stringify({
        channel: "reddit",
        zernioAccountId: "acct_rd",
        mode: "manual_confirm",
        ...extraAutoPost,
      }),
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("re-arm: a failed founder-confirmed publish is retryable, never a dead end", () => {
  beforeEach(() => vi.stubEnv("ZERNIO_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("Zernio failure → event back to needs_confirm → retry 'post it' publishes (the live dogfood bug)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_rearm", { activePlan: true });
    const eventId = await makeNeedsConfirmEvent(t, a.agentId, a.accountId);

    // Attempt 1: token expired — Zernio reports failure.
    vi.stubGlobal("fetch", vi.fn(async () => zernioFailure()));
    const r1 = (await t.action(
      internal.gtmMaya.telegramConfirm.confirmEventConversational,
      { eventId, agentId: a.agentId, decision: "post" }
    )) as { ok: boolean; outcome?: string; reason?: string };
    expect(r1.ok).toBe(false);
    expect(r1.outcome).toBe("retryable");
    const statusAfterFail = await t.run(
      async (ctx) => (await ctx.db.get(eventId))?.status
    );
    expect(statusAfterFail).toBe("needs_confirm"); // NOT 'failed'

    // Attempt 2 (token refreshed): the founder's approval still lands.
    vi.stubGlobal("fetch", vi.fn(async () => zernioSuccess()));
    const r2 = (await t.action(
      internal.gtmMaya.telegramConfirm.confirmEventConversational,
      { eventId, agentId: a.agentId, decision: "post" }
    )) as { ok: boolean; outcome?: string };
    expect(r2.ok).toBe(true);
    expect(r2.outcome).toBe("published");
  });

  it("gate block (no plan) on confirm is retryable, not terminal, and names the blocker", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_noplan", { activePlan: false });
    const eventId = await makeNeedsConfirmEvent(t, a.agentId, a.accountId);
    const fetchMock = vi.fn(async () => zernioSuccess());
    vi.stubGlobal("fetch", fetchMock);
    const r = (await t.action(
      internal.gtmMaya.telegramConfirm.confirmEventConversational,
      { eventId, agentId: a.agentId, decision: "post" }
    )) as { ok: boolean; outcome?: string; reason?: string };
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("retryable");
    expect(r.reason).toContain("plan");
    const status = await t.run(async (ctx) => (await ctx.db.get(eventId))?.status);
    expect(status).toBe("needs_confirm");
    // Gate blocked BEFORE any publish reached Zernio (the content preflight
    // may run, but the posts endpoint must never be hit).
    const postCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) => String(c[0]).endsWith("/api/v1/posts")
    );
    expect(postCalls).toHaveLength(0);
  });
});

describe("dedup ledger: every reply publish stamps, draftId or not", () => {
  beforeEach(() => vi.stubEnv("ZERNIO_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("founder-confirmed reply WITHOUT a draft row still lands in gtmPostResults", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_stamp", { activePlan: true });
    const eventId = await makeNeedsConfirmEvent(t, a.agentId, a.accountId, {
      targetExternalId: "thread_777",
    });
    // Reddit replies route through the inbox comments API (real threading).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, { success: true, data: { commentId: "rc_777" } })
      )
    );
    const r = (await t.action(
      internal.gtmMaya.telegramConfirm.confirmEventConversational,
      { eventId, agentId: a.agentId, decision: "post" }
    )) as { ok: boolean };
    expect(r.ok).toBe(true);
    const stamped = await t.run(async (ctx) =>
      (await ctx.db.query("gtmPostResults").collect()).filter(
        (row) => row.targetExternalId === "thread_777"
      )
    );
    expect(stamped.length).toBe(1);
    expect(stamped[0].agentId).toBe(a.agentId);

    // …and the gate now refuses a second reply to the same thread.
    const prior = await t.run(async (ctx) =>
      await ctx.runQuery(
        internal.gtmMaya.engagementLedger.checkAlreadyEngaged,
        {
          agentId: a.agentId,
          platform: "reddit",
          externalId: "thread_777",
        }
      )
    );
    expect(prior.engaged).toBe(true);
  });
});

describe("pendingConfirms rides get_agent_lifecycle (session-restart recovery)", () => {
  it("lists needs_confirm events with eventId + channel + excerpt", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_pend", { activePlan: true });
    const eventId = await makeNeedsConfirmEvent(t, a.agentId, a.accountId);
    const pending = await t.run(async (ctx) =>
      await ctx.runQuery(internal.gtmMaya.telegramConfirm.listPendingConfirms, {
        agentId: a.agentId,
      })
    );
    expect(pending.length).toBe(1);
    expect(pending[0].eventId).toBe(eventId);
    expect(pending[0].channel).toBe("reddit");
    expect(pending[0].excerpt).toContain("genuinely helpful");
  });

  it("cross-tenant: agent B's queue never shows agent A's events", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_pa", { activePlan: true });
    const b = await setupAgent(t, "c_pb", { activePlan: true });
    await makeNeedsConfirmEvent(t, a.agentId, a.accountId);
    const pendingB = await t.run(async (ctx) =>
      await ctx.runQuery(internal.gtmMaya.telegramConfirm.listPendingConfirms, {
        agentId: b.agentId,
      })
    );
    expect(pendingB.length).toBe(0);
  });
});

describe("record_published paste-flow done-state (eventId accepted)", () => {
  it("flips a needs_confirm event to published and stamps the ledger", async () => {
    const t = convexTest(schema, modules);
    const hookToken = "fake-hook-rp1";
    const a = await setupAgent(t, "c_paste", { activePlan: true, hookToken });
    const eventId = await makeNeedsConfirmEvent(t, a.agentId, a.accountId, {
      targetExternalId: "thread_paste_1",
    });
    const res = await t.fetch("/lc_gtm/record_published", {
      method: "POST",
      headers: {
        authorization: `Bearer ${hookToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "rp1",
        draftId: eventId, // the agent hands over the id she has
        providerPostId: "manual_abc",
        platform: "reddit",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    const ev = await t.run(async (ctx) => await ctx.db.get(eventId));
    expect(ev?.status).toBe("published");
    const stamped = await t.run(async (ctx) =>
      (await ctx.db.query("gtmPostResults").collect()).filter(
        (row) => row.targetExternalId === "thread_paste_1"
      )
    );
    expect(stamped.length).toBe(1);
  });

  it("cross-tenant: agent B cannot mark agent A's event published", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_rpa", { activePlan: true, hookToken: "hk-a" });
    await setupAgent(t, "c_rpb", { activePlan: true, hookToken: "hk-b" });
    const eventId = await makeNeedsConfirmEvent(t, a.agentId, a.accountId);
    const res = await t.fetch("/lc_gtm/record_published", {
      method: "POST",
      headers: {
        authorization: `Bearer hk-b`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "rp2",
        draftId: eventId,
        providerPostId: "steal",
        platform: "reddit",
      }),
    });
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    const ev = await t.run(async (ctx) => await ctx.db.get(eventId));
    expect(ev?.status).toBe("needs_confirm"); // untouched
  });

  it("unknown id → honest ok:false with guidance, not a 500", async () => {
    const t = convexTest(schema, modules);
    await setupAgent(t, "c_rpu", { activePlan: true, hookToken: "hk-u" });
    const res = await t.fetch("/lc_gtm/record_published", {
      method: "POST",
      headers: {
        authorization: `Bearer hk-u`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "rp3",
        draftId: "2077402590472720399", // an external tweet id, the live mistake
        providerPostId: "x_1",
        platform: "x",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toContain("never an external post id");
  });
});

describe("confirm_event decision floor: exact post/skip only", () => {
  it("a malformed decision is refused, never coerced into a publish", async () => {
    const t = convexTest(schema, modules);
    const hookToken = "fake-hook-dec";
    const a = await setupAgent(t, "c_dec", { activePlan: true, hookToken });
    const eventId = await makeNeedsConfirmEvent(t, a.agentId, a.accountId);
    const res = await t.fetch("/lc_gtm/confirm_event", {
      method: "POST",
      headers: {
        authorization: `Bearer ${hookToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ eventId, decision: "skip it" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toContain("invalid decision");
    const ev = await t.run(async (ctx) => await ctx.db.get(eventId));
    expect(ev?.status).toBe("needs_confirm"); // nothing published, nothing lost
  });
});

describe("Zernio reads fail closed without a profile (cross-tenant guard)", () => {
  beforeEach(() => vi.stubEnv("ZERNIO_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fetchConnectionHealth with no zernioProfileId refuses the unscoped read", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_leak", { activePlan: true }); // no profile
    const fetchMock = vi.fn(async () => jsonResponse(200, { accounts: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = (await t.action(internal.gtmMaya.zernioReads.fetchConnectionHealth, {
      agentId: a.agentId,
    })) as { ok: boolean; message?: string };
    expect(r.ok).toBe(false);
    expect(
      fetchMock.mock.calls.filter((c: unknown[]) => String(c[0]).endsWith("/api/v1/posts"))
    ).toHaveLength(0); // Zernio never even queried
  });

  it("with a profile the read proceeds (scoped)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_scoped", {
      activePlan: true,
      zernioProfileId: "prof_1",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { accounts: [] }))
    );
    const r = (await t.action(internal.gtmMaya.zernioReads.fetchConnectionHealth, {
      agentId: a.agentId,
    })) as { ok: boolean };
    expect(r.ok).toBe(true);
  });
});

describe("re-arm via post_to_channel upsert: failed rows become confirmable again", () => {
  it("a failed event re-armed by a fresh persist with status needs_confirm", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_upsert", { activePlan: true });
    const now = Date.now();
    const eventId = await t.run(async (ctx) =>
      ctx.db.insert("gtmCalendarEvents", {
        accountId: a.accountId,
        agentId: a.agentId,
        title: "x post (needs your tap)",
        draftText: "old text",
        startsAtMs: now,
        endsAtMs: now + 3_600_000,
        timezone: "UTC",
        status: "failed",
        createdBy: "maya",
        dedupeKey: "confirm:x:thread_9",
        createdAt: now,
        updatedAt: now,
      })
    );
    const returned = await t.run(async (ctx) =>
      await ctx.runMutation(
        internal.gtmMaya.calendarWrite.persistGtmCalendarEventDraft,
        {
          accountId: a.accountId,
          agentId: a.agentId,
          title: "x post (needs your tap)",
          draftText: "new text",
          startsAtMs: now,
          endsAtMs: now + 3_600_000,
          timezone: "UTC",
          status: "needs_confirm",
          dedupeKey: "confirm:x:thread_9",
        }
      )
    );
    expect(returned).toBe(eventId); // same row, no duplicate
    const ev = await t.run(async (ctx) => await ctx.db.get(eventId));
    expect(ev?.status).toBe("needs_confirm"); // re-armed
    expect(ev?.draftText).toBe("new text");
  });

  it("a published event is NEVER re-armed (double-post protection)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_pub", { activePlan: true });
    const now = Date.now();
    const eventId = await t.run(async (ctx) =>
      ctx.db.insert("gtmCalendarEvents", {
        accountId: a.accountId,
        agentId: a.agentId,
        title: "x post",
        draftText: "live text",
        startsAtMs: now,
        endsAtMs: now + 3_600_000,
        timezone: "UTC",
        status: "published",
        createdBy: "maya",
        dedupeKey: "confirm:x:thread_10",
        createdAt: now,
        updatedAt: now,
      })
    );
    await t.run(async (ctx) =>
      await ctx.runMutation(
        internal.gtmMaya.calendarWrite.persistGtmCalendarEventDraft,
        {
          accountId: a.accountId,
          agentId: a.agentId,
          title: "x post",
          draftText: "retry text",
          startsAtMs: now,
          endsAtMs: now + 3_600_000,
          timezone: "UTC",
          status: "needs_confirm",
          dedupeKey: "confirm:x:thread_10",
        }
      )
    );
    const ev = await t.run(async (ctx) => await ctx.db.get(eventId));
    expect(ev?.status).toBe("published"); // stays terminal
  });
});

describe("ask-gated autonomy (2026-07-20): the ramp offers, never grants", () => {
  it("milestone reached → autonomyReadyToAsk true; asking once stamps and silences the signal", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_ask", { activePlan: true });
    await t.run(async (ctx) => {
      await ctx.db.patch(a.agentId, {
        autonomousPosting: "confirm_first_week",
        autonomousSince: Date.now() - 8 * 24 * 60 * 60 * 1000,
        confirmedPostCount: 0,
      });
    });
    const before = await t.run(async (ctx) => {
      const agent = await ctx.db.get(a.agentId);
      const { computeAgentLifecycle } = await import("../agentLifecycle");
      return computeAgentLifecycle(ctx, agent!, Date.now());
    });
    expect(before.autonomyReadyToAsk).toBe(true);
    expect(before.autonomyMode).toBe("confirm_first_week");

    // Maya asks once (idempotent under retry).
    const first = await t.run(async (ctx) =>
      ctx.runMutation(internal.gtmMaya.agentLifecycle.markAutonomyAsk, {
        agentId: a.agentId,
      })
    );
    const second = await t.run(async (ctx) =>
      ctx.runMutation(internal.gtmMaya.agentLifecycle.markAutonomyAsk, {
        agentId: a.agentId,
      })
    );
    expect(second.askedAt).toBe(first.askedAt);

    const after = await t.run(async (ctx) => {
      const agent = await ctx.db.get(a.agentId);
      const { computeAgentLifecycle } = await import("../agentLifecycle");
      return computeAgentLifecycle(ctx, agent!, Date.now());
    });
    expect(after.autonomyReadyToAsk).toBe(false); // asked — never nag again
  });

  it("a graduated-but-unasked agent still CANNOT auto-post (publish gate requires explicit grant)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_nograd", { activePlan: true });
    await t.run(async (ctx) => {
      await ctx.db.patch(a.agentId, {
        autonomousPosting: "confirm_first_week",
        autonomousSince: Date.now() - 30 * 24 * 60 * 60 * 1000,
        confirmedPostCount: 99,
        connectedAccountsJson: JSON.stringify([
          { accountId: "acct_x", platform: "x" },
        ]),
      });
    });
    const fetchMock = vi.fn(async () => zernioSuccess());
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    const r = (await t.action(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: a.agentId,
        channel: "x",
        zernioAccountId: "acct_x",
        content: "a post with a number 42",
      }
    )) as { action: string };
    expect(r.action).toBe("needs_confirm"); // milestone alone never auto-posts
    expect(
      fetchMock.mock.calls.filter((c: unknown[]) => String(c[0]).endsWith("/api/v1/posts"))
    ).toHaveLength(0);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("re-entering confirm_first_week clears the ask stamp (fresh ramp = fresh offer later)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_askreset", { activePlan: true });
    await t.run(async (ctx) => {
      await ctx.db.patch(a.agentId, { autonomyAskAt: Date.now() - 1000 });
    });
    await t.mutation(internal.gtmMaya.researchLifecycle.setPostingModeByAgent, {
      agentId: a.agentId,
      mode: "confirm_first_week",
    });
    const agent = await t.run(async (ctx) => ctx.db.get(a.agentId));
    expect(agent?.autonomyAskAt).toBeUndefined();
    expect(agent?.confirmedPostCount).toBe(0);
  });
});
