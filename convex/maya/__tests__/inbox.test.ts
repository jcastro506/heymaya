/**
 * The other half of the product.
 *
 * "Posts it, **and answers everyone who replies**." The `reply` tool has
 * refused without an `inReplyTo` since Sprint 3, telling her to *"find it and
 * call again"* — and until this module there was nothing to find it with.
 *
 * What these tests mostly guard is the way an inbox quietly stops being one:
 * re-answering people, losing them when a publish fails, or reporting "all
 * clear" over a page it never read.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { MAX_PAGES, LOOKBACK_MS } from "../inbox";
import type { Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 5, 14, 0, 0);
const HOUR = 3_600_000;

describe("⭐ NOBODY GETS ANSWERED TWICE", () => {
  it("the same comment seen again is not new", async () => {
    // The sweep runs 3×/day and re-fetches the same window every time.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const first = await add(t, customerId, "c_1");
    const second = await add(t, customerId, "c_1");
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.itemId).toBe(first.itemId);
  });

  it("⭐ RE-SEEING AN ANSWERED COMMENT DOES NOT REOPEN IT", async () => {
    // The one that would be invisible until it wasn't: if a sync resurrected
    // everything it re-fetched, she would answer the same person every eight
    // hours, forever, and each reply would look correct in isolation.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const { itemId } = await add(t, customerId, "c_1");
    await t.mutation(internal.maya.inbox.resolve, {
      itemId,
      status: "answered",
      now: NOW,
    });
    await add(t, customerId, "c_1");
    const open = await t.query(internal.maya.inbox.open, { customerId });
    expect(open).toHaveLength(0);
  });

  it("a skip needs a reason — silence and a decision must not look alike", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const { itemId } = await add(t, customerId, "c_1");
    const bad = await t.mutation(internal.maya.inbox.resolve, {
      itemId,
      status: "skipped",
    });
    expect(bad.ok).toBe(false);
    expect(bad.why).toMatch(/reason/);

    const good = await t.mutation(internal.maya.inbox.resolve, {
      itemId,
      status: "skipped",
      skipReason: "spam",
    });
    expect(good.ok).toBe(true);
  });
});

describe("⭐ OLDEST FIRST", () => {
  it("whoever has waited longest comes first", async () => {
    // Newest-first quietly abandons the tail every time volume rises — and
    // the person who has waited two days is the one most likely to give up.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await add(t, customerId, "new", { postedAt: NOW - HOUR });
    await add(t, customerId, "old", { postedAt: NOW - 48 * HOUR });
    await add(t, customerId, "mid", { postedAt: NOW - 12 * HOUR });
    const open = await t.query(internal.maya.inbox.open, { customerId });
    expect(open.map((i) => i.externalId)).toEqual(["old", "mid", "new"]);
  });

  it("answered items leave the queue", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const a = await add(t, customerId, "a");
    await add(t, customerId, "b");
    await t.mutation(internal.maya.inbox.resolve, {
      itemId: a.itemId,
      status: "answered",
    });
    const open = await t.query(internal.maya.inbox.open, { customerId });
    expect(open.map((i) => i.externalId)).toEqual(["b"]);
  });
});

describe("⭐ HONEST ABOUT WHAT IT COULDN'T READ", () => {
  it("no key is a named failure, not an empty inbox", async () => {
    // An empty result and "I couldn't look" are the same shape and opposite
    // meanings. Reporting the first when the second is true is how she tells
    // a founder nobody replied while people are waiting.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const prev = process.env.ZERNIO_API_KEY;
    delete process.env.ZERNIO_API_KEY;
    try {
      const r = await t.action(internal.maya.inbox.sync, { customerId, now: NOW });
      expect(r.ok).toBe(false);
      expect(r.detail).toMatch(/aren't connected/);
      // And it says it in plain language — no vendor name.
      expect(r.detail).not.toMatch(/zernio/i);
    } finally {
      if (prev !== undefined) process.env.ZERNIO_API_KEY = prev;
    }
  });

  it("⭐ ZERO ACCOUNTS QUERIED IS NOT AN EMPTY INBOX", async () => {
    /**
     * Live 2026-08-05: `/inbox/comments` returned `accountsQueried: 0` against
     * one healthy connected X account, while `/inbox/conversations` returned
     * `1` on the same pass. The sync reported "0 new" — which reads as "nobody
     * replied" when the truth was "I didn't look at anything".
     *
     * For a product whose job is *answer everyone*, those must never produce
     * the same output.
     */
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const realFetch = globalThis.fetch;
    const prevKey = process.env.ZERNIO_API_KEY;
    process.env.ZERNIO_API_KEY = "test-key";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/inbox/comments")) {
        return new Response(
          JSON.stringify({
            data: [],
            pagination: { hasMore: false, nextCursor: null },
            meta: { accountsQueried: 0, accountsFailed: 0, failedAccounts: [] },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const result = await t.action(internal.maya.inbox.sync, { customerId, now: NOW });
      // It must NOT look like a clean, empty inbox.
      expect(result.unreadableAccounts).toContain("comments on your posts");
      expect(result.detail).toMatch(/couldn't read/i);
    } finally {
      globalThis.fetch = realFetch;
      if (prevKey === undefined) delete process.env.ZERNIO_API_KEY;
      else process.env.ZERNIO_API_KEY = prevKey;
    }
  });

  it("⭐ HER OWN POSTS ARE NEVER RECORDED AS INBOUND", async () => {
    /**
     * `/inbox/comments` returns the WORK QUEUE — posts of ours that may have
     * comments — not comments. Read off a live response 2026-08-05, where a
     * YouTube row came back as `{ content: "Sensocore release 2",
     * accountUsername: "joshuacastro7418", commentCount: 0 }`: the video
     * TITLE, on OUR account.
     *
     * Recorded as inbound, she would have replied to the founder's own posts.
     */
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const realFetch = globalThis.fetch;
    const prevKey = process.env.ZERNIO_API_KEY;
    process.env.ZERNIO_API_KEY = "test-key";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/inbox/comments")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "GtO7pd2o5BM",
                platform: "youtube",
                accountUsername: "joshuacastro7418",
                content: "Sensocore release 2",
                permalink: "https://www.youtube.com/watch?v=GtO7pd2o5BM",
                createdTime: "2026-05-23T21:03:19.000Z",
                commentCount: 0,
                likeCount: 1,
              },
            ],
            pagination: { hasMore: false, nextCursor: null },
            meta: { accountsQueried: 1, accountsFailed: 0, failedAccounts: [] },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await t.action(internal.maya.inbox.sync, { customerId, now: NOW });
      const open = await t.query(internal.maya.inbox.open, { customerId });
      expect(open).toHaveLength(0);
    } finally {
      globalThis.fetch = realFetch;
      if (prevKey === undefined) delete process.env.ZERNIO_API_KEY;
      else process.env.ZERNIO_API_KEY = prevKey;
    }
  });

  it("⭐ A REAL COMMENT ON OUR POST IS RECORDED — via the SECOND call", async () => {
    /**
     * The two-call flow, verified live 2026-08-05:
     *
     *   /inbox/comments?platform=X            → the work queue (posts)
     *   /inbox/comments/{postId}?platform&... → the comments people left
     *
     * The obvious single-call paths (`/comments`, `/posts/{id}/comments`) all
     * return an HTML page with **HTTP 200** — the worst possible 404, and what
     * `igListComments` has always pointed at.
     */
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const realFetch = globalThis.fetch;
    const prevKey = process.env.ZERNIO_API_KEY;
    process.env.ZERNIO_API_KEY = "test-key";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (o: unknown) =>
        new Response(JSON.stringify(o), {
          status: 200,
          headers: { "content-type": "application/json" },
        });

      if (/\/inbox\/comments\/[^?]+/.test(url)) {
        return json({
          status: "success",
          comments: [
            {
              id: "cmt_1",
              content: "does this work with Stripe?",
              createdTime: "2026-08-05T10:00:00.000Z",
              from: { username: "a_real_person" },
            },
            // Our own reply in the same thread — must NOT come back as inbound.
            {
              id: "cmt_2",
              content: "thanks for asking!",
              createdTime: "2026-08-05T11:00:00.000Z",
              from: { username: "joshuacastro7418" },
            },
          ],
          pagination: { hasMore: false },
        });
      }
      if (url.includes("/inbox/comments")) {
        return json({
          data: [
            {
              id: "vid_1",
              platform: "youtube",
              accountId: "acct_1",
              accountUsername: "joshuacastro7418",
              content: "Sensocore release 2",
              permalink: "https://www.youtube.com/watch?v=vid_1",
              createdTime: "2026-08-04T21:03:19.000Z",
              commentCount: 2,
            },
          ],
          pagination: { hasMore: false, nextCursor: null },
          meta: { accountsQueried: 1, accountsFailed: 0, failedAccounts: [] },
        });
      }
      return json({});
    }) as typeof fetch;

    try {
      await t.action(internal.maya.inbox.sync, { customerId, now: NOW });
      const open = await t.query(internal.maya.inbox.open, { customerId });
      // Exactly one: the stranger's question. Not the video title, not our own reply.
      expect(open).toHaveLength(1);
      expect(open[0].text).toMatch(/Stripe/);
      expect(open[0].authorHandle).toBe("a_real_person");
      expect(open[0].text).not.toMatch(/Sensocore/);
    } finally {
      globalThis.fetch = realFetch;
      if (prevKey === undefined) delete process.env.ZERNIO_API_KEY;
      else process.env.ZERNIO_API_KEY = prevKey;
    }
  });

  it("the page cap is real and bounded", () => {
    // "Answer everyone" against an unbounded inbox is how a sync becomes a
    // runaway bill — but a silent stop at page 10 reports all-clear while
    // page 11 has someone asking to buy, so `truncated` carries it out.
    expect(MAX_PAGES).toBeGreaterThan(1);
    expect(MAX_PAGES).toBeLessThanOrEqual(20);
  });

  it("the cold-start lookback is a week", () => {
    expect(LOOKBACK_MS).toBe(7 * 86_400_000);
  });
});

