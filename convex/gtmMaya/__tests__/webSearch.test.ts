/**
 * Sprint 1 (top-tier) — `search_web` tested OFFLINE (mocked Gemini grounded API).
 *
 * Covers: success shaping (url/title/excerpt/domain from grounding metadata),
 * the limit cap, empty-query guard, graceful HTTP-error degradation, and
 * graceful missing-key degradation. No deploy, no real Gemini call.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

function geminiResponse(
  chunks: Array<{ uri: string; title?: string }>,
  supports: Array<{ text: string; chunkIdx: number }> = [],
  fullText = "summary of findings"
): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: fullText }] },
          groundingMetadata: {
            groundingChunks: chunks.map((c) => ({ web: { uri: c.uri, title: c.title } })),
            groundingSupports: supports.map((s) => ({
              segment: { text: s.text },
              groundingChunkIndices: [s.chunkIdx],
            })),
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("search_web (open-web tool)", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("shapes grounded results into {url,title,excerpt,domain}", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiResponse(
          [
            { uri: "https://competitor.com/pricing", title: "Competitor Pricing" },
            { uri: "https://rival.io/blog/launch", title: "Launch" },
          ],
          [{ text: "they charge $49/mo for the Pro tier", chunkIdx: 0 }]
        )
      )
    );
    const r = (await t.action(internal.gtmMaya.webSearch.webSearch, {
      query: "competitor.com pricing",
    })) as {
      ok: boolean;
      results: Array<{ url: string; title: string | null; excerpt: string | null; domain: string | null }>;
    };
    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(2);
    expect(r.results[0]).toMatchObject({
      url: "https://competitor.com/pricing",
      title: "Competitor Pricing",
      domain: "competitor.com",
    });
    expect(r.results[0].excerpt).toContain("$49/mo");
    // The second source had no support segment → falls back to the summary text.
    expect(r.results[1].excerpt).toContain("summary of findings");
    expect(r.results[1].domain).toBe("rival.io");
  });

  it("caps results at the requested limit", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiResponse([
          { uri: "https://a.com" },
          { uri: "https://b.com" },
          { uri: "https://c.com" },
        ])
      )
    );
    const r = (await t.action(internal.gtmMaya.webSearch.webSearch, {
      query: "x",
      limit: 1,
    })) as { results: unknown[] };
    expect(r.results).toHaveLength(1);
  });

  it("empty query is guarded (no fetch fired)", async () => {
    const t = convexTest(schema, modules);
    const fetchMock = vi.fn(async () => geminiResponse([{ uri: "https://a.com" }]));
    vi.stubGlobal("fetch", fetchMock);
    const r = (await t.action(internal.gtmMaya.webSearch.webSearch, {
      query: "   ",
    })) as { ok: boolean; statusDetail: string };
    expect(r.ok).toBe(false);
    expect(r.statusDetail).toBe("empty_query");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades gracefully on an HTTP error (no throw)", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 }))
    );
    const r = (await t.action(internal.gtmMaya.webSearch.webSearch, {
      query: "x",
    })) as { ok: boolean; results: unknown[]; statusDetail: string };
    expect(r.ok).toBe(false);
    expect(r.results).toHaveLength(0);
    expect(r.statusDetail).toMatch(/gemini_http_429/);
  });

  it("degrades gracefully when the Gemini key is missing", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    const fetchMock = vi.fn(async () => geminiResponse([{ uri: "https://a.com" }]));
    vi.stubGlobal("fetch", fetchMock);
    const r = (await t.action(internal.gtmMaya.webSearch.webSearch, {
      query: "x",
    })) as { ok: boolean; statusDetail: string };
    expect(r.ok).toBe(false);
    expect(r.statusDetail).toBe("gemini_key_missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
