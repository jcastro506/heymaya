/**
 * The wire between Convex and her machine.
 *
 * Its absence is the bug that made her look broken: a founder's "Hello" was
 * recorded in Convex and nothing carried it across, because her OpenClaw isn't
 * connected to Telegram and can't be.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { CHAT_TURN_TIMEOUT_MS } from "../handoff";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 4, 12, 0, 0);
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

async function seed(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  over: Partial<Doc<"customers">> = {}
): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      telegramChatId: `chat_${suffix}`,
      gatewayToken: "gw_secret",
      machineUrl: "https://maya-test.fly.dev",
      createdAt: NOW,
      updatedAt: NOW,
      ...over,
    });
  });
}

/** Stub the gateway. Nothing in these tests touches a real network. */
function stubGateway(
  reply: string | null,
  opts: { status?: number; body?: string } = {}
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (opts.status && opts.status >= 400) {
      return new Response(opts.body ?? "boom", { status: opts.status });
    }
    if (opts.body !== undefined) {
      return new Response(opts.body, { status: 200 });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: reply } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;
  return calls;
}

describe("THE MESSAGE ACTUALLY REACHES HER", () => {
  it("forwards the founder's text to the gateway", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "fwd");
    const calls = stubGateway("On it.");

    const res = await t.action(internal.maya.handoff.routeInboundToMachine, {
      customerId,
      text: "how's it going",
    });
    expect(res.delivered).toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://maya-test.fly.dev/v1/chat/completions");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.messages[0].content).toBe("how's it going");
  });

  it("USES THE DURABLE SESSION KEY", async () => {
    // Without an explicit session key OpenClaw's isolated entry points mint a
    // NEW session per call — which is exactly what made v1 amnesiac: five DMs,
    // five conversations, no memory of any of them.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "session");
    const calls = stubGateway("ok");
    await t.action(internal.maya.handoff.routeInboundToMachine, {
      customerId,
      text: "hi",
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-openclaw-session-key"]).toBe("agent:main:main");
  });

  it("authenticates with the GATEWAY token, not the agent token", async () => {
    // They are deliberately different values — OpenClaw refuses to boot when
    // the hook and gateway tokens match.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "auth", { agentTokenHash: "hashed_other" });
    const calls = stubGateway("ok");
    await t.action(internal.maya.handoff.routeInboundToMachine, {
      customerId,
      text: "hi",
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer gw_secret");
  });

  it("her reply comes back through the MESSAGE LOG, not straight to Telegram", async () => {
    // Convex stays the single writer of what the founder was told. A machine
    // talking to Telegram behind our back would make the transcript a guess.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "reply");
    stubGateway("Posted it — here's the link.");

    await t.action(internal.maya.handoff.routeInboundToMachine, {
      customerId,
      text: "post it",
    });

    const out = (
      (await t.run((ctx) => ctx.db.query("messages").collect())) as Doc<"messages">[]
    ).filter((m) => m.direction === "out");
    expect(out).toHaveLength(1);
    expect(out[0].body).toMatch(/Posted it/);
  });

  it("A SILENT TURN IS A REAL ANSWER, not an empty message", async () => {
    // She is allowed to decide nothing needs saying. Delivering an empty
    // message would be worse than delivering nothing.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "silent");
    stubGateway("NO_REPLY");

    const res = await t.action(internal.maya.handoff.routeInboundToMachine, {
      customerId,
      text: "ok",
    });
    expect(res.delivered).toBe(true);
    const out = (
      (await t.run((ctx) => ctx.db.query("messages").collect())) as Doc<"messages">[]
    ).filter((m) => m.direction === "out");
    expect(out).toEqual([]);
  });
});

describe("failures are NAMED, never silent", () => {
  it("an undeployed machine says so", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "nomachine", {
      machineUrl: undefined,
      gatewayToken: undefined,
    });
    const res = await t.action(internal.maya.handoff.routeInboundToMachine, {
      customerId,
      text: "hi",
    });
    expect(res.delivered).toBe(false);
    expect(res.reason).toMatch(/no machine|not paired/i);
  });

  it("an unpaired chat says so", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "nochat", { telegramChatId: undefined });
    const res = await t.action(internal.maya.handoff.routeInboundToMachine, {
      customerId,
      text: "hi",
    });
    expect(res.delivered).toBe(false);
  });

  it("a gateway error is reported with its status", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "err");
    stubGateway(null, { status: 502, body: "bad gateway" });
    const res = await t.action(internal.maya.handoff.routeInboundToMachine, {
      customerId,
      text: "hi",
    });
    expect(res.delivered).toBe(false);
    expect(res.reason).toMatch(/502/);
  });

  it("a non-JSON body is a named failure, not a crash", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "junk");
    stubGateway(null, { body: "<html>nope</html>" });
    const res = await t.action(internal.maya.handoff.routeInboundToMachine, {
      customerId,
      text: "hi",
    });
    expect(res.delivered).toBe(false);
    expect(res.reason).toMatch(/non-JSON/i);
  });

  it("a TIMEOUT never retries — the turn may still be running", async () => {
    // Re-sending would inject the founder's words into her session twice.
    const source = readFileSync(join(__dirname, "..", "handoff.ts"), "utf8");
    expect(source).toMatch(/may STILL be running/i);
    expect(source).not.toMatch(/scheduler\.runAfter[^)]*routeInboundToMachine/);
    // And the budget is generous, because a real turn does real work.
    expect(CHAT_TURN_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe("HANDLEINBOUND ACTUALLY FORWARDS", () => {
  it("an inbound Telegram message reaches the machine", async () => {
    // The regression that matters. For a day this recorded the message and
    // returned, under a comment claiming OpenClaw would pick it up. It doesn't
    // — her machine has no Telegram connection at all.
    const t = convexTest(schema, modules);
    await seed(t, "e2e");
    const calls = stubGateway("Hey — saw it.");

    await t.action(internal.maya.telegram.handleInbound, {
      chatId: "chat_e2e",
      text: "you there?",
      ts: NOW,
    });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].url).toContain("/v1/chat/completions");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.messages[0].content).toBe("you there?");
  });

  it("the inbound row is still written even when forwarding fails", async () => {
    // The record of what the founder said must not depend on her being up.
    const t = convexTest(schema, modules);
    await seed(t, "downrec", { machineUrl: undefined, gatewayToken: undefined });
    const res = await t.action(internal.maya.telegram.handleInbound, {
      chatId: "chat_downrec",
      text: "anyone home",
      ts: NOW,
    });
    expect(res.recorded).toBe(true);
    expect(res.reason).toBeTruthy();

    const inbound = (
      (await t.run((ctx) => ctx.db.query("messages").collect())) as Doc<"messages">[]
    ).filter((m) => m.direction === "in");
    expect(inbound).toHaveLength(1);
  });
});

