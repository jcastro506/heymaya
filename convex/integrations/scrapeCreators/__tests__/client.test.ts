/**
 * ScrapeCreatorsClient — unit tests
 *
 * Coverage:
 *  - x-api-key header injection
 *  - retry on 5xx with exponential backoff (3 attempts max)
 *  - 4xx fails immediately (no retry)
 *  - 429 retries respecting retry-after, then converts to ScrapeCreatorsRateLimitError
 *  - timeout via AbortController converts to ScrapeCreatorsTimeoutError
 *  - parses JSON, returns typed value
 *  - backoff math is exponential (sleep call sequence asserted)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ScrapeCreatorsClient,
  ScrapeCreatorsHttpError,
  ScrapeCreatorsRateLimitError,
  ScrapeCreatorsTimeoutError,
} from "../client";

const TEST_KEY = "test-api-key-abc123";
const TEST_BASE = "https://api.example-sc.test";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("ScrapeCreatorsClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("injects x-api-key header on every call and returns parsed JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = new ScrapeCreatorsClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
      random: () => 0,
    });

    const out = await client.request<{ ok: boolean }>("/v1/test");
    expect(out).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${TEST_BASE}/v1/test`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(TEST_KEY);
    expect(headers["accept"]).toBe("application/json");
  });

  it("appends query params with proper URL encoding", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new ScrapeCreatorsClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    await client.request("/v1/x", { query: { handle: "@hey/maya", limit: 30 } });
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain("handle=%40hey%2Fmaya");
    expect(url).toContain("limit=30");
  });

  it("retries on 500 then succeeds (2 failures + 1 success = 3 calls total)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new ScrapeCreatorsClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep,
      random: () => 1, // max backoff
    });
    const out = await client.request<{ ok: boolean }>("/v1/test");
    expect(out).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // 2 retries → 2 sleeps; full-jitter ceiling = base * 2^(attempt-1)
    expect(sleep).toHaveBeenCalledTimes(2);
    // Attempt 1 backoff ceiling = 500ms, Attempt 2 ceiling = 1000ms; with random()===1 we sleep `floor(ceiling)-1`-ish.
    // Math.floor(1.0 * 500) === 500, Math.floor(1.0 * 1000) === 1000, but JS guards: random() returns [0,1). We pin to 1.
    // Using floor we get exact ceilings.
    expect(sleep.mock.calls[0][0]).toBe(500);
    expect(sleep.mock.calls[1][0]).toBe(1000);
  });

  it("throws ScrapeCreatorsHttpError after maxAttempts of 5xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("oops", { status: 500 }));
    const client = new ScrapeCreatorsClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
      random: () => 0,
      maxAttempts: 3,
    });
    await expect(client.request("/v1/test")).rejects.toBeInstanceOf(
      ScrapeCreatorsHttpError
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on 4xx — fails immediately on first attempt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad", { status: 404 }));
    const client = new ScrapeCreatorsClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
      random: () => 0,
    });
    await expect(client.request("/v1/test")).rejects.toBeInstanceOf(
      ScrapeCreatorsHttpError
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 401 / 403", async () => {
    for (const status of [401, 403, 422]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status }));
      const client = new ScrapeCreatorsClient({
        apiKey: TEST_KEY,
        baseUrl: TEST_BASE,
        fetchImpl,
        sleep: async () => {},
      });
      await expect(client.request("/v1/test")).rejects.toBeInstanceOf(
        ScrapeCreatorsHttpError
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("retries on 429 honoring retry-after header (seconds)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate", { status: 429, headers: { "retry-after": "2" } })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new ScrapeCreatorsClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep,
    });
    const out = await client.request<{ ok: boolean }>("/v1/test");
    expect(out).toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBe(2000);
  });

  it("converts terminal 429 into ScrapeCreatorsRateLimitError", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response("rate", { status: 429, headers: { "retry-after": "1" } })
      );
    const client = new ScrapeCreatorsClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
      maxAttempts: 2,
    });
    await expect(client.request("/v1/test")).rejects.toBeInstanceOf(
      ScrapeCreatorsRateLimitError
    );
  });

  it("converts AbortError → ScrapeCreatorsTimeoutError after max attempts", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchImpl = vi.fn().mockRejectedValue(abortErr);
    const client = new ScrapeCreatorsClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
      maxAttempts: 3,
      timeoutMs: 50,
    });
    await expect(client.request("/v1/test")).rejects.toBeInstanceOf(
      ScrapeCreatorsTimeoutError
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries on generic network errors (TypeError) and surfaces last error", async () => {
    const networkErr = new TypeError("fetch failed");
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(networkErr)
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new ScrapeCreatorsClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    const out = await client.request<{ ok: boolean }>("/v1/test");
    expect(out).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws if SCRAPE_CREATORS_API_KEY missing", () => {
    const original = process.env.SCRAPE_CREATORS_API_KEY;
    delete process.env.SCRAPE_CREATORS_API_KEY;
    try {
      expect(() => new ScrapeCreatorsClient()).toThrow(/SCRAPE_CREATORS_API_KEY/);
    } finally {
      if (original !== undefined) process.env.SCRAPE_CREATORS_API_KEY = original;
    }
  });

  it("supports POST with JSON body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: 1 }));
    const client = new ScrapeCreatorsClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    await client.request("/v1/post", { method: "POST", body: { handle: "x" } });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ handle: "x" }));
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
  });
});
