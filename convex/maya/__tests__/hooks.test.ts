import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { hashToken, timingSafeEqual, type Envelope } from "../hooks";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 1, 9, 0, 0);

interface Seeded {
  customerId: Id<"customers">;
  token: string;
  draftId: Id<"drafts">;
}

async function seed(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  opts: {
    postingMode?: "show_me_first" | "just_go";
    state?: "onboarding" | "active" | "paused" | "cancelled";
    channelStatus?: "connected" | "dormant" | "disconnected" | "error";
    channel?: "x" | "tiktok";
  } = {}
): Promise<Seeded> {
  const token = `tok_${suffix}_${suffix.length}`;
  const tokenHash = await hashToken(token);
  const ids = await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "web",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    const customerId = await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: opts.state ?? "active",
      timezone: "UTC",
      telegramChatId: `chat_${suffix}`,
      agentTokenHash: tokenHash,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("channels", {
      customerId,
      channel: opts.channel ?? "x",
      postingMode: opts.postingMode ?? "just_go",
      status: opts.channelStatus ?? "connected",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const draftId = await ctx.db.insert("drafts", {
      customerId,
      channel: opts.channel ?? "x",
      kind: "post",
      snapshotText: "the exact words the founder saw",
      outcome: "approved",
      proposedAt: NOW,
      expiresAt: NOW + 86_400_000,
    });
    return { customerId, draftId };
  });
  return { ...ids, token };
}