/**
 * ⭐ X, read directly via twitterapi.io.
 *
 * All five of its wrappers had zero callers. Shape verified live 2026-08-05
 * against a busy account, because the account under test has no mentions and
 * an empty array teaches nothing.
 */
describe("⭐ X MENTIONS", () => {
  it("⭐ TWITTER'S LEGACY DATE FORMAT PARSES EXACTLY", () => {
    // "Wed Aug 05 19:56:13 +0000 2026" — not ISO, and not interchangeable with
    // Instagram's ISO strings or TikTok's unix SECONDS. Assuming one parser
    // fits all is the bug that once made every post fifty years old, so this
    // is checked against a hand-built timestamp rather than trusted.
    expect(Date.parse("Wed Aug 05 19:56:13 +0000 2026")).toBe(
      Date.UTC(2026, 7, 5, 19, 56, 13)
    );
  });

  it("an X item is namespaced so it can't collide with a Zernio comment", async () => {
    // Two vendors, two id spaces, one table. `x:<id>` keeps them apart.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.inbox.record, {
      customerId,
      externalId: "x:2085092531566518538",
      channel: "x",
      authorHandle: "mktpavlenko",
      text: "@heymaya does this work with Stripe?",
      postedAt: NOW - HOUR,
      now: NOW,
    });
    const [item] = await t.query(internal.maya.inbox.open, { customerId });
    expect(item.externalId).toMatch(/^x:/);
    // ⭐ X carries the author — the one thing Zernio's comment shape does not,
    // and the only reason her own tweets can be filtered out of a mentions feed.
    expect(item.authorHandle).toBe("mktpavlenko");
  });
});

