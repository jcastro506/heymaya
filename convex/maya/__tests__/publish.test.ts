/**
 * Publishing (Sprint 3) — a 200 is not the success signal.
 *
 * The most expensive failure in this product's history: Zernio publish calls
 * returned 200 for SIX DAYS while nothing was published. A lenient schema
 * parsed a changed response shape "successfully" into nothing, so every
 * dashboard stayed green and every post was missing.
 *
 * Most of what follows exists so that cannot happen twice.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import {
  publishText,
  ZERNIO_PLATFORM_SLUG,
} from "../../integrations/zernio/publish";
import { ZernioClient } from "../../integrations/zernio/client";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 4, 12, 0, 0);
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A well-formed create response. */
function created(url: string | null, status = "published") {
  return {
    post: {
      _id: "65f1c0a9e2b5af0012ab34cd",
      status,
      platforms: [
        { platform: "twitter", status, platformPostUrl: url },
      ],
    },
  };
}

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * ⭐ Stubs BOTH vendors the publish path touches, routed by host.
 *
 * The safety critic sits immediately before the Zernio call, so a stub that
 * only answers Zernio hands the critic a Zernio-shaped body, it fails to parse
 * a verdict, and — correctly — holds the post. Every publish test then fails
 * for a reason that has nothing to do with what it is testing.
 *
 * Routing by host keeps that honest rather than papering over it: a future
 * change that adds another vendor to this path will fail here loudly.
 */
function stubZernio(
  response: unknown,
  init: { status?: number; criticSafe?: boolean } = {}
): Call[] {
  const calls: Call[] = [];
  // `callOpenRouter` returns early without a key and never reaches fetch, so
  // the critic must have one for the stub above to be reachable at all.
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  globalThis.fetch = (async (input: RequestInfo | URL, opts?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      headers: (opts?.headers ?? {}) as Record<string, string>,
      body: opts?.body ? JSON.parse(opts.body as string) : undefined,
    });

    // The safety critic — an OpenRouter chat completion, not a Zernio call.
    if (url.includes("openrouter")) {
      const safe = init.criticSafe !== false;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  safe
                    ? { safe: true }
                    : { safe: false, category: "impersonation", why: "names a real person" }
                ),
              },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(response), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

/**
 * The Zernio calls only.
 *
 * ⭐ `zernioCalls(calls)[0]` is now the SAFETY CRITIC, not the post — the check runs
 * immediately before the vendor call, so anything indexing position 0 is
 * asserting on the critique. That two tests broke this way is the useful part:
 * it proves the gate is genuinely on the path rather than beside it.
 */
function zernioCalls(calls: Call[]): Call[] {
  return calls.filter((c) => !c.url.includes("openrouter"));
}

function client(): ZernioClient {
  // No retries, no backoff — these tests assert behaviour, not patience.
  return new ZernioClient({ apiKey: "test-key", maxAttempts: 1 });
}

const BASE = {
  accountId: "acct_1",
  channel: "x",
  text: "Widgetly turns a CSV into a dashboard in one paste.",
  idempotencyKey: "idem_abc123",
};

/* -------------------------------------------------------------------------- */

describe("A 200 IS NOT THE SUCCESS SIGNAL", () => {
  it("⭐ A CHANGED RESPONSE SHAPE IS AN ERROR, NOT A SILENT SUCCESS", async () => {
    // THE regression. This exact scenario — a 200 whose body no longer carries
    // platform results — ran green for six days while nothing published.
    // Plausible, cheerful, and missing everything that proves a post exists.
    stubZernio({ success: true, message: "Post created" });
    const res = await publishText({ ...BASE, client: client() });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/unrecognised response shape/i);
      // Not retryable: retrying a contract change just repeats it quietly.
      expect(res.retryable).toBe(false);
    }
  });

  it("a 200 with an EMPTY platforms array is not a publish", async () => {
    stubZernio({ post: { _id: "p1", status: "published", platforms: [] } });
    const res = await publishText({ ...BASE, client: client() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/no twitter result/i);
  });

  it("a platform-level failure inside a 200 is a failure", async () => {
    stubZernio({
      post: {
        _id: "p1",
        status: "partial",
        platforms: [
          { platform: "twitter", status: "failed", error: "duplicate content" },
        ],
      },
    });
    const res = await publishText({ ...BASE, client: client() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/duplicate content/);
  });

  it("a real published response yields the URL", async () => {
    stubZernio(created("https://twitter.com/acme/status/123456789"));
    const res = await publishText({ ...BASE, client: client() });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.url).toBe("https://twitter.com/acme/status/123456789");
      expect(res.deduped).toBe(false);
    }
  });
});