function post(
  t: ReturnType<typeof convexTest>,
  path: string,
  token: string | null,
  body: unknown
): Promise<Response> {
  return t.fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function envelope(res: Response): Promise<Envelope<Record<string, unknown>>> {
  return (await res.json()) as Envelope<Record<string, unknown>>;
}

/* ========================================================================== */

describe("THE AGENT CANNOT NAME A TENANT", () => {
  it("no hook accepts a customerId — the field doesn't exist to get wrong", () => {
    // The frozen GTM pack takes the tenant from the request BODY and looks up
    // its token. The token still has to match, so it isn't a hole — but it
    // means every handler is one forgotten re-scope away from acting on a
    // tenant the caller merely claimed to be. This surface removes the
    // argument, so that class of bug has nowhere to live.
    const source = readFileSync(join(__dirname, "..", "hooks.ts"), "utf8");
    const reads = source.match(/str\(parsed\.body,\s*"[^"]+"\)/g) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read).not.toMatch(/customerId|accountId|tenant/i);
    }
    // And nothing anywhere pulls a tenant id off the body.
    expect(source).not.toMatch(/body\s*\.\s*customerId/);
    expect(source).not.toMatch(/body\[["']customerId["']\]/);
  });

  it("one agent's token can never publish another's draft", async () => {
    const t = convexTest(schema, modules);
    const mine = await seed(t, "attacker");
    const theirs = await seed(t, "victim");

    // Present MY token, name THEIR draft — the only handle an agent has.
    const res = await post(t, "/maya/publish", mine.token, {
      draftId: theirs.draftId,
    });
    const env = await envelope(res);

    expect(env.ok).toBe(false);
    expect(env.why).toMatch(/different account/i);

    // And nothing was queued for either tenant.
    const jobs = (await t.run((ctx) => ctx.db.query("jobs").collect())) as Doc<"jobs">[];
    expect(jobs).toEqual([]);
  });

  it("an unknown token is rejected and reveals nothing about which exist", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "real");

    const unknown = await envelope(
      await post(t, "/maya/publish", "tok_not_a_real_token", { draftId: "x" })
    );
    const empty = await envelope(await post(t, "/maya/publish", "   ", { draftId: "x" }));

    expect(unknown.ok).toBe(false);
    expect(empty.ok).toBe(false);
    // Neither response distinguishes "no such token" from any other failure.
    expect(unknown.why).not.toMatch(/exists|found in|account [A-Za-z0-9]{6}/);
  });

  it("a missing bearer header is a 401 envelope, not a crash", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "noauth");
    const res = await post(t, "/maya/publish", null, { draftId: "x" });
    expect(res.status).toBe(401);
    expect((await envelope(res)).ok).toBe(false);
  });

  it("a customer with NO token set is unreachable", async () => {
    // An empty/absent agentTokenHash must not be matchable by an empty token.
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const accountId = await ctx.db.insert("creators", {
        clerkUserId: "u_notoken",
        email: "notoken@example.com",
        channelPreference: "web",
        timezone: "UTC",
        status: "active",
        plan: "manager",
        createdAt: NOW,
      });
      await ctx.db.insert("customers", {
        accountId,
        agentVersion: "v2",
        plan: "mvp",
        state: "active",
        timezone: "UTC",
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    const res = await post(t, "/maya/publish", await hashToken(""), { draftId: "x" });
    expect(res.status).toBe(401);
  });
});

describe("token handling", () => {
  it("the token is stored hashed, never in plaintext", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seed(t, "hashed");
    const rows = (await t.run((ctx) =>
      ctx.db.query("customers").collect()
    )) as Doc<"customers">[];
    expect(rows[0].agentTokenHash).not.toBe(token);
    expect(rows[0].agentTokenHash).toBe(await hashToken(token));
    expect(rows[0].agentTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("timingSafeEqual visits every byte rather than returning early", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    // Differing in the FIRST byte must be handled the same as the last — a
    // compare that returns early leaks the prefix one guess at a time.
    expect(timingSafeEqual("xbc", "abc")).toBe(false);
    expect(timingSafeEqual("ab", "abc")).toBe(false);
  });
});

describe("EVERY RESPONSE CARRIES THE ENVELOPE", () => {
  it("respond() is the only place a Response is constructed", () => {
    // Principle 8: choreography rides in tool responses, never prompts. A
    // handler that returns a bare string leaves the model guessing, and the
    // guess is usually "retry".
    const source = readFileSync(join(__dirname, "..", "hooks.ts"), "utf8");
    const constructions = source.match(/new Response\(/g) ?? [];
    expect(constructions).toHaveLength(1);
    expect(source).toMatch(/function respond<T>\(/);
  });

  it("success, hold, bad-input and auth-failure all parse as an envelope", async () => {
    const t = convexTest(schema, modules);
    const held = await seed(t, "env_hold", { postingMode: "show_me_first" });
    const ok = await seed(t, "env_ok");

    const responses = await Promise.all([
      post(t, "/maya/publish", ok.token, { draftId: ok.draftId }),
      post(t, "/maya/publish", held.token, { draftId: held.draftId }),
      post(t, "/maya/publish", ok.token, {}),
      post(t, "/maya/publish", "nope", { draftId: ok.draftId }),
      post(t, "/maya/publish", ok.token, "{not json"),
    ]);

    for (const res of responses) {
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      const env = await envelope(res);
      expect(typeof env.ok).toBe("boolean");
      // `why` and `next` are what stop a retry loop — an envelope without them
      // is the same guessing game as a bare string.
      expect(env.why).toBeTruthy();
      expect(env.next).toBeTruthy();
    }
  });

  it("a DECIDED hold is HTTP 200 — it is an answer, not a transport failure", async () => {
    // A 4xx invites the runtime's retry layer to hammer a decision that will
    // never change.
    const t = convexTest(schema, modules);
    const held = await seed(t, "hold_200", { postingMode: "show_me_first" });
    const res = await post(t, "/maya/publish", held.token, { draftId: held.draftId });
    expect(res.status).toBe(200);
    expect((await envelope(res)).ok).toBe(false);
  });
});

describe("publish routes through THE iron rule", () => {
  it("the handler contains no publish/hold logic of its own", () => {
    // The whole value of having exactly one function that decides publish-or-
    // hold evaporates the moment a second place can hold a post — and an HTTP
    // handler with its own `if` is the most natural place for that to appear.
    const source = readFileSync(join(__dirname, "..", "hooks.ts"), "utf8");
    expect(source).toMatch(/publishDecision\.decidePublish/);
    // No handler may test the switch, the account state, or the channel itself.
    expect(source).not.toMatch(/postingMode/);
    expect(source).not.toMatch(/["']show_me_first["']\s*===/);
    expect(source).not.toMatch(/customer\.state\s*===/);
    expect(source).not.toMatch(/channel\.status/);
  });

  it("on just_go a publish is cleared and queued", async () => {
    const t = convexTest(schema, modules);
    const { token, draftId, customerId } = await seed(t, "justgo");
    const env = await envelope(await post(t, "/maya/publish", token, { draftId }));

    expect(env.ok).toBe(true);
    expect(env.data?.queued).toBe(true);

    const jobs = (await t.run((ctx) => ctx.db.query("jobs").collect())) as Doc<"jobs">[];
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe("publish_placement");
    expect(jobs[0].customerId).toBe(customerId);
    // Invariant 2: the queued text is the SNAPSHOT, never a regeneration.
    expect(JSON.parse(jobs[0].payloadJson!).snapshotText).toBe(
      "the exact words the founder saw"
    );
  });

  it("on show_me_first it holds, and TELLS THE MODEL NOT TO RETRY", async () => {
    const t = convexTest(schema, modules);
    const { token, draftId } = await seed(t, "showfirst", {
      postingMode: "show_me_first",
    });
    const env = await envelope(await post(t, "/maya/publish", token, { draftId }));

    expect(env.ok).toBe(false);
    expect(env.data?.holdReason).toBe("show_me_first");
    expect(env.next).toMatch(/do not retry/i);
    expect(await t.run((ctx) => ctx.db.query("jobs").collect())).toEqual([]);
  });

  it("an explicit approval clears the same draft", async () => {
    const t = convexTest(schema, modules);
    const { token, draftId } = await seed(t, "approved", {
      postingMode: "show_me_first",
    });
    const env = await envelope(
      await post(t, "/maya/publish", token, { draftId, alreadyApproved: true })
    );
    expect(env.ok).toBe(true);
    expect(env.data?.queued).toBe(true);
  });

  it("a paused account is held by the floor, not by the switch", async () => {
    const t = convexTest(schema, modules);
    const { token, draftId } = await seed(t, "paused", { state: "paused" });
    const env = await envelope(
      await post(t, "/maya/publish", token, { draftId, alreadyApproved: true })
    );
    expect(env.ok).toBe(false);
    expect(env.data?.holdReason).toBe("safety_floor");
    // Even an approval can't override the floor.
    expect(await t.run((ctx) => ctx.db.query("jobs").collect())).toEqual([]);
  });

  it("a disconnected channel is held as unavailable", async () => {
    const t = convexTest(schema, modules);
    const { token, draftId } = await seed(t, "disc", {
      channelStatus: "disconnected",
    });
    const env = await envelope(await post(t, "/maya/publish", token, { draftId }));
    expect(env.data?.holdReason).toBe("channel_unavailable");
  });

  it("TikTok's preview consent is stated as the PLATFORM's rule", async () => {
    // §9.1's one carve-out. Framing matters: it's their requirement, not our
    // caution dressed up as theirs.
    const t = convexTest(schema, modules);
    const { token, draftId } = await seed(t, "tiktok", { channel: "tiktok" });
    const env = await envelope(await post(t, "/maya/publish", token, { draftId }));
    expect(env.data?.holdReason).toBe("tiktok_preview_consent");
    expect(env.why).toMatch(/their rule/i);
  });
});

describe("double-publish prevention", () => {
  it("a draft already live returns duplicate rather than posting twice", async () => {
    const t = convexTest(schema, modules);
    const { token, draftId, customerId } = await seed(t, "dupe");
    await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        linkStatus: "live",
        publishedAt: NOW,
        snapshotText: "already out",
        idempotencyKey: `draft:${draftId}`,
      })
    );

    const env = await envelope(await post(t, "/maya/publish", token, { draftId }));
    expect(env.data?.duplicate).toBe(true);
    expect(env.next).toMatch(/don't post it again/i);
    expect(await t.run((ctx) => ctx.db.query("jobs").collect())).toEqual([]);
  });

  it("two publishes of one draft enqueue ONE job", async () => {
    // The idempotency key is derived from the draft, so the queue collapses
    // the retry even before a placement row exists.
    const t = convexTest(schema, modules);
    const { token, draftId } = await seed(t, "twice");
    await post(t, "/maya/publish", token, { draftId });
    await post(t, "/maya/publish", token, { draftId });

    const jobs = (await t.run((ctx) => ctx.db.query("jobs").collect())) as Doc<"jobs">[];
    expect(jobs).toHaveLength(1);
  });
});

describe("reply", () => {
  it("requires what it is replying to", async () => {
    const t = convexTest(schema, modules);
    const { token, draftId } = await seed(t, "noparent");
    const env = await envelope(await post(t, "/maya/reply", token, { draftId }));
    expect(env.ok).toBe(false);
    expect(env.why).toMatch(/inReplyTo/);
  });

  it("queues with the parent threaded through", async () => {
    const t = convexTest(schema, modules);
    const { token, draftId } = await seed(t, "replyok");
    const env = await envelope(
      await post(t, "/maya/reply", token, { draftId, inReplyTo: "tweet_123" })
    );
    expect(env.ok).toBe(true);
    const jobs = (await t.run((ctx) => ctx.db.query("jobs").collect())) as Doc<"jobs">[];
    expect(JSON.parse(jobs[0].payloadJson!).inReplyTo).toBe("tweet_123");
  });

  it("goes through the same decision as a post — no parallel path", async () => {
    const t = convexTest(schema, modules);
    const { token, draftId } = await seed(t, "replyhold", {
      postingMode: "show_me_first",
    });
    const env = await envelope(
      await post(t, "/maya/reply", token, { draftId, inReplyTo: "t1" })
    );
    expect(env.data?.holdReason).toBe("show_me_first");
  });

  it("cannot reply on another tenant's draft either", async () => {
    const t = convexTest(schema, modules);
    const mine = await seed(t, "r_attacker");
    const theirs = await seed(t, "r_victim");
    const env = await envelope(
      await post(t, "/maya/reply", mine.token, {
        draftId: theirs.draftId,
        inReplyTo: "t1",
      })
    );
    expect(env.ok).toBe(false);
    expect(env.why).toMatch(/different account/i);
  });
});

describe("ask_founder honours the one-open-question invariant", () => {
  it("asks, and the question is queued for delivery", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seed(t, "ask1");
    const env = await envelope(
      await post(t, "/maya/ask_founder", token, { question: "which angle?" })
    );
    expect(env.ok).toBe(true);
    expect(env.data?.asked).toBe(true);

    const msgs = (await t.run((ctx) =>
      ctx.db.query("messages").collect()
    )) as Doc<"messages">[];
    expect(msgs[0].body).toBe("which angle?");
    expect(msgs[0].awaitingAnswer).toBe(true);
  });

  it("REFUSES A SECOND QUESTION and names the one outstanding", async () => {
    // An agent that asks twice reads as an employee who doesn't listen — the
    // fastest way to lose trust in something that texts you.
    const t = convexTest(schema, modules);
    const { token } = await seed(t, "ask2");
    await post(t, "/maya/ask_founder", token, { question: "which angle?" });
    const env = await envelope(
      await post(t, "/maya/ask_founder", token, { question: "got any footage?" })
    );

    expect(env.ok).toBe(false);
    expect(env.data?.asked).toBe(false);
    expect(env.why).toMatch(/which angle\?/);
    expect(env.next).toMatch(/don't stack/i);
  });

  it("one tenant's open question never blocks another's", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "ask_a");
    const b = await seed(t, "ask_b");
    await post(t, "/maya/ask_founder", a.token, { question: "A's question" });
    const env = await envelope(
      await post(t, "/maya/ask_founder", b.token, { question: "B's question" })
    );
    expect(env.ok).toBe(true);
  });

  it("an empty question is refused before anything is written", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seed(t, "ask_empty");
    const env = await envelope(
      await post(t, "/maya/ask_founder", token, { question: "   " })
    );
    expect(env.ok).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("messages").collect())).toEqual([]);
  });
});

