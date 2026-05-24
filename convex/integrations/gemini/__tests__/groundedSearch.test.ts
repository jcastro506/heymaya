/**
 * Sprint 2.0 — Gemini grounded search wrapper unit tests.
 *
 * Covers the 5 mandatory test categories from CLAUDE.md:
 *   1. happy path — grounded response → ResearchRawItem[] with excerpt + author
 *   2. empty response — no candidates / no chunks → empty_result
 *   3. HTTP error — 4xx/5xx surfaces as gemini_http_<status>
 *   4. network/timeout error — AbortError → gemini_timeout, other → gemini_error
 *   5. missing API key — gemini_key_missing soft status
 *   6. adversarial inputs — malformed JSON, chunks without uri, missing parts
 *
 * Plus Gemini-specific:
 *   - one chunk → one card; multiple chunks → multiple cards
 *   - groundingSupports.segment.text populates excerpt
 *   - absence of supports falls back to truncated full text
 *   - author field is the domain root, not the full URL
 *
 * No live network — fetch is fully mocked with vi.stubGlobal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geminiGroundedSearch } from "../groundedSearch";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

/** Stash + restore env vars so a failing test never leaks into siblings. */
const ORIGINAL_GEMINI = process.env.GEMINI_API_KEY;
const ORIGINAL_GOOGLE = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

function setApiKey(key: string | undefined): void {
  if (key === undefined) {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = key;
  }
}

function restoreEnv(): void {
  if (ORIGINAL_GEMINI === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_GEMINI;
  if (ORIGINAL_GOOGLE === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = ORIGINAL_GOOGLE;
}

describe("geminiGroundedSearch — missing API key", () => {
  afterEach(() => {
    restoreEnv();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns gemini_key_missing when neither env var is set, never calls fetch", async () => {
    setApiKey(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await geminiGroundedSearch("anything");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toBe("gemini_key_missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts GOOGLE_GENERATIVE_AI_API_KEY as fallback", async () => {
    setApiKey(undefined);
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "fallback-key";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: "ok" }] },
            groundingMetadata: {
              groundingChunks: [{ web: { uri: "https://example.test/a", title: "A" } }],
            },
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await geminiGroundedSearch("fallback");
    expect(res.statusDetail).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("geminiGroundedSearch — happy path", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    setApiKey("test-key");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    restoreEnv();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("one grounded chunk → one ResearchRawItem card", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: "Some summary text from Gemini." }] },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: "https://www.example.com/post", title: "Example Post" } },
              ],
              groundingSupports: [
                {
                  segment: { text: "key cited fact about the topic" },
                  groundingChunkIndices: [0],
                },
              ],
            },
          },
        ],
      })
    );

    const res = await geminiGroundedSearch("growth tactics");
    expect(res.statusDetail).toBe("ok");
    expect(res.items).toHaveLength(1);

    const card = res.items[0]!;
    expect(card.platform).toBe("google");
    expect(card.externalId).toBe("https://www.example.com/post");
    expect(card.url).toBe("https://www.example.com/post");
    expect(card.title).toBe("Example Post");
    // groundingSupports.segment.text becomes the excerpt
    expect(card.excerpt).toBe("key cited fact about the topic");
    // domain root (www. stripped), NOT the full URL
    expect(card.author).toBe("example.com");
    expect(card.createdAtMs).toBeNull();
    expect(card.tags).toContain("google:grounded");
    expect(card.rawRef).toMatch(/^google:gemini-grounded:/);
  });

  it("multiple chunks → multiple cards, each with its own support segment", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: "combined long summary..." }] },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: "https://a.test/", title: "Site A" } },
                { web: { uri: "https://b.test/", title: "Site B" } },
                { web: { uri: "https://c.test/", title: "Site C" } },
              ],
              groundingSupports: [
                { segment: { text: "fact A" }, groundingChunkIndices: [0] },
                { segment: { text: "fact B1" }, groundingChunkIndices: [1] },
                { segment: { text: "fact B2" }, groundingChunkIndices: [1] },
                // no support for chunk index 2 → fallback path
              ],
            },
          },
        ],
      })
    );

    const res = await geminiGroundedSearch("multi");
    expect(res.statusDetail).toBe("ok");
    expect(res.items).toHaveLength(3);
    expect(res.items[0]!.excerpt).toBe("fact A");
    // Two segments for the same chunk get joined with " … "
    expect(res.items[1]!.excerpt).toBe("fact B1 … fact B2");
    // Chunk with no support falls back to truncated full text.
    expect(res.items[2]!.excerpt).toBe("combined long summary...");
  });

  it("absent groundingSupports falls back to truncated full text on every chunk", async () => {
    const longText = "x".repeat(2000);
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: longText }] },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: "https://only.test/", title: "Only" } },
              ],
              // no groundingSupports key
            },
          },
        ],
      })
    );

    const res = await geminiGroundedSearch("fallback");
    expect(res.items).toHaveLength(1);
    // Falls back to fullText.slice(0, 800)
    expect(res.items[0]!.excerpt).toHaveLength(800);
  });

  it("author field is domain root with www. stripped, not the full URL", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: "t" }] },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: "https://www.nytimes.com/2026/01/01/tech/article.html", title: "NYT" } },
                { web: { uri: "https://substack.example.io/p/foo", title: "Sub" } },
              ],
            },
          },
        ],
      })
    );

    const res = await geminiGroundedSearch("authors");
    expect(res.items[0]!.author).toBe("nytimes.com");
    expect(res.items[1]!.author).toBe("substack.example.io");
    // author is the domain — NOT the full URL.
    expect(res.items[0]!.author).not.toBe(res.items[0]!.url);
  });
});

