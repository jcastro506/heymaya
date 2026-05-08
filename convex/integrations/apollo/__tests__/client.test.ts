/**
 * Sprint 10 — Apollo client tests (fetch-mocked, no live calls).
 *
 * Verifies request shape (URL, headers, body) and response parsing.
 * The client is pure-stateless so all tests target the wire-format
 * contract — if Apollo changes their API shape this is the unit that
 * detects it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  searchPeople,
  apolloAvailable,
  ApolloApiError,
  DEFAULT_INFLUENCER_MARKETER_TITLES,
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

function callArgs(idx = 0): { url: string; init: RequestInit } {
  const c = fetchSpy.mock.calls[idx];
  return { url: String(c[0]), init: (c[1] ?? {}) as RequestInit };
}

describe("apolloAvailable", () => {
  it("returns true when APOLLO_API_KEY is set + reasonable length", () => {
    expect(apolloAvailable({ APOLLO_API_KEY: "abcdefghijklmnop" })).toBe(true);
  });
  it("returns false when key is missing or short", () => {
    expect(apolloAvailable({})).toBe(false);
    expect(apolloAvailable({ APOLLO_API_KEY: "" })).toBe(false);
    expect(apolloAvailable({ APOLLO_API_KEY: "shortkey" })).toBe(false);
  });
});

describe("searchPeople — request shape", () => {
  it("POSTs to /v1/mixed_people/search with X-Api-Key + JSON body", async () => {
    mockOk({ people: [], pagination: { page: 1, per_page: 25, total_entries: 0, total_pages: 0 } });
    await searchPeople("test_key_1234567890", {
      personTitles: ["Influencer Marketing Manager"],
      organizationDomains: ["patagonia.com"],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const { url, init } = callArgs();
    expect(url).toBe("https://api.apollo.io/v1/mixed_people/search");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe("test_key_1234567890");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String(init.body));
    expect(body.person_titles).toEqual(["Influencer Marketing Manager"]);
    expect(body.q_organization_domains).toBe("patagonia.com");
  });

  it("falls back to default influencer-marketer titles when none provided", async () => {
    mockOk({ people: [], pagination: { page: 1, per_page: 25, total_entries: 0, total_pages: 0 } });
    await searchPeople("test_key_1234567890", {
      organizationDomains: ["patagonia.com"],
    });
    const body = JSON.parse(String(callArgs().init.body));
    expect(body.person_titles).toEqual(DEFAULT_INFLUENCER_MARKETER_TITLES);
  });

  it("joins multi-domain queries with newline (Apollo's expected format)", async () => {
    mockOk({ people: [] });
    await searchPeople("test_key_1234567890", {
      organizationDomains: ["patagonia.com", "rei.com", "lululemon.com"],
    });
    const body = JSON.parse(String(callArgs().init.body));
    expect(body.q_organization_domains).toBe("patagonia.com\nrei.com\nlululemon.com");
  });

  it("respects custom page + perPage", async () => {
    mockOk({ people: [] });
    await searchPeople("test_key_1234567890", {
      organizationDomains: ["patagonia.com"],
      page: 3,
      perPage: 50,
    });
    const body = JSON.parse(String(callArgs().init.body));
    expect(body.page).toBe(3);
    expect(body.per_page).toBe(50);
  });
});

describe("searchPeople — response parsing", () => {
  it("returns parsed people array + pagination", async () => {
    mockOk({
      people: [
        {
          id: "p_1",
          name: "Sarah K",
          title: "Influencer Marketing Manager",
          email: "sarah@patagonia.com",
          email_status: "verified",
          organization: { id: "o_1", name: "Patagonia", primary_domain: "patagonia.com" },
        },
      ],
      pagination: { page: 1, per_page: 25, total_entries: 1, total_pages: 1 },
    });
    const got = await searchPeople("test_key_1234567890", {
      organizationDomains: ["patagonia.com"],
    });
    expect(got.people.length).toBe(1);
    expect(got.people[0].email).toBe("sarah@patagonia.com");
    expect(got.pagination.total_entries).toBe(1);
  });

  it("normalizes missing pagination to safe defaults", async () => {
    mockOk({ people: [] });
    const got = await searchPeople("test_key_1234567890", {
      organizationDomains: ["patagonia.com"],
    });
    expect(got.pagination.page).toBe(1);
  });
});

describe("searchPeople — error handling", () => {
  it("throws ApolloApiError with status when API returns non-OK", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    await expect(
      searchPeople("test_key_1234567890", { organizationDomains: ["x.com"] })
    ).rejects.toThrow(ApolloApiError);
  });

  it("throws when apiKey is empty (don't even hit the wire)", async () => {
    await expect(
      searchPeople("", { organizationDomains: ["x.com"] })
    ).rejects.toThrow(/missing apiKey/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