describe("IDEMPOTENCY — THE HEADER V1 NEVER SENT", () => {
  it("⭐ sends x-request-id, which is what makes a queue retry safe", async () => {
    const calls = stubZernio(created("https://twitter.com/a/status/1"));
    await publishText({ ...BASE, client: client() });
    expect(zernioCalls(calls)[0].headers["x-request-id"]).toBe("idem_abc123");
  });

  it("A 409 IS A SUCCESS — the text already went out", async () => {
    // Zernio's content-hash dedup returns 409 within 24h. Reporting that as a
    // failure would make a delivered post look lost, and retrying it can never
    // succeed.
    stubZernio({ error: "duplicate content" }, { status: 409 });
    const res = await publishText({ ...BASE, client: client() });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.deduped).toBe(true);
  });

  it("a 5xx is retryable and a 4xx is not", async () => {
    stubZernio({ error: "upstream" }, { status: 503 });
    const server = await publishText({ ...BASE, client: client() });
    expect(server.ok).toBe(false);
    if (!server.ok) expect(server.retryable).toBe(true);

    stubZernio({ error: "bad request" }, { status: 400 });
    const bad = await publishText({ ...BASE, client: client() });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.retryable).toBe(false);
  });
});

describe("THE WIRE CONTRACT", () => {
  it("⭐ X IS `twitter`, NOT `x`", async () => {
    // Documented gotcha, and a silent one: sending `x` is not rejected as a
    // typo, it just targets a platform that doesn't exist for this account.
    expect(ZERNIO_PLATFORM_SLUG.x).toBe("twitter");
    const calls = stubZernio(created("https://twitter.com/a/status/1"));
    await publishText({ ...BASE, client: client() });
    const body = zernioCalls(calls)[0].body as { platforms: Array<{ platform: string }> };
    expect(body.platforms[0].platform).toBe("twitter");
  });

  it("publishes now rather than scheduling", async () => {
    const calls = stubZernio(created("https://twitter.com/a/status/1"));
    await publishText({ ...BASE, client: client() });
    expect((zernioCalls(calls)[0].body as { publishNow: boolean }).publishNow).toBe(true);
  });

  it("refuses empty text without calling the vendor", async () => {
    const calls = stubZernio(created(null));
    const res = await publishText({ ...BASE, client: client(), text: "   " });
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("an unmapped channel is refused, not guessed", async () => {
    const calls = stubZernio(created(null));
    const res = await publishText({ ...BASE, client: client(), channel: "myspace" });
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */

async function seed(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  channel: Partial<Doc<"channels">> = {}
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
    const customerId = await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("channels", {
      customerId,
      channel: "x",
      postingMode: "just_go",
      status: "connected",
      zernioAccountId: "acct_1",
      createdAt: NOW,
      updatedAt: NOW,
      ...channel,
    });
    return customerId;
  });
}

describe("THE PLACEMENT IS THE PROOF", () => {
  it("a publish with a URL is recorded live", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "live");
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    stubZernio(created("https://twitter.com/acme/status/999"));

    const res = await t.action(internal.maya.publish.publishPlacement, {
      customerId,
      snapshotText: "hello world",
      idempotencyKey: "idem_live",
    });
    expect(res.ok).toBe(true);

    const rows = (await t.run((ctx) =>
      ctx.db.query("placements").collect()
    )) as Doc<"placements">[];
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("https://twitter.com/acme/status/999");
    expect(rows[0].linkStatus).toBe("live");
  });

  it("⭐ NO URL MEANS `unknown`, NEVER `live` AND NEVER AN INVENTED URL", async () => {
    // The honest field. We have not seen this post, so we do not claim it is
    // there — and we certainly don't assemble a plausible URL from the post id.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "nourl");
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    stubZernio(created(null));

    await t.action(internal.maya.publish.publishPlacement, {
      customerId,
      snapshotText: "hello world",
      idempotencyKey: "idem_nourl",
    });

    const rows = (await t.run((ctx) =>
      ctx.db.query("placements").collect()
    )) as Doc<"placements">[];
    expect(rows[0].linkStatus).toBe("unknown");
    expect(rows[0].url).toBeUndefined();
  });

  it("THE PUBLISHED TEXT IS THE APPROVED TEXT", async () => {
    // The founder said yes to a specific string. Anything that re-generates or
    // re-formats between the yes and the post breaks that promise.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "snapshot");
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    const approved = "Paste a CSV. Get a dashboard. That's the whole product.";
    const calls = stubZernio(created("https://twitter.com/a/status/1"));

    await t.action(internal.maya.publish.publishPlacement, {
      customerId,
      snapshotText: approved,
      idempotencyKey: "idem_snap",
    });

    expect((zernioCalls(calls)[0].body as { content: string }).content).toBe(approved);
    const rows = (await t.run((ctx) =>
      ctx.db.query("placements").collect()
    )) as Doc<"placements">[];
    expect(rows[0].snapshotText).toBe(approved);
  });

  it("⭐ A RETRY DOES NOT MINT A SECOND PLACEMENT", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "retry");
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    stubZernio(created("https://twitter.com/a/status/1"));

    for (let i = 0; i < 3; i += 1) {
      await t.action(internal.maya.publish.publishPlacement, {
        customerId,
        snapshotText: "same text",
        idempotencyKey: "idem_same",
      });
    }

    const rows = (await t.run((ctx) =>
      ctx.db.query("placements").collect()
    )) as Doc<"placements">[];
    expect(rows).toHaveLength(1);
  });

  it("a disconnected channel is named, and nothing is posted", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "disc", {
      status: "disconnected",
      failureReason: "the founder revoked access",
    });
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    const calls = stubZernio(created(null));

    const res = await t.action(internal.maya.publish.publishPlacement, {
      customerId,
      snapshotText: "hello",
      idempotencyKey: "idem_disc",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/disconnected|revoked/i);
    expect(calls).toHaveLength(0);
  });

  it("A FAILED PUBLISH RECORDS NO PLACEMENT", async () => {
    // A placement is a claim that something is live. Writing one for a failed
    // publish would put a lie in the only table the founder is shown.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "failed");
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    stubZernio({ success: true });

    const res = await t.action(internal.maya.publish.publishPlacement, {
      customerId,
      snapshotText: "hello",
      idempotencyKey: "idem_failed",
    });
    expect(res.ok).toBe(false);

    const rows = await t.run((ctx) => ctx.db.query("placements").collect());
    expect(rows).toEqual([]);
  });
});

