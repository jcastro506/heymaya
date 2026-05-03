/**
 * Nango client tests.
 *
 * Five mandatory categories:
 *   1. Cross-tenant — n/a at the transport level (covered in webhook test).
 *   2. Plan-tier × action — n/a at transport level.
 *   3. Adversarial: bad signature rejected, missing signature rejected,
 *      malformed envelope rejected, replay-safe envelope parses cleanly.
 *   4. Sibling-file scan — n/a Sprint 1; covered repo-wide.
 *   5. TODO grep — repo-wide.
 *
 * Coverage:
 *   - constructor rejects empty secretKey
 *   - getConnection returns the parsed connection envelope
 *   - deleteConnection treats 404 as "deleted: false"
 *   - proxy passes connection-id + provider-config-key headers
 *   - retry on 5xx; surface NangoApiError after exhausted attempts
 *   - 429 honors Retry-After + retries; surface NangoRateLimitError after exhaustion
 *   - 401/403 surface as NangoAuthError immediately (no retry)
 *   - timeout surfaces as NangoTimeoutError on AbortError
 *   - signature verification: valid hex, sha256= prefix, missing, mismatched
 *   - parseNangoWebhookEnvelope: snake_case + camelCase variants, malformed
 *     payloads return null
 *   - generateNangoConnectionId is deterministic given a seed function
 *   - buildNangoConnectUrl includes public_key + connection_id
 */

import { describe, it, expect, vi } from "vitest";
import {
  NangoClient,
  NangoAuthError,
  NangoApiError,
  NangoRateLimitError,
  NangoTimeoutError,
  verifyNangoSignature,
  parseNangoWebhookEnvelope,
  generateNangoConnectionId,
  buildNangoConnectUrl,
  NANGO_SIGNATURE_HEADER,
} from "../nango";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("NangoClient — constructor", () => {
  it("throws if secretKey is empty", () => {
    expect(() => new NangoClient({ secretKey: "" })).toThrow(NangoAuthError);
  });
  it("accepts secretKey + builds URL with default base", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { connectionId: "x", providerConfigKey: "jobber" })
    );
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.getConnection({ connectionId: "x", providerConfigKey: "jobber" });
    const callArgs = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const url = callArgs[0];
    expect(url).toContain("api.nango.dev");
    expect(url).toContain("/connection/x");
    expect(url).toContain("provider_config_key=jobber");
  });
});

describe("NangoClient — getConnection", () => {
  it("returns parsed connection envelope", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        connectionId: "c1",
        providerConfigKey: "jobber",
        metadata: { scopes: ["read:jobs"] },
      })
    );
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const conn = await client.getConnection({
      connectionId: "c1",
      providerConfigKey: "jobber",
    });
    expect(conn.connectionId).toBe("c1");
    expect(conn.providerConfigKey).toBe("jobber");
  });
});

describe("NangoClient — deleteConnection", () => {
  it("treats 404 as deleted=false (idempotent)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 404 })
    );
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.deleteConnection({
      connectionId: "x",
      providerConfigKey: "jobber",
    });
    expect(result.deleted).toBe(false);
  });
  it("returns deleted=true on 200", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.deleteConnection({
      connectionId: "x",
      providerConfigKey: "jobber",
    });
    expect(result.deleted).toBe(true);
  });
});

describe("NangoClient — proxy", () => {
  it("forwards connection-id + provider-config-key headers", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.proxy({
      connectionId: "c1",
      providerConfigKey: "jobber",
      method: "POST",
      endpoint: "/api/graphql",
      body: { query: "{ jobs { id } }" },
    });
    const callArgs = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const init = callArgs[1];
    const headers = init.headers as Record<string, string>;
    expect(headers["connection-id"]).toBe("c1");
    expect(headers["provider-config-key"]).toBe("jobber");
    expect(headers.authorization).toBe("Bearer sk_test");
  });
});

describe("NangoClient — adversarial: error classes", () => {
  it("401 surfaces as NangoAuthError immediately (no retry)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { error: "unauthorized" })
    );
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    await expect(
      client.getConnection({ connectionId: "x", providerConfigKey: "jobber" })
    ).rejects.toBeInstanceOf(NangoAuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("non-2xx surfaces NangoApiError on the final attempt", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, { error: "bad request" })
    );
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    await expect(
      client.getConnection({ connectionId: "x", providerConfigKey: "jobber" })
    ).rejects.toBeInstanceOf(NangoApiError);
  });

  it("5xx retries up to maxAttempts then throws NangoApiError", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, { error: "upstream" })
    );
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      maxAttempts: 3,
      random: () => 0,
    });
    await expect(
      client.getConnection({ connectionId: "x", providerConfigKey: "jobber" })
    ).rejects.toBeInstanceOf(NangoApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("429 with Retry-After then 200 succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return jsonResponse(429, { error: "slow down" }, { "retry-after": "0" });
      }
      return jsonResponse(200, { connectionId: "x", providerConfigKey: "jobber" });
    });
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      random: () => 0,
    });
    const conn = await client.getConnection({
      connectionId: "x",
      providerConfigKey: "jobber",
    });
    expect(conn.connectionId).toBe("x");
    expect(calls).toBe(2);
  });

  it("429 exhausted surfaces NangoRateLimitError", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(429, { error: "limit" }, { "retry-after": "0" })
    );
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      maxAttempts: 2,
      random: () => 0,
    });
    await expect(
      client.getConnection({ connectionId: "x", providerConfigKey: "jobber" })
    ).rejects.toBeInstanceOf(NangoRateLimitError);
  });

  it("AbortError surfaces NangoTimeoutError after exhausted retries", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init: unknown) => {
      const sig = (init as RequestInit).signal as AbortSignal;
      // Simulate abort by throwing AbortError-shaped error.
      if (sig?.aborted) {
        const err: Error & { name: string } = new Error("aborted") as Error & {
          name: string;
        };
        err.name = "AbortError";
        throw err;
      }
      // Trigger abort + throw.
      const err: Error & { name: string } = new Error("aborted") as Error & {
        name: string;
      };
      err.name = "AbortError";
      throw err;
    });
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      maxAttempts: 2,
      random: () => 0,
    });
    await expect(
      client.getConnection({ connectionId: "x", providerConfigKey: "jobber" })
    ).rejects.toBeInstanceOf(NangoTimeoutError);
  });
});

