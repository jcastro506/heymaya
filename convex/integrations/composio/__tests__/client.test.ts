/**
 * ComposioClient — unit tests.
 *
 * Coverage:
 *  - x-api-key header injection
 *  - retry on 5xx with exponential backoff (3 attempts max)
 *  - 4xx fails immediately (no retry)
 *  - 429 retries respecting retry-after, then converts to ComposioRateLimitError
 *  - timeout via AbortController converts to ComposioTimeoutError
 *  - parses JSON, returns typed value
 *  - extraHeaders cannot override x-api-key (fail-closed)
 */

import { describe, it, expect, vi } from "vitest";
import {
  ComposioClient,
  ComposioHttpError,
  ComposioRateLimitError,
  ComposioTimeoutError,
} from "../client";

const TEST_KEY = "test-composio-key-xyz";
const TEST_BASE = "https://api.example-composio.test";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("ComposioClient", () => {
  it("injects x-api-key header on every call and returns parsed JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = new ComposioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
      random: () => 0,
    });
    const out = await client.request<{ ok: boolean }>("/api/v3/test");
    expect(out).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${TEST_BASE}/api/v3/test`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(TEST_KEY);
    expect(headers["accept"]).toBe("application/json");
  });

  it("extraHeaders cannot override x-api-key (fail-closed auth)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new ComposioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    await client.request("/v1/x", {
      extraHeaders: { "x-api-key": "MALICIOUS-OVERRIDE" },
    });
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers["x-api-key"]).toBe(TEST_KEY);
  });

  it("retries on 500 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new ComposioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep,
      random: () => 0.5,
      maxAttempts: 3,
      baseBackoffMs: 100,
    });
    const out = await client.request<{ ok: boolean }>("/x");
    expect(out).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("4xx fails immediately without retry", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("bad request", { status: 400 }));
    const client = new ComposioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    await expect(client.request("/x")).rejects.toBeInstanceOf(ComposioHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("429 honors retry-after, then converts to ComposioRateLimitError after exhausting retries", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "1" },
        })
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new ComposioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep,
      maxAttempts: 3,
    });
    await expect(client.request("/x")).rejects.toBeInstanceOf(ComposioRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // retry-after is in seconds; we should have slept 1000ms each backoff round
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("timeout aborts request and converts to ComposioTimeoutError", async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            (err as unknown as { name: string }).name = "AbortError";
            reject(err);
          });
        })
    );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new ComposioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep,
      maxAttempts: 1,
      timeoutMs: 5,
    });
    await expect(client.request("/x")).rejects.toBeInstanceOf(ComposioTimeoutError);
  });

  it("appends query params with proper URL encoding", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new ComposioClient({
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

  it("constructor throws if COMPOSIO_API_KEY is missing", () => {
    const oldKey = process.env.COMPOSIO_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    try {
      expect(() => new ComposioClient()).toThrow(/COMPOSIO_API_KEY/);
    } finally {
      if (oldKey) process.env.COMPOSIO_API_KEY = oldKey;
    }
  });
});
