/**
 * ZernioClient — unit tests.
 *
 * Coverage (5 mandatory categories applicable):
 *   - Auth header injection (Bearer token)
 *   - extraHeaders cannot override authorization (fail-closed)
 *   - retry on 5xx, exhaustion → ZernioApiError
 *   - 4xx fails immediately (no retry); 401/403 → ZernioAuthError
 *   - 429 honors retry-after, exhaustion → ZernioRateLimitError
 *   - timeout via AbortController → ZernioTimeoutError
 *   - HMAC-SHA256 signature: valid passes, invalid hex rejects, mismatched rejects
 *   - constructor throws ZernioAuthError on missing api key
 *
 * Adversarial:
 *   - forged signature (different secret) rejected
 *   - sha256= prefix tolerated for forward-compat
 *   - non-hex signature rejected
 */

import { describe, it, expect, vi } from "vitest";
import {
  ZernioClient,
  verifyZernioSignature,
  sha256Hex,
} from "../client";
import {
  ZernioApiError,
  ZernioAuthError,
  ZernioRateLimitError,
  ZernioTimeoutError,
} from "../types";

const TEST_KEY = "zernio-test-key-xyz";
const TEST_BASE = "https://api.example-zernio.test";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("ZernioClient", () => {
  it("injects Bearer token on every call and parses JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = new ZernioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
      random: () => 0,
    });
    const out = await client.request<{ ok: boolean }>("/api/v1/test");
    expect(out).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${TEST_BASE}/api/v1/test`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${TEST_KEY}`);
    expect(headers["accept"]).toBe("application/json");
  });

  it("extraHeaders cannot override authorization (fail-closed)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new ZernioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    await client.request("/api/v1/x", {
      extraHeaders: { authorization: "Bearer MALICIOUS-OVERRIDE" },
    });
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers["authorization"]).toBe(`Bearer ${TEST_KEY}`);
  });

  it("constructor throws ZernioAuthError on missing apiKey", () => {
    expect(() => new ZernioClient({ apiKey: "" })).toThrow(ZernioAuthError);
  });

  it("retries on 500/503 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new ZernioClient({
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

  it("5xx exhaustion converts to ZernioApiError with status + body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("upstream down", { status: 503 }));
    const client = new ZernioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
      maxAttempts: 3,
    });
    await expect(client.request("/x")).rejects.toBeInstanceOf(ZernioApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("4xx (e.g. 400) fails immediately without retry", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("bad request", { status: 400 }));
    const client = new ZernioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    await expect(client.request("/x")).rejects.toBeInstanceOf(ZernioApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("401 throws ZernioAuthError immediately (no retry)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("unauth", { status: 401 }));
    const client = new ZernioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    await expect(client.request("/x")).rejects.toBeInstanceOf(ZernioAuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("403 throws ZernioAuthError immediately (no retry)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("forbidden", { status: 403 }));
    const client = new ZernioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    await expect(client.request("/x")).rejects.toBeInstanceOf(ZernioAuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("429 honors retry-after, exhaustion → ZernioRateLimitError", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "1" },
        })
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new ZernioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep,
      maxAttempts: 3,
    });
    await expect(client.request("/x")).rejects.toBeInstanceOf(
      ZernioRateLimitError
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("timeout aborts and converts to ZernioTimeoutError", async () => {
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
    const client = new ZernioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep,
      maxAttempts: 1,
      timeoutMs: 5,
    });
    await expect(client.request("/x")).rejects.toBeInstanceOf(
      ZernioTimeoutError
    );
  });

  it("appends query params with proper URL encoding", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new ZernioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    await client.request("/api/v1/x", {
      query: { handle: "@svc/biz", limit: 30 },
    });
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain("handle=%40svc%2Fbiz");
    expect(url).toContain("limit=30");
  });
});

describe("verifyZernioSignature (HMAC-SHA256)", () => {
  const SECRET = "shhh-its-a-secret";
  const BODY = `{"event":"review.created","id":"evt_1","data":{}}`;

  async function computeSignature(secret: string, body: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: { name: "SHA-256" } },
      false,
      ["sign"]
    );
    const buf = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    const bytes = new Uint8Array(buf);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
  }

  it("valid signature passes", async () => {
    const sig = await computeSignature(SECRET, BODY);
    expect(await verifyZernioSignature(BODY, sig, SECRET)).toBe(true);
  });

  it("sha256= prefix is tolerated", async () => {
    const sig = await computeSignature(SECRET, BODY);
    expect(await verifyZernioSignature(BODY, `sha256=${sig}`, SECRET)).toBe(true);
  });

  it("forged signature (wrong secret) rejected", async () => {
    const sig = await computeSignature("WRONG", BODY);
    expect(await verifyZernioSignature(BODY, sig, SECRET)).toBe(false);
  });

  it("body mutation rejected", async () => {
    const sig = await computeSignature(SECRET, BODY);
    const tampered = BODY.replace("review.created", "review.deleted");
    expect(await verifyZernioSignature(tampered, sig, SECRET)).toBe(false);
  });

  it("missing signature rejected", async () => {
    expect(await verifyZernioSignature(BODY, null, SECRET)).toBe(false);
    expect(await verifyZernioSignature(BODY, "", SECRET)).toBe(false);
  });

  it("non-hex signature rejected immediately", async () => {
    expect(
      await verifyZernioSignature(BODY, "definitely-not-hex!!!", SECRET)
    ).toBe(false);
  });

  it("missing secret rejected", async () => {
    const sig = await computeSignature(SECRET, BODY);
    expect(await verifyZernioSignature(BODY, sig, "")).toBe(false);
  });

  it("uppercase hex normalized + accepted", async () => {
    const sig = (await computeSignature(SECRET, BODY)).toUpperCase();
    expect(await verifyZernioSignature(BODY, sig, SECRET)).toBe(true);
  });
});

describe("sha256Hex helper", () => {
  it("produces stable hex for a known input", async () => {
    const out = await sha256Hex("hello");
    // Standard SHA-256 of "hello".
    expect(out).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });
});
