import { describe, expect, it } from "vitest";
import {
  detectStoreUrl,
  fetchAppleListing,
  normalizeAppleResult,
  normalizePlayApp,
  parseAppleAppId,
  parsePlayPackage,
  storeListingToContext,
} from "../storeListing";

describe("store-URL parsing", () => {
  it("extracts the Apple app id from real + messy URLs", () => {
    expect(
      parseAppleAppId("https://apps.apple.com/us/app/duolingo/id570060128")
    ).toBe("570060128");
    expect(
      parseAppleAppId(
        "https://apps.apple.com/gb/app/some-slug/id6448385721?mt=8&platform=iphone"
      )
    ).toBe("6448385721");
    // No country prefix, trailing slash.
    expect(parseAppleAppId("https://apps.apple.com/app/id123/")).toBe("123");
  });

  it("extracts the Play package from real + messy URLs", () => {
    expect(
      parsePlayPackage(
        "https://play.google.com/store/apps/details?id=com.duolingo"
      )
    ).toBe("com.duolingo");
    expect(
      parsePlayPackage(
        "https://play.google.com/store/apps/details?hl=en&gl=us&id=com.company.app_name"
      )
    ).toBe("com.company.app_name");
  });

  it("rejects non-store and malformed URLs", () => {
    expect(parseAppleAppId("https://example.com/pricing")).toBeNull();
    expect(parsePlayPackage("https://example.com/?id=")).toBeNull();
    expect(detectStoreUrl("https://example.com")).toBeNull();
    // Right host, missing id.
    expect(detectStoreUrl("https://apps.apple.com/us/app/foo")).toBeNull();
    expect(
      detectStoreUrl("https://play.google.com/store/apps/details")
    ).toBeNull();
  });

  it("classifies store URLs with their id", () => {
    expect(
      detectStoreUrl("https://apps.apple.com/us/app/x/id99")
    ).toEqual({ source: "app_store", id: "99" });
    expect(
      detectStoreUrl("https://play.google.com/store/apps/details?id=com.x")
    ).toEqual({ source: "play_store", id: "com.x" });
  });
});

describe("Apple iTunes Lookup", () => {
  const itunesResult = {
    trackName: "Duolingo: Language Lessons",
    description: "Learn a new language with bite-sized lessons.",
    primaryGenreName: "Education",
    genres: ["Education", "Social Networking"],
    averageUserRating: 4.7,
    userRatingCount: 5240976,
    screenshotUrls: ["https://a/1.png", "https://a/2.png"],
    sellerName: "Duolingo, Inc.",
    trackViewUrl: "https://apps.apple.com/us/app/duolingo/id570060128",
  };

  it("normalizes a lookup result into a StoreListing", () => {
    const listing = normalizeAppleResult("570060128", itunesResult);
    expect(listing).toMatchObject({
      source: "app_store",
      storeId: "570060128",
      name: "Duolingo: Language Lessons",
      category: "Education",
      rating: 4.7,
      ratingCount: 5240976,
      developer: "Duolingo, Inc.",
    });
    expect(listing.description).toContain("bite-sized");
    expect(listing.screenshotUrls).toHaveLength(2);
  });

  it("fetches + normalizes via an injected fetch impl", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ resultCount: 1, results: [itunesResult] }), {
        status: 200,
      })) as typeof fetch;
    const listing = await fetchAppleListing("570060128", fetchImpl);
    expect(listing?.name).toBe("Duolingo: Language Lessons");
  });

  it("soft-fails to null on empty result set, non-200, and network error", async () => {
    const empty = (async () =>
      new Response(JSON.stringify({ resultCount: 0, results: [] }), {
        status: 200,
      })) as typeof fetch;
    expect(await fetchAppleListing("0", empty)).toBeNull();

    const http404 = (async () =>
      new Response("not found", { status: 404 })) as typeof fetch;
    expect(await fetchAppleListing("0", http404)).toBeNull();

    const boom = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    expect(await fetchAppleListing("0", boom)).toBeNull();
  });
});

describe("Google Play normalizer", () => {
  it("normalizes a google-play-scraper result (string developer)", () => {
    const listing = normalizePlayApp("com.duolingo", {
      title: "Duolingo: Language Lessons",
      description: "Learn 40+ languages.",
      genre: "Education",
      score: 4.72,
      ratings: 46390173,
      screenshots: ["https://p/1.png"],
      developer: "Duolingo",
      url: "https://play.google.com/store/apps/details?id=com.duolingo",
    });
    expect(listing).toMatchObject({
      source: "play_store",
      storeId: "com.duolingo",
      name: "Duolingo: Language Lessons",
      category: "Education",
      rating: 4.72,
      ratingCount: 46390173,
      developer: "Duolingo",
    });
  });

  it("handles a developer object shape + missing fields", () => {
    const listing = normalizePlayApp("com.x", {
      title: "X",
      developer: { devId: "Acme Inc" },
    });
    expect(listing.developer).toBe("Acme Inc");
    expect(listing.rating).toBeNull();
    expect(listing.ratingCount).toBeNull();
    expect(listing.screenshotUrls).toEqual([]);
    expect(listing.url).toBe(
      "https://play.google.com/store/apps/details?id=com.x"
    );
  });
});

describe("storeListingToContext", () => {
  it("renders a compact prompt block, omitting null fields", () => {
    const block = storeListingToContext({
      source: "app_store",
      storeId: "1",
      url: "https://apps.apple.com/app/id1",
      name: "Acme",
      description: "Does things.",
      category: "Productivity",
      rating: 4.5,
      ratingCount: 100,
      screenshotUrls: [],
      developer: null,
    });
    expect(block).toContain("Apple App Store");
    expect(block).toContain("App name: Acme");
    expect(block).toContain("Category: Productivity");
    expect(block).toContain("Rating: 4.50 (100 ratings)");
    expect(block).toContain("Does things.");
    expect(block).not.toContain("Developer:");
  });
});
