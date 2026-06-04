/**
 * Sprint 2 (top-tier) — search_demand tested OFFLINE (mocked DataForSEO).
 *
 * Covers: response shaping + volume-desc sort (nulls last), seed dedup/normalize,
 * the empty-seeds guard, graceful "needs_verification" detection, and graceful
 * missing-creds degradation. No deploy, no real DataForSEO spend.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

function dfsResponse(
  rows: Array<{ keyword: string; search_volume: number | null; cpc?: number; competition?: string }>,
  opts: { statusMessage?: string; taskStatusCode?: number; taskStatusMessage?: string } = {}
): Response {
  return new Response(
    JSON.stringify({
      status_message: opts.statusMessage ?? "Ok.",
      cost: 0.075,
      tasks: [
        {
          id: "task1",
          status_code: opts.taskStatusCode ?? 20000,
          status_message: opts.taskStatusMessage ?? "Ok.",
          result: rows,
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("search_demand (demand intelligence)", () => {
  beforeEach(() => {
    vi.stubEnv("DATAFORSEO_LOGIN", "test@example.com");
    vi.stubEnv("DATAFORSEO_PASSWORD", "secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("shapes + sorts keywords by volume desc, nulls last", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        dfsResponse([
          { keyword: "low", search_volume: 10, cpc: 1.0, competition: "LOW" },
          { keyword: "deadend", search_volume: null },
          { keyword: "high", search_volume: 500, cpc: 4.2, competition: "HIGH" },
        ])
      )
    );
    const r = (await t.action(internal.gtmMaya.demandIntel.searchDemand, {
      seeds: ["high", "low", "deadend"],
    })) as { ok: boolean; keywords: Array<{ keyword: string; volume: number | null }> };
    expect(r.ok).toBe(true);
    expect(r.keywords.map((k) => k.keyword)).toEqual(["high", "low", "deadend"]);
    expect(r.keywords[0].volume).toBe(500);
    expect(r.keywords[2].volume).toBeNull();
  });

  it("dedups + normalizes seeds before the call", async () => {
    const t = convexTest(schema, modules);
    let sentBody: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentBody = init?.body as string;
        return dfsResponse([{ keyword: "ai tool", search_volume: 100 }]);
      })
    );
    await t.action(internal.gtmMaya.demandIntel.searchDemand, {
      seeds: ["AI tool", "ai tool", "  AI Tool  "],
    });
    const parsed = JSON.parse(sentBody ?? "[]")[0];
    expect(parsed.keywords).toEqual(["ai tool"]); // one, lowercased, trimmed
    expect(parsed.location_code).toBe(2840); // US default
  });

  it("empty seeds is guarded (no fetch fired)", async () => {
    const t = convexTest(schema, modules);
    const fetchMock = vi.fn(async () => dfsResponse([{ keyword: "x", search_volume: 1 }]));
    vi.stubGlobal("fetch", fetchMock);
    const r = (await t.action(internal.gtmMaya.demandIntel.searchDemand, {
      seeds: ["  ", ""],
    })) as { ok: boolean; reason?: string };
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("empty_seeds");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("detects an unverified account gracefully", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        dfsResponse([], {
          statusMessage: "Please verify your account before using the API.",
          taskStatusCode: 40201,
          taskStatusMessage: "Please verify your account.",
        })
      )
    );
    const r = (await t.action(internal.gtmMaya.demandIntel.searchDemand, {
      seeds: ["x"],
    })) as { ok: boolean; reason?: string };
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("needs_verification");
  });

  it("degrades gracefully when creds are missing (no fetch)", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("DATAFORSEO_LOGIN", "");
    vi.stubEnv("DATAFORSEO_PASSWORD", "");
    const fetchMock = vi.fn(async () => dfsResponse([{ keyword: "x", search_volume: 1 }]));
    vi.stubGlobal("fetch", fetchMock);
    const r = (await t.action(internal.gtmMaya.demandIntel.searchDemand, {
      seeds: ["x"],
    })) as { ok: boolean; reason?: string };
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_creds");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
