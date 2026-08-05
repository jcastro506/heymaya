/**
 * twitterapi.io endpoint wrappers.
 *
 * These assert PARAMETER NAMES and PAGINATION SHAPE specifically, because
 * those are the two things this codebase has already got wrong against live
 * vendors: five of ten ScrapeCreators params were wrong in the docs, and the
 * Zernio inbox read `nextCursor` at the root when it was nested inside
 * `pagination` — so paging never advanced.
 *
 * twitterapi.io adds its own trap: the QUERY is camelCase (`userName`,
 * `tweetId`) while the BODY is snake_case (`next_cursor`, `has_next_page`).
 * Same request, two conventions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFollowers,
  getMentions,
  getTrends,
  getTweetReplies,
  getUserInfo,
  toPage,
} from "../endpoints";

const ORIGINAL_KEY = process.env.TWITTERAPI_IO_KEY;

function mockFetch(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.TWITTERAPI_IO_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) delete process.env.TWITTERAPI_IO_KEY;
  else process.env.TWITTERAPI_IO_KEY = ORIGINAL_KEY;
});

describe("parameter names — camelCase, verified live", () => {
  it("getMentions sends userName, not user_name or handle", async () => {
    const fetchMock = mockFetch({ tweets: [], has_next_page: false });
    await getMentions("HeyMaya751997");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/twitter/user/mentions");
    expect(url).toContain("userName=HeyMaya751997");
    expect(url).not.toContain("user_name");
    expect(url).not.toContain("handle=");
  });

  it("getTweetReplies sends tweetId, not tweet_id or id", async () => {
    const fetchMock = mockFetch({ tweets: [] });
    await getTweetReplies("1234");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("tweetId=1234");
    expect(url).not.toContain("tweet_id");
  });

  it("getFollowers sends userName and reads the `followers` key", async () => {
    const fetchMock = mockFetch({ followers: [{ userName: "a" }] });
    const page = await getFollowers("HeyMaya751997");
    expect(String(fetchMock.mock.calls[0][0])).toContain("userName=");
    expect(page.items).toHaveLength(1);
  });

  it("getTrends defaults woeid to 1 (worldwide), not a country code", async () => {
    const fetchMock = mockFetch({ trends: [{ name: "#x" }] });
    const out = await getTrends();
    expect(String(fetchMock.mock.calls[0][0])).toContain("woeid=1");
    expect(out.trends).toHaveLength(1);
  });

  it("the API key rides in a header, never the query string", async () => {
    const fetchMock = mockFetch({ tweets: [] });
    await getMentions("x");
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["X-API-Key"]).toBe("test-key");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("test-key");
  });
});

describe("pagination — snake_case in the body", () => {
  it("reads next_cursor and has_next_page, not camelCase equivalents", async () => {
    // The query is camelCase and the body is snake_case. Getting this backwards
    // is exactly how the Zernio inbox ended up paging nowhere.
    mockFetch({
      tweets: [{ id: "1" }],
      has_next_page: true,
      next_cursor: "cur_2",
    });
    const page = await getMentions("x");
    expect(page.nextCursor).toBe("cur_2");
    expect(page.hasMore).toBe(true);
  });

  it("a final page reports hasMore false and a null cursor", async () => {
    mockFetch({ tweets: [{ id: "1" }], has_next_page: false });
    const page = await getMentions("x");
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("passes a cursor back when paging", async () => {
    const fetchMock = mockFetch({ tweets: [] });
    await getMentions("x", "cur_5");
    expect(String(fetchMock.mock.calls[0][0])).toContain("cursor=cur_5");
  });

  it("omits the cursor entirely on the first page", async () => {
    const fetchMock = mockFetch({ tweets: [] });
    await getMentions("x");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("cursor=");
  });
});

describe("degradation — empty page with a reason, never a throw", () => {
  it("a missing key names itself rather than exploding", async () => {
    // A perception sweep that throws takes down the whole run for one flaky
    // vendor.
    delete process.env.TWITTERAPI_IO_KEY;
    const page = await getMentions("x");
    expect(page.items).toEqual([]);
    expect(page.statusDetail).toBe("twitterapi_io_key_missing");
  });

  it("an HTTP error is named with its status", async () => {
    mockFetch({ error: "nope" }, false, 429);
    const page = await getMentions("x");
    expect(page.items).toEqual([]);
    expect(page.statusDetail).toMatch(/^twitterapi_io_http_429/);
  });

  it("a thrown network error is caught and named", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("socket hang up"))
    );
    const page = await getMentions("x");
    expect(page.statusDetail).toMatch(/twitterapi_io_error:socket hang up/);
  });

  it("getUserInfo degrades to null data rather than throwing", async () => {
    delete process.env.TWITTERAPI_IO_KEY;
    const out = await getUserInfo("x");
    expect(out.data).toBeNull();
    expect(out.statusDetail).toBe("twitterapi_io_key_missing");
  });

  it("getTrends degrades to an empty list", async () => {
    delete process.env.TWITTERAPI_IO_KEY;
    expect((await getTrends()).trends).toEqual([]);
  });
});

describe("toPage", () => {
  it("a missing items key yields an empty page, not undefined", async () => {
    const page = toPage({ status: "ok" }, "tweets");
    expect(page.items).toEqual([]);
  });

  it("a non-array payload doesn't become items", () => {
    const page = toPage({ tweets: "not an array" }, "tweets");
    expect(page.items).toEqual([]);
  });

  it("getUserInfo reads `data`, which is an object rather than a collection", async () => {
    mockFetch({ status: "success", data: { userName: "dana" } });
    const out = await getUserInfo("dana");
    expect(out.data?.userName).toBe("dana");
  });
});