describe("MODEL REFS: DIRECT API vs OPENCLAW", () => {
  it("⭐ NO `openrouter/` PREFIX ON A DIRECT API CALL", async () => {
    // Two surfaces, opposite rules, two words apart:
    //   OpenClaw config     → openrouter/<vendor>/<model>   (provider prefix)
    //   OpenRouter REST API → <vendor>/<model>              (bare slug)
    // Getting it backwards names a model that doesn't exist. Both directions
    // of this bug shipped on 2026-08-04.
    const { SAFETY_CRITIC_MODEL } = await import("../outbound");
    const { PRODUCT_READ_MODEL } = await import("../productTruth");
    const { RELEVANCE_MODEL } = await import("../learnBusiness");
    for (const ref of [SAFETY_CRITIC_MODEL, PRODUCT_READ_MODEL, RELEVANCE_MODEL]) {
      expect(ref, `${ref} is for the REST API, not OpenClaw`).not.toMatch(
        /^openrouter\//
      );
      // Still a real vendor slug, not a bare model name.
      expect(ref).toMatch(/^[a-z0-9-]+\/[a-zA-Z0-9.\-_]+$/);
    }
  });
});

describe("⭐ COLD REPLY — commenting on someone else's post", () => {
  it("sends replyToTweetId, so the reply has a parent", async () => {
    // §5's "join conversations" rung. X is the ONLY channel we sell where this
    // is possible at all: TikTok has no comment API, Instagram is own-comments
    // only. Marked live-proven in the spec.
    const calls = stubZernio(created("https://twitter.com/a/status/2"));
    await publishText({ ...BASE, client: client(), inReplyTo: "1991719382071013376" });
    const body = zernioCalls(calls)[0].body as {
      platforms: Array<{ platformSpecificData?: { replyToTweetId?: string } }>;
    };
    expect(body.platforms[0].platformSpecificData?.replyToTweetId).toBe(
      "1991719382071013376"
    );
  });

  it("⭐ WITHOUT IT, A REPLY POSTS INTO THE VOID", () => {
    // The failure this guards is worse than an error because it SUCCEEDS:
    // "@someone — that's exactly the problem we fixed" goes out as a
    // standalone tweet with no parent, and reads as nonsense to everyone.
    // Threading was broken from the tool all the way to the vendor call: the
    // hook put inReplyTo in the job payload and the handler dropped it.
    const source = readFileSync(
      join(__dirname, "..", "..", "integrations", "zernio", "publish.ts"),
      "utf8"
    );
    expect(source).toMatch(/replyToTweetId/);
    expect(source).toMatch(/standalone tweet/i);
  });

  it("a plain post carries no platformSpecificData at all", async () => {
    const calls = stubZernio(created("https://twitter.com/a/status/1"));
    await publishText({ ...BASE, client: client() });
    const body = zernioCalls(calls)[0].body as {
      platforms: Array<{ platformSpecificData?: unknown }>;
    };
    expect(body.platforms[0].platformSpecificData).toBeUndefined();
  });

  it("a reply is recorded as a REPLY placement, not a post", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "coldreply");
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    stubZernio(created("https://twitter.com/a/status/2"));

    await t.action(internal.maya.publish.publishPlacement, {
      customerId,
      // No em-dash: it is a deterministic blocker on public posts. See the
      // punctuation test below, which pins that behaviour deliberately.
      snapshotText: "we hit this exact thing, here's what worked",
      idempotencyKey: "idem_cold",
      inReplyTo: "1991719382071013376",
    });

    const rows = (await t.run((ctx) =>
      ctx.db.query("placements").collect()
    )) as Doc<"placements">[];
    expect(rows[0].kind).toBe("reply");
  });

  /**
   * ⭐ An em-dash HOLDS a public post. Pinned because it is surprising.
   *
   * `aiPunctuationTells` is a *deterministic blocker*, not drift — so a post
   * carrying one never reaches the vendor, whatever the safety critic says.
   * The em-dash is the most recognisable AI tell there is, so blocking it is
   * defensible; what makes it worth a test is the consequence during a
   * seven-day run, where a held post looks the same as a quiet day.
   *
   * Note the asymmetry with DMs: `sanitizeOutboundText` REPAIRS punctuation
   * rather than bouncing the message, and its comment says so — "the private
   * DM path". Public posts get no such repair, because rewriting after
   * approval would break the snapshot guarantee the test above asserts. If
   * this is ever relaxed, the repair belongs at DRAFT time, not here.
   */
  it("⭐ AN EM-DASH HOLDS A PUBLIC POST, BEFORE THE CRITIC IS EVEN ASKED", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "emdash");
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    const calls = stubZernio(created("https://twitter.com/a/status/3"));

    const result = await t.action(internal.maya.publish.publishPlacement, {
      customerId,
      snapshotText: "we hit this exact thing — here's what worked",
      idempotencyKey: "idem_emdash",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/held/i);
    // Nothing reached Zernio, and no placement was recorded.
    expect(zernioCalls(calls)).toHaveLength(0);
    const rows = await t.run((ctx) => ctx.db.query("placements").collect());
    expect(rows).toHaveLength(0);
  });
});