/* -------------------------------------------------------------------------- */
/* Signature verification                                                      */
/* -------------------------------------------------------------------------- */

async function hmacHex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const bytes = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

describe("verifyNangoSignature", () => {
  it("accepts valid hex signature", async () => {
    const body = '{"eventId":"evt_1"}';
    const secret = "shh";
    const sig = await hmacHex(secret, body);
    expect(await verifyNangoSignature(body, sig, secret)).toBe(true);
  });

  it("accepts sha256= prefixed signature", async () => {
    const body = "{}";
    const secret = "shh";
    const sig = await hmacHex(secret, body);
    expect(await verifyNangoSignature(body, `sha256=${sig}`, secret)).toBe(
      true
    );
  });

  it("rejects mismatched signature", async () => {
    expect(await verifyNangoSignature("{}", "deadbeef", "shh")).toBe(false);
  });

  it("rejects missing signature", async () => {
    expect(await verifyNangoSignature("{}", null, "shh")).toBe(false);
    expect(await verifyNangoSignature("{}", "", "shh")).toBe(false);
  });

  it("rejects empty secret", async () => {
    const sig = await hmacHex("real", "{}");
    expect(await verifyNangoSignature("{}", sig, "")).toBe(false);
  });

  it("rejects non-hex signature", async () => {
    expect(await verifyNangoSignature("{}", "not-hex-at-all", "shh")).toBe(
      false
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Webhook envelope parsing                                                    */
/* -------------------------------------------------------------------------- */

describe("parseNangoWebhookEnvelope", () => {
  it("parses camelCase variant", () => {
    const env = parseNangoWebhookEnvelope({
      eventId: "evt_1",
      type: "forward",
      providerConfigKey: "jobber",
      connectionId: "jobber_biz_x",
      payload: { topic: "JOB_COMPLETE", itemId: "job_42" },
      providerEventName: "JOB_COMPLETE",
      receivedAt: 1700000000,
    });
    expect(env).not.toBeNull();
    expect(env!.eventId).toBe("evt_1");
    expect(env!.type).toBe("forward");
    expect(env!.providerConfigKey).toBe("jobber");
    expect(env!.providerEventName).toBe("JOB_COMPLETE");
  });

  it("parses snake_case variant", () => {
    const env = parseNangoWebhookEnvelope({
      id: "evt_1",
      type: "auth",
      provider_config_key: "housecallpro",
      connection_id: "hcp_biz_y",
    });
    expect(env).not.toBeNull();
    expect(env!.providerConfigKey).toBe("housecallpro");
    expect(env!.connectionId).toBe("hcp_biz_y");
  });

  it("returns null for missing required fields", () => {
    expect(parseNangoWebhookEnvelope({ id: "x" })).toBeNull();
    expect(parseNangoWebhookEnvelope(null)).toBeNull();
    expect(parseNangoWebhookEnvelope("not an object")).toBeNull();
    expect(
      parseNangoWebhookEnvelope({ id: "x", type: "unknown", providerConfigKey: "j", connectionId: "c" })
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Connect URL helpers                                                         */
/* -------------------------------------------------------------------------- */

describe("connection helpers", () => {
  it("buildNangoConnectUrl includes public_key + connection_id", () => {
    const url = buildNangoConnectUrl({
      publicKey: "pk_test",
      providerConfigKey: "jobber",
      connectionId: "jobber_biz_x_abcd",
    });
    expect(url).toContain("public_key=pk_test");
    expect(url).toContain("connection_id=jobber_biz_x_abcd");
    expect(url).toContain("/oauth/connect/jobber");
  });

  it("generateNangoConnectionId is deterministic given a seed function", () => {
    const id1 = generateNangoConnectionId("jobber", "abc", () => 0.5);
    const id2 = generateNangoConnectionId("jobber", "abc", () => 0.5);
    expect(id1).toBe(id2);
    expect(id1.startsWith("jobber_abc_")).toBe(true);
  });
});

describe("NANGO_SIGNATURE_HEADER", () => {
  it("matches Nango docs header name (lowercase to match fetch normalization)", () => {
    expect(NANGO_SIGNATURE_HEADER).toBe("x-nango-signature");
  });
});
