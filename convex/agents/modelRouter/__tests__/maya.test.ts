import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import { computeCostUsd } from "../maya";

// convex-test discovers Convex modules via import.meta.glob; provide an
// explicit map so the test environment finds the router and log mutation.
import { modules } from "../../../../tests/_modules";

function makeOkResponse(opts: {
  inputTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  content?: string;
  model?: string;
}): Response {
  const body = {
    id: "gen-test",
    model: opts.model ?? "google/gemini-3-flash",
    choices: [
      {
        message: { content: opts.content ?? "ok" },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: opts.inputTokens ?? 100,
      completion_tokens: opts.completionTokens ?? 100,
      completion_tokens_details: {
        reasoning_tokens: opts.reasoningTokens ?? 0,
      },
    },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const NOW = 1_700_000_000_000;
const TZ = "America/Los_Angeles";

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_DEFAULT_MODEL = "google/gemini-3-flash";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("callMaya — plan-tier clamping (non-negotiable)", () => {
  it("Coach creator + morning_brief (default medium) → no clamp post-coach/manager migration", async () => {
    const t = convexTest(schema, modules);

    const creatorId = await t.run(async (ctx) => {
      return await ctx.db.insert("creators", {
        clerkUserId: "u_starter",
        email: "starter@test.com",
        channelPreference: "web",
        timezone: TZ,
        status: "active",
        plan: "coach",
        createdAt: NOW,
      });
    });

    const fetchSpy = vi.fn(async () =>
      makeOkResponse({
        inputTokens: 200,
        completionTokens: 50,
        reasoningTokens: 0,
        content: "morning brief draft",
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await t.action(internal.agents.modelRouter.maya.callMaya, {
      creatorId,
      taskTag: "morning_brief",
      messages: [{ role: "user", content: "what's the brief?" }],
    });

    // Both tiers allow medium+; no clamp.
    expect(result.thinkingBudgetUsed).toBe("medium");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    const sent = JSON.parse(init.body as string);
    expect(sent.reasoning).toEqual({ effort: "medium" });

    const logs = await t.run(async (ctx) =>
      await ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].thinkingBudget).toBe("medium");
    expect(logs[0].taskTag).toBe("morning_brief");
    expect(logs[0].model).toBe("google/gemini-3-flash");
  });

  it("Coach creator can use `high` thinking — boundary is autonomy, not compute", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_starter2",
        email: "s2@test.com",
        channelPreference: "web",
        timezone: TZ,
        status: "active",
        plan: "coach",
        createdAt: NOW,
      })
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeOkResponse({}))
    );

    const result = await t.action(internal.agents.modelRouter.maya.callMaya, {
      creatorId,
      taskTag: "brand_email_draft", // default high
      requestedBudget: "high",
      messages: [{ role: "user", content: "draft this" }],
    });

    expect(result.thinkingBudgetUsed).toBe("high");
    const logs = await t.run(async (ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(logs[0].thinkingBudget).toBe("high");
  });

  it("Pro creator + brand_email_draft (default high) → high, no clamp", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_pro",
        email: "pro@test.com",
        channelPreference: "imessage",
        timezone: TZ,
        status: "active",
        plan: "manager",
        createdAt: NOW,
      })
    );

    const fetchSpy = vi.fn(async () =>
      makeOkResponse({ inputTokens: 500, completionTokens: 1500, reasoningTokens: 1000 })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await t.action(internal.agents.modelRouter.maya.callMaya, {
      creatorId,
      taskTag: "brand_email_draft",
      messages: [{ role: "user", content: "draft a reply" }],
    });

    expect(result.thinkingBudgetUsed).toBe("high");
    const sent = JSON.parse(
      (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    );
    expect(sent.reasoning).toEqual({ effort: "high" });
  });
});