describe("geminiGroundedSearch — empty / error paths", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    setApiKey("test-key");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    restoreEnv();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("no candidates → empty_result, items []", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ candidates: [] }));
    const res = await geminiGroundedSearch("nothing");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toBe("empty_result");
  });

  it("candidate with no groundingChunks → empty_result", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: "ungrounded answer" }] },
            groundingMetadata: {},
          },
        ],
      })
    );
    const res = await geminiGroundedSearch("ungrounded");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toBe("empty_result");
  });

  it("HTTP 500 → items [] with gemini_http_500 statusDetail", async () => {
    fetchMock.mockResolvedValue(textResponse("internal server error", 500));
    const res = await geminiGroundedSearch("boom");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toMatch(/^gemini_http_500/);
    expect(res.statusDetail).toContain("internal server error");
  });

  it("HTTP 429 → items [] with gemini_http_429 statusDetail", async () => {
    fetchMock.mockResolvedValue(textResponse("quota exhausted", 429));
    const res = await geminiGroundedSearch("rate");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toMatch(/^gemini_http_429/);
  });

  it("AbortError → items [] with gemini_timeout statusDetail", async () => {
    fetchMock.mockImplementation(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const res = await geminiGroundedSearch("slow");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toBe("gemini_timeout");
  });

  it("generic network error → items [] with gemini_error:<msg> statusDetail", async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error("ECONNRESET");
    });
    const res = await geminiGroundedSearch("nope");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toMatch(/^gemini_error:ECONNRESET/);
  });
});

describe("geminiGroundedSearch — adversarial inputs", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    setApiKey("test-key");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    restoreEnv();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("malformed JSON body → gemini_error, no throw", async () => {
    fetchMock.mockResolvedValue(
      new Response("not json {{{ <<", { status: 200 })
    );
    const res = await geminiGroundedSearch("badjson");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toMatch(/^gemini_error:/);
  });

  it("chunk without uri is skipped without throwing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: "t" }] },
            groundingMetadata: {
              groundingChunks: [
                { web: { title: "no uri" } }, // dropped
                { web: { uri: "https://ok.test/", title: "ok" } }, // kept
                {}, // no web at all → dropped
              ],
            },
          },
        ],
      })
    );
    const res = await geminiGroundedSearch("partial");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.url).toBe("https://ok.test/");
  });

  it("missing content.parts entirely → still emits cards with null/empty excerpt fallback", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            // no content key
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: "https://only.test/", title: "Only" } },
              ],
            },
          },
        ],
      })
    );
    const res = await geminiGroundedSearch("noparts");
    expect(res.items).toHaveLength(1);
    // fullText is empty → fallback is `null` (per `fullText.slice(0,800) || null`)
    expect(res.items[0]!.excerpt).toBeNull();
  });

  it("chunk with malformed URI still produces a card (URL is recorded verbatim, author null)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: "t" }] },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: "not a real url", title: "Garbled" } },
              ],
            },
          },
        ],
      })
    );
    const res = await geminiGroundedSearch("malformed uri");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.url).toBe("not a real url");
    // domainOf catches the URL parse error and returns null.
    expect(res.items[0]!.author).toBeNull();
  });
});

describe("geminiGroundedSearch — request shape", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    setApiKey("test-key-abc");
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ candidates: [] }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    restoreEnv();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hits the configured model endpoint with the api key in the query string", async () => {
    await geminiGroundedSearch("q1", { model: "gemini-2.5-pro" });
    const call = fetchMock.mock.calls[0]!;
    const url = String(call[0]);
    expect(url).toContain("/v1beta/models/gemini-2.5-pro:generateContent");
    expect(url).toContain("key=test-key-abc");
  });

  it("defaults to gemini-2.5-flash when no model option given", async () => {
    await geminiGroundedSearch("q2");
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/models/gemini-2.5-flash:generateContent");
  });

  it("sends google_search tool and the query embedded in the prompt", async () => {
    await geminiGroundedSearch("solar punk trends");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.contents[0].parts[0].text).toContain("solar punk trends");
  });
});
