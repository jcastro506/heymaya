/**
 * Sprint 2.0 — Hacker News Algolia search wrapper unit tests.
 *
 * Covers the 5 mandatory test categories from CLAUDE.md:
 *   1. happy path — realistic Algolia response normalizes into ResearchRawItem[]
 *   2. empty response — empty_result soft status
 *   3. HTTP error — 500/429 surfaces as algolia_hn_http_<status>
 *   4. network/timeout error — AbortError → algolia_hn_timeout, other → algolia_hn_error
 *   5. adversarial inputs — malformed JSON, missing fields, bad URL
 *
 * Plus HN-specific:
 *   - `tag` option lands in the `tags` query param
 *   - `withinDays` + `minPoints` compose into `numericFilters`
 *   - `sort: "date"` hits /search_by_date
 *
 * No live network — fetch is fully mocked with vi.stubGlobal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hackerNewsSearch } from "../algoliaSearch";

type FetchMock = ReturnType<typeof vi.fn>;

/** Build a fake Response that the wrapper can `.json()` / `.text()`. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

/** Capture the URL the wrapper hit so we can assert on query-string params. */
function captureUrls(): { urls: string[]; impl: (input: string | URL | Request) => Response } {
  const urls: string[] = [];
  const impl = (input: string | URL | Request): Response => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    urls.push(u);
    return jsonResponse({ hits: [] });
  };
  return { urls, impl };
}

describe("hackerNewsSearch — happy path", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes a realistic Algolia hits array", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        hits: [
          {
            objectID: "39000001",
            title: "Show HN: I built an AI manager for creators",
            url: "https://example.com/show",
            author: "indie_jane",
            points: 142,
            num_comments: 38,
            created_at_i: 1_700_000_000,
            _tags: ["story", "show_hn"],
          },
          {
            objectID: "39000002",
            // No title — story_title fallback path.
            story_title: "Ask HN: best growth tools?",
            // No url — falls back to news.ycombinator.com/item?id=...
            story_text: "I'm <b>shipping</b> soon &amp; need advice.",
            author: "founder42",
            points: 25,
            num_comments: 8,
            created_at_i: 1_700_001_000,
            _tags: ["story", "ask_hn"],
          },
        ],
      })
    );

    const res = await hackerNewsSearch("ai manager");
    expect(res.statusDetail).toBe("ok");
    expect(res.items).toHaveLength(2);

    const a = res.items[0]!;
    expect(a.platform).toBe("google");
    expect(a.externalId).toBe("39000001");
    expect(a.url).toBe("https://example.com/show");
    expect(a.title).toContain("Show HN");
    expect(a.author).toBe("indie_jane");
    expect(a.engagement.likes).toBe(142);
    expect(a.engagement.upvotes).toBe(142);
    expect(a.engagement.comments).toBe(38);
    expect(a.createdAtMs).toBe(1_700_000_000 * 1000);
    expect(a.tags).toContain("hn:true");
    expect(a.tags).toContain("hn:show_hn");
    expect(a.rawRef).toMatch(/^google:hn-algolia:/);

    const b = res.items[1]!;
    // story_title fallback
    expect(b.title).toContain("Ask HN");
    // url fallback to news.ycombinator.com when hit.url absent
    expect(b.url).toBe("https://news.ycombinator.com/item?id=39000002");
    // HTML-stripped excerpt
    expect(b.excerpt).toBe("I'm shipping soon & need advice.");
    expect(b.tags).toContain("hn:ask_hn");
  });
});

describe("hackerNewsSearch — empty / error paths", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("empty hits → statusDetail empty_result, items []", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ hits: [] }));
    const res = await hackerNewsSearch("zero hits");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toBe("empty_result");
  });

  it("missing hits key altogether → still empty_result, no throw", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ nbHits: 0 }));
    const res = await hackerNewsSearch("missing key");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toBe("empty_result");
  });

  it("HTTP 500 → items [] with algolia_hn_http_500 statusDetail", async () => {
    fetchMock.mockResolvedValue(textResponse("upstream blew up", 500));
    const res = await hackerNewsSearch("server boom");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toMatch(/^algolia_hn_http_500/);
    expect(res.statusDetail).toContain("upstream blew up");
  });

  it("HTTP 429 → items [] with algolia_hn_http_429 statusDetail", async () => {
    fetchMock.mockResolvedValue(textResponse("rate limited", 429));
    const res = await hackerNewsSearch("rate limit");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toMatch(/^algolia_hn_http_429/);
  });

  it("AbortError → items [] with algolia_hn_timeout statusDetail", async () => {
    fetchMock.mockImplementation(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const res = await hackerNewsSearch("slow");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toBe("algolia_hn_timeout");
  });

  it("generic network error → items [] with algolia_hn_error:<msg> statusDetail", async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error("ECONNREFUSED");
    });
    const res = await hackerNewsSearch("nope");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toMatch(/^algolia_hn_error:ECONNREFUSED/);
  });
});