describe("the v1 pack cannot reach the v2 surface", () => {
  it("maya routes live under their own prefix, not /lc_gtm/*", () => {
    // gtmMaya is frozen. A shared prefix would let a v1 agent's token reach a
    // v2 handler; separate namespace, separate credential, separate blast
    // radius.
    const http = readFileSync(join(__dirname, "..", "..", "http.ts"), "utf8");
    for (const route of ["/maya/publish", "/maya/reply", "/maya/ask_founder"]) {
      expect(http).toContain(`path: "${route}"`);
    }
    expect(http).not.toMatch(/path: "\/lc_gtm\/(publish|reply|ask_founder)"/);
  });
});

describe("a throttled machine still publishes what was already approved", () => {
  it("publish_placement is never throttled by the spend ceiling", async () => {
    // Found while wiring this surface: `publish_placement` was unclassified, so
    // the ceiling's fail-toward-spending-less default made it throttleable.
    // That means a founder says yes and the post silently never goes out — the
    // exact silent hold the iron rule exists to eliminate, reintroduced one
    // layer down through the job queue.
    //
    // `publishDecision` refuses to consult budgets because failing after a yes
    // is the worst possible sequence. That refusal is worth nothing if the
    // queue re-checks a budget on the way out.
    const { allowsKind, ALWAYS_ALLOWED_KINDS } = await import("../spendCeiling");
    expect(allowsKind("throttled", "publish_placement")).toBe(true);
    expect(ALWAYS_ALLOWED_KINDS).toContain("publish_placement");
    // The expensive upstream half stays throttleable — that's where the money is.
    expect(allowsKind("throttled", "produce_post")).toBe(false);
    expect(allowsKind("throttled", "render_video")).toBe(false);
  });

  it("a genuinely new, unclassified kind still fails toward spending less", async () => {
    // The default must stay strict — this fix is one named correction, not a
    // loosening of the rule.
    const { allowsKind } = await import("../spendCeiling");
    expect(allowsKind("throttled", "some_future_expensive_thing")).toBe(false);
  });
});