describe("readiness is measured, not assumed", () => {
  it("a healthy gateway marks the machine ready", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "health");
    globalThis.fetch = (async () => new Response("ok", { status: 200 })) as typeof fetch;

    const res = await t.action(internal.maya.handoff.checkHealth, { customerId });
    expect(res.healthy).toBe(true);

    const row = (await t.run((ctx) => ctx.db.get(customerId))) as Doc<"customers">;
    expect(row.machineReadyAt).toBeDefined();
  });

  it("AN UNREACHABLE GATEWAY IS NOT READY", async () => {
    // "Fly says started" and "the gateway is answering" are different claims —
    // and the first was true throughout the boot loop that ate three deploys.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "unhealthy");
    globalThis.fetch = (async () => {
      throw new Error("connection refused");
    }) as typeof fetch;

    const res = await t.action(internal.maya.handoff.checkHealth, { customerId });
    expect(res.healthy).toBe(false);
    const row = (await t.run((ctx) => ctx.db.get(customerId))) as Doc<"customers">;
    expect(row.machineReadyAt).toBeUndefined();
  });

  it("a redeploy clears stale readiness", async () => {
    // New machine, new credentials — the old "ready" says nothing about it.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "restale", { machineReadyAt: NOW - 1000 });
    await t.mutation(internal.maya.deploy.storeAgentTokenHash, {
      customerId,
      tokenHash: "newhash",
      gatewayToken: "gw_new",
      machineUrl: "https://maya-new.fly.dev",
    });
    const row = (await t.run((ctx) => ctx.db.get(customerId))) as Doc<"customers">;
    expect(row.machineReadyAt).toBeUndefined();
  });
});


/**
 * ⭐ THE AMBIGUOUS YES — 2026-08-08.
 *
 * She showed a draft asking *"Want this to go out?"*. The founder replied
 * **"Looks great. Loving your work"**. She answered *"Thank you — that means a
 * lot 😊"* and did not post it.
 *
 * This was not the plumbing. By then she had the `pending` tool, the draftId
 * arrived in the system note, and `publish` worked — the three fixes that
 * preceded it all held. **She read approval as a compliment.**
 *
 * The note covered three cases — approves, changed the wording, unrelated — and
 * had nothing for the ambiguous middle, and never said that letting it drop is
 * itself a failure. "Looks great" fell straight into the gap.
 */
describe("the system note covers the ambiguous middle", () => {
  const NOTE_SOURCE = readFileSync(
    join(__dirname, "..", "handoff.ts"),
    "utf8"
  );

  it("names the ways approval actually arrives", () => {
    // It almost never arrives as the word "yes".
    for (const phrase of ["looks great", "love it", "go for it"]) {
      expect(NOTE_SOURCE.toLowerCase()).toContain(phrase);
    }
  });

  it("tells her to ASK when she isn't sure, rather than let it drop", () => {
    expect(NOTE_SOURCE).toMatch(/NOT SURE|not sure/);
    expect(NOTE_SOURCE).toMatch(/want me to send it/i);
  });

  it("names silence as the worst outcome, because it's the invisible one", () => {
    // A founder who thinks they approved something, and it never posts, has no
    // way to see that — unlike a bad post or a question they can answer.
    expect(NOTE_SOURCE).toMatch(/cannot see|can't see/);
  });

  it("still tells her to ignore it when the message isn't about a draft", () => {
    // The note rides EVERY inbound turn. Without this it would push her to
    // relate unrelated conversation back to a pending draft.
    expect(NOTE_SOURCE).toMatch(/isn't about a draft|is not about a draft/);
  });
});