describe("hackerNewsSearch — adversarial inputs", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("malformed JSON body → graceful error statusDetail, no throw", async () => {
    fetchMock.mockResolvedValue(
      new Response("<!doctype html><html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );
    const res = await hackerNewsSearch("html instead");
    expect(res.items).toEqual([]);
    // JSON.parse fails → caught in catch → algolia_hn_error:<msg>
    expect(res.statusDetail).toMatch(/^algolia_hn_error:/);
  });

  it("skips hits missing objectID without throwing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        hits: [
          { title: "no id", url: "https://example.test/a" }, // dropped
          { objectID: "ok1", title: "kept" }, // kept
        ],
      })
    );
    const res = await hackerNewsSearch("mixed");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.externalId).toBe("ok1");
  });

  it("skips hits with no title AND no excerpt-source text", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        hits: [
          { objectID: "barren" }, // no title, no story_title, no comment_text, no story_text → drop
          { objectID: "ok2", title: "fine" }, // kept
        ],
      })
    );
    const res = await hackerNewsSearch("barren");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.externalId).toBe("ok2");
  });
});

describe("hackerNewsSearch — query-string options", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("passes tag option through as `tags` URL param", async () => {
    const { urls, impl } = captureUrls();
    vi.stubGlobal("fetch", vi.fn(impl));
    await hackerNewsSearch("ai", { tag: "show_hn" });
    await hackerNewsSearch("ai", { tag: "ask_hn" });
    expect(urls[0]).toContain("tags=show_hn");
    expect(urls[1]).toContain("tags=ask_hn");
  });

  it("composes withinDays + minPoints into numericFilters", async () => {
    const fakeNow = 1_700_500_000_000;
    vi.spyOn(Date, "now").mockReturnValue(fakeNow);
    const { urls, impl } = captureUrls();
    vi.stubGlobal("fetch", vi.fn(impl));
    await hackerNewsSearch("growth", { withinDays: 7, minPoints: 10 });
    const url = urls[0]!;
    const parsed = new URL(url);
    const nf = parsed.searchParams.get("numericFilters");
    expect(nf).not.toBeNull();
    const cutoff = Math.floor(fakeNow / 1000) - 7 * 86_400;
    expect(nf).toContain(`created_at_i>=${cutoff}`);
    expect(nf).toContain("points>=10");
  });

  it("omits numericFilters when neither withinDays nor minPoints provided", async () => {
    const { urls, impl } = captureUrls();
    vi.stubGlobal("fetch", vi.fn(impl));
    await hackerNewsSearch("plain");
    const parsed = new URL(urls[0]!);
    expect(parsed.searchParams.get("numericFilters")).toBeNull();
  });

  it("sort: 'date' hits /search_by_date, default sort hits /search", async () => {
    const { urls, impl } = captureUrls();
    vi.stubGlobal("fetch", vi.fn(impl));
    await hackerNewsSearch("default sort");
    await hackerNewsSearch("date sort", { sort: "date" });
    expect(urls[0]).toContain("/search?");
    expect(urls[0]).not.toContain("/search_by_date");
    expect(urls[1]).toContain("/search_by_date?");
  });

  it("clamps hitsPerPage to 1..100", async () => {
    const { urls, impl } = captureUrls();
    vi.stubGlobal("fetch", vi.fn(impl));
    await hackerNewsSearch("too low", { hitsPerPage: 0 });
    await hackerNewsSearch("too high", { hitsPerPage: 999 });
    expect(new URL(urls[0]!).searchParams.get("hitsPerPage")).toBe("1");
    expect(new URL(urls[1]!).searchParams.get("hitsPerPage")).toBe("100");
  });
});