describe("⭐ REPLYING OFF X", () => {
  it("⭐ AN X ITEM IS REFUSED HERE — it goes through publish", async () => {
    // The publish path threads `platformSpecificData.replyToTweetId`, which is
    // X-only. Two routes, and sending one down the other publishes something,
    // somewhere, wrong.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const { itemId } = await add(t, customerId, "x:1");
    const r = await t.action(internal.maya.inbox.replyOnChannel, {
      customerId,
      itemId,
      message: "hi",
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/publish path/);
  });

  it("⭐ READABLE BUT UNANSWERABLE IS SAID OUT LOUD", async () => {
    // An item ingested before parentPostId/zernioAccountId were stored can be
    // read and not answered. Silence there leaves a founder watching a
    // question sit unanswered with no idea why.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const itemId = await t.run(async (ctx) =>
      ctx.db.insert("inboxItems", {
        customerId,
        externalId: "youtube:c1",
        channel: "youtube",
        text: "does this work with Stripe?",
        postedAt: NOW - HOUR,
        firstSeenAt: NOW,
        status: "open",
      })
    );
    const r = await t.action(internal.maya.inbox.replyOnChannel, {
      customerId,
      itemId,
      message: "yes",
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/can't reply/i);
    // And it stays open, so it is not silently lost.
    expect(await t.query(internal.maya.inbox.open, { customerId })).toHaveLength(1);
  });

  it("an already-answered item is not answered twice", async () => {
    // Idempotent by state: a retry after a timeout must not comment twice on
    // a stranger's post.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const itemId = await t.run(async (ctx) =>
      ctx.db.insert("inboxItems", {
        customerId,
        externalId: "youtube:c2",
        channel: "youtube",
        text: "hi",
        postedAt: NOW - HOUR,
        firstSeenAt: NOW,
        status: "answered",
        parentPostId: "vid_1",
        zernioAccountId: "acct_1",
      })
    );
    const r = await t.action(internal.maya.inbox.replyOnChannel, {
      customerId,
      itemId,
      message: "hi",
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/already handled/);
  });

  it("⭐ ANOTHER TENANT'S ITEM NEVER RESOLVES", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "ra");
    const b = await seed(t, "rb");
    const itemId = await t.run(async (ctx) =>
      ctx.db.insert("inboxItems", {
        customerId: a,
        externalId: "youtube:c3",
        channel: "youtube",
        text: "hi",
        postedAt: NOW - HOUR,
        firstSeenAt: NOW,
        status: "open",
        parentPostId: "vid_1",
        zernioAccountId: "acct_1",
      })
    );
    const r = await t.action(internal.maya.inbox.replyOnChannel, {
      customerId: b,
      itemId,
      message: "hi",
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/can't find/i);
  });
});

describe("⭐ CROSS-TENANT", () => {
  it("the same platform comment id in two tenants is two items", async () => {
    // Platform ids are the platform's, not ours. Deduping globally would let
    // one founder's inbox suppress another's.
    const t = convexTest(schema, modules);
    const a = await seed(t, "a");
    const b = await seed(t, "b");
    const ra = await add(t, a, "shared_id");
    const rb = await add(t, b, "shared_id");
    expect(rb.isNew).toBe(true);
    expect(rb.itemId).not.toBe(ra.itemId);

    const openA = await t.query(internal.maya.inbox.open, { customerId: a });
    expect(openA).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */

async function add(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  externalId: string,
  over: { postedAt?: number } = {}
) {
  return await t.mutation(internal.maya.inbox.record, {
    customerId,
    externalId,
    channel: "x",
    text: "does this work with Stripe?",
    postedAt: over.postedAt ?? NOW - HOUR,
    now: NOW,
  });
}

async function seed(
  t: ReturnType<typeof convexTest>,
  tag = "inbox"
): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${tag}`,
      email: `${tag}@example.com`,
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
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}
