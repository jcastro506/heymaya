/**
 * Unified.to client transport tests.
 *
 * Coverage:
 *   - Bearer auth header populated from constructor apiKey
 *   - 401 token-expired body sniffed → UnifiedTokenExpiredError
 *   - 401 generic → UnifiedAuthError
 *   - 429 retry-after honored
 *   - 5xx retry then succeed
 *   - Network error retried then thrown after maxAttempts
 *   - extraHeaders cannot override authorization
 *   - HMAC-SHA256 signature verify: valid / invalid / sha256= prefix tolerated
 */

import { describe, it, expect } from "vitest";
import {
  UnifiedClient,
  verifyUnifiedSignature,
} from "../client";
import {
  UnifiedAuthError,
  UnifiedRateLimitError,
  UnifiedTokenExpiredError,
} from "../types";

function makeFakeFetch(
  responses: Array<
    | { status: number; body?: string; headers?: Record<string, string> }
    | { throws: Error }
  >
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    if ("throws" in next) {
      throw next.throws;
    }
    return new Response(next.body ?? "", {
      status: next.status,
      headers: next.headers,
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("UnifiedClient.constructor", () => {
  it("rejects empty apiKey", () => {
    expect(() => new UnifiedClient({ apiKey: "" })).toThrow(UnifiedAuthError);
  });
});

describe("UnifiedClient.request — auth header", () => {
  it("sets Authorization: Bearer <apiKey>", async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: '{"ok":true}' },
    ]);
    const client = new UnifiedClient({
      apiKey: "k_test",
      fetchImpl,
      sleep: async () => {},
    });
    await client.request("/foo");
    expect(calls).toHaveLength(1);
    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    expect(headers.authorization).toBe("Bearer k_test");
  });

  it("does NOT allow extraHeaders to override authorization", async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: "{}" },
    ]);
    const client = new UnifiedClient({
      apiKey: "k_test",
      fetchImpl,
      sleep: async () => {},
    });
    await client.request("/foo", {
      extraHeaders: { authorization: "Bearer EVIL" },
    });
    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    expect(headers.authorization).toBe("Bearer k_test");
  });
});

describe("UnifiedClient.request — 401 token-expired vs auth-revoked", () => {
  it("throws UnifiedTokenExpiredError when 401 body indicates token expired", async () => {
    const { fetchImpl } = makeFakeFetch([
      {
        status: 401,
        body: '{"error":"TOKEN_EXPIRED","message":"refresh required"}',
      },
    ]);
    const client = new UnifiedClient({
      apiKey: "k",
      fetchImpl,
      sleep: async () => {},
    });
    await expect(client.request("/foo")).rejects.toBeInstanceOf(
      UnifiedTokenExpiredError
    );
  });

  it("throws UnifiedAuthError on a generic 401", async () => {
    const { fetchImpl } = makeFakeFetch([
      { status: 401, body: '{"error":"unauthorized"}' },
    ]);
    const client = new UnifiedClient({
      apiKey: "k",
      fetchImpl,
      sleep: async () => {},
    });
    await expect(client.request("/foo")).rejects.toBeInstanceOf(
      UnifiedAuthError
    );
  });
});

describe("UnifiedClient.request — 429 rate limit", () => {
  it("retries on 429 honoring Retry-After then succeeds", async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 429, headers: { "retry-after": "0" } },
      { status: 200, body: '{"ok":true}' },
    ]);
    const client = new UnifiedClient({
      apiKey: "k",
      fetchImpl,
      sleep: async () => {},
      maxAttempts: 2,
    });
    const out = await client.request<{ ok: boolean }>("/foo");
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("throws UnifiedRateLimitError after maxAttempts", async () => {
    const { fetchImpl } = makeFakeFetch([
      { status: 429, headers: { "retry-after": "0" } },
      { status: 429, headers: { "retry-after": "0" } },
    ]);
    const client = new UnifiedClient({
      apiKey: "k",
      fetchImpl,
      sleep: async () => {},
      maxAttempts: 2,
    });
    await expect(client.request("/foo")).rejects.toBeInstanceOf(
      UnifiedRateLimitError
    );
  });
});

describe("UnifiedClient.request — 5xx retry", () => {
  it("retries 503 and returns body on success", async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 503, body: "down" },
      { status: 200, body: '{"ok":true}' },
    ]);
    const client = new UnifiedClient({
      apiKey: "k",
      fetchImpl,
      sleep: async () => {},
      maxAttempts: 2,
      baseBackoffMs: 1,
    });
    const out = await client.request<{ ok: boolean }>("/foo");
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

describe("verifyUnifiedSignature", () => {
  async function hmac(secret: string, body: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: { name: "SHA-256" } },
      false,
      ["sign"]
    );
    const buf = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  it("returns true for a valid hex signature", async () => {
    const secret = "supersecret";
    const body = '{"event_id":"e1"}';
    const sig = await hmac(secret, body);
    expect(await verifyUnifiedSignature(body, sig, secret)).toBe(true);
  });

  it("returns true with sha256= prefix tolerated", async () => {
    const secret = "supersecret";
    const body = '{"x":1}';
    const sig = await hmac(secret, body);
    expect(await verifyUnifiedSignature(body, `sha256=${sig}`, secret)).toBe(
      true
    );
  });

  it("returns false on mismatched body", async () => {
    const secret = "s";
    const sig = await hmac(secret, '{"a":1}');
    expect(await verifyUnifiedSignature('{"a":2}', sig, secret)).toBe(false);
  });

  it("returns false on missing/empty header or secret", async () => {
    expect(await verifyUnifiedSignature("body", null, "secret")).toBe(false);
    expect(await verifyUnifiedSignature("body", "", "secret")).toBe(false);
    expect(await verifyUnifiedSignature("body", "deadbeef", "")).toBe(false);
  });

  it("returns false on non-hex signature", async () => {
    expect(await verifyUnifiedSignature("body", "not-hex!!!", "secret")).toBe(
      false
    );
  });
});
