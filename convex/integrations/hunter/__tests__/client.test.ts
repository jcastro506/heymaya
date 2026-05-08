/**
 * Sprint 10 — Hunter client tests (fetch-mocked, no live calls).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  findEmail,
  verifyEmail,
  searchDomain,
  hunterAvailable,
  HunterApiError,
} from "../client";

type FetchFn = typeof globalThis.fetch;
let fetchSpy: ReturnType<typeof vi.fn>;
let originalFetch: FetchFn;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as FetchFn;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockOk(json: unknown) {
  fetchSpy.mockResolvedValueOnce(
    new Response(JSON.stringify(json), { status: 200 })
  );
}

describe("hunterAvailable", () => {
  it("true when key set + reasonable length", () => {
    expect(hunterAvailable({ HUNTER_API_KEY: "abcdefghijklmnop" })).toBe(true);
  });
  it("false when missing or short", () => {
    expect(hunterAvailable({})).toBe(false);
    expect(hunterAvailable({ HUNTER_API_KEY: "" })).toBe(false);
    expect(hunterAvailable({ HUNTER_API_KEY: "short" })).toBe(false);
  });
});

describe("findEmail", () => {
  it("calls /v2/email-finder with domain + first + last + api_key", async () => {
    mockOk({ data: { email: "sarah.k@patagonia.com", score: 92 } });
    const got = await findEmail("test_key_1234567890", {
      domain: "patagonia.com",
      firstName: "Sarah",
      lastName: "K",
    });
    expect(got?.email).toBe("sarah.k@patagonia.com");
    expect(got?.score).toBe(92);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("/v2/email-finder");
    expect(url).toContain("domain=patagonia.com");
    expect(url).toContain("first_name=Sarah");
    expect(url).toContain("last_name=K");
    expect(url).toContain("api_key=test_key_1234567890");
  });

  it("returns null when Hunter has no email", async () => {
    mockOk({ data: { email: undefined } });
    const got = await findEmail("test_key_1234567890", {
      domain: "patagonia.com",
      firstName: "Sarah",
      lastName: "K",
    });
    expect(got).toBeNull();
  });

  it("throws on missing apiKey before any fetch", async () => {
    await expect(
      findEmail("", { domain: "x.com", firstName: "A", lastName: "B" })
    ).rejects.toThrow(/missing apiKey/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("verifyEmail", () => {
  it("calls /v2/email-verifier with email + api_key", async () => {
    mockOk({
      data: {
        email: "sarah@patagonia.com",
        status: "valid",
        result: "deliverable",
        score: 95,
      },
    });
    const got = await verifyEmail("test_key_1234567890", "sarah@patagonia.com");
    expect(got.status).toBe("valid");
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("/v2/email-verifier");
    expect(url).toContain("email=sarah%40patagonia.com");
  });

  it("throws on empty response body", async () => {
    mockOk({});
    await expect(
      verifyEmail("test_key_1234567890", "x@y.com")
    ).rejects.toThrow(HunterApiError);
  });
});

describe("searchDomain", () => {
  it("calls /v2/domain-search with domain + limit", async () => {
    mockOk({
      data: {
        pattern: "{first}.{last}",
        organization: "Patagonia",
        emails: [
          { value: "sarah@patagonia.com", confidence: 90, position: "Influencer Marketing" },
        ],
      },
    });
    const got = await searchDomain("test_key_1234567890", "patagonia.com", {
      limit: 5,
      department: "marketing",
    });
    expect(got.pattern).toBe("{first}.{last}");
    expect(got.emails?.length).toBe(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("/v2/domain-search");
    expect(url).toContain("domain=patagonia.com");
    expect(url).toContain("limit=5");
    expect(url).toContain("department=marketing");
  });

  it("returns empty pattern on missing data field", async () => {
    mockOk({});
    const got = await searchDomain("test_key_1234567890", "x.com");
    expect(got).toEqual({});
  });
});