describe("callMaya — cost math", () => {
  it("computes costUsd correctly for known token counts", () => {
    // 1,000,000 input @ $0.50 + 1,000,000 output @ $3.00 = $3.50
    expect(
      computeCostUsd({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        thinkingTokens: 0,
      })
    ).toBeCloseTo(3.5, 6);

    // Thinking tokens billed at output rate.
    // 100k input @ $0.50/M = $0.05; 50k output + 50k thinking @ $3.00/M = $0.30
    // total = $0.35
    expect(
      computeCostUsd({
        inputTokens: 100_000,
        outputTokens: 50_000,
        thinkingTokens: 50_000,
      })
    ).toBeCloseTo(0.35, 6);

    // Small call: 200 input + 50 output + 0 thinking
    // (200 * 0.5 + 50 * 3.0) / 1_000_000 = (100 + 150) / 1e6 = 0.00025
    expect(
      computeCostUsd({
        inputTokens: 200,
        outputTokens: 50,
        thinkingTokens: 0,
      })
    ).toBeCloseTo(0.00025, 8);
  });

  it("aiCallLog row records the correct costUsd, latencyMs, ts, and token fields", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_pro2",
        email: "p2@test.com",
        channelPreference: "web",
        timezone: TZ,
        status: "active",
        plan: "manager",
        createdAt: NOW,
      })
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        makeOkResponse({
          inputTokens: 1000,
          completionTokens: 800, // includes 300 reasoning
          reasoningTokens: 300,
        })
      )
    );

    await t.action(internal.agents.modelRouter.maya.callMaya, {
      creatorId,
      taskTag: "weekly_content_plan",
      messages: [{ role: "user", content: "plan my week" }],
    });

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log.inputTokens).toBe(1000);
    expect(log.outputTokens).toBe(500); // 800 - 300 reasoning
    expect(log.thinkingTokens).toBe(300);
    // (1000 * 0.5 + (500 + 300) * 3.0) / 1_000_000
    // = (500 + 2400) / 1_000_000 = 0.0029
    expect(log.costUsd).toBeCloseTo(0.0029, 8);
    expect(typeof log.latencyMs).toBe("number");
    expect(log.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof log.ts).toBe("number");
    expect(log.ts).toBeGreaterThan(0);
  });
});

describe("callMaya — cross-tenant isolation", () => {
  it("aiCallLog rows for creator B do not include creator A's calls", async () => {
    const t = convexTest(schema, modules);
    const creatorA = await t.run(async (ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "uA",
        email: "a@test.com",
        channelPreference: "web",
        timezone: TZ,
        status: "active",
        plan: "manager",
        createdAt: NOW,
      })
    );
    const creatorB = await t.run(async (ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "uB",
        email: "b@test.com",
        channelPreference: "web",
        timezone: TZ,
        status: "active",
        plan: "manager",
        createdAt: NOW,
      })
    );

    vi.stubGlobal("fetch", vi.fn(async () => makeOkResponse({})));

    await t.action(internal.agents.modelRouter.maya.callMaya, {
      creatorId: creatorA,
      taskTag: "chat_reply",
      messages: [{ role: "user", content: "A says hi" }],
    });
    await t.action(internal.agents.modelRouter.maya.callMaya, {
      creatorId: creatorA,
      taskTag: "evening_recap",
      messages: [{ role: "user", content: "A recap" }],
    });
    await t.action(internal.agents.modelRouter.maya.callMaya, {
      creatorId: creatorB,
      taskTag: "chat_reply",
      messages: [{ role: "user", content: "B says hi" }],
    });

    const aLogs = await t.run(async (ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorA))
        .collect()
    );
    const bLogs = await t.run(async (ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorB))
        .collect()
    );
    expect(aLogs).toHaveLength(2);
    expect(bLogs).toHaveLength(1);
    for (const log of bLogs) {
      expect(log.creatorId).toBe(creatorB);
      expect(log.creatorId).not.toBe(creatorA);
    }
    for (const log of aLogs) {
      expect(log.creatorId).toBe(creatorA);
    }
  });
});

describe("callMaya — input validation", () => {
  it("throws on unknown task tag", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "uX",
        email: "x@test.com",
        channelPreference: "web",
        timezone: TZ,
        status: "active",
        plan: "manager",
        createdAt: NOW,
      })
    );
    vi.stubGlobal("fetch", vi.fn(async () => makeOkResponse({})));

    await expect(
      t.action(internal.agents.modelRouter.maya.callMaya, {
        creatorId,
        taskTag: "this_is_not_a_real_task",
        messages: [{ role: "user", content: "x" }],
      })
    ).rejects.toThrow(/unknown task tag/i);
  });

  it("throws on empty messages array", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "uY",
        email: "y@test.com",
        channelPreference: "web",
        timezone: TZ,
        status: "active",
        plan: "manager",
        createdAt: NOW,
      })
    );
    vi.stubGlobal("fetch", vi.fn(async () => makeOkResponse({})));

    await expect(
      t.action(internal.agents.modelRouter.maya.callMaya, {
        creatorId,
        taskTag: "chat_reply",
        messages: [],
      })
    ).rejects.toThrow(/non-empty/);
  });

  it("throws when creator does not exist", async () => {
    const t = convexTest(schema, modules);
    // Insert + delete to obtain a stale id.
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "uZ",
        email: "z@test.com",
        channelPreference: "web",
        timezone: TZ,
        status: "active",
        plan: "manager",
        createdAt: NOW,
      })
    );
    await t.run(async (ctx) => ctx.db.delete(creatorId));
    vi.stubGlobal("fetch", vi.fn(async () => makeOkResponse({})));

    await expect(
      t.action(internal.agents.modelRouter.maya.callMaya, {
        creatorId,
        taskTag: "chat_reply",
        messages: [{ role: "user", content: "hi" }],
      })
    ).rejects.toThrow(/not found/);
  });
});
