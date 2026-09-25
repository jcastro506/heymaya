/**
 * W1: where "Get the app" goes. Categories: fail-closed (a malformed or http link is never
 * used), adversarial input (campaign names and ids from a URL), sibling coherence (the label
 * matches the destination).
 */
import { describe, expect, it } from "vitest";
import { appLink, campaignToken, ctaLabel, joinDestination } from "../appLink";

const STORE = "https://apps.apple.com/us/app/maya/id6740000000";

describe("appLink", () => {
  it("prefers the App Store, then TestFlight, then nothing", () => {
    expect(appLink({ NEXT_PUBLIC_APP_STORE_URL: STORE, NEXT_PUBLIC_TESTFLIGHT_URL: "https://testflight.apple.com/join/abc" })).toEqual({ kind: "store", url: STORE, appId: "6740000000" });
    expect(appLink({ NEXT_PUBLIC_TESTFLIGHT_URL: "https://testflight.apple.com/join/abc" })).toEqual({ kind: "beta", url: "https://testflight.apple.com/join/abc" });
    expect(appLink({})).toEqual({ kind: "none" });
  });

  it("never uses a link that isn't https (fail-closed)", () => {
    expect(appLink({ NEXT_PUBLIC_APP_STORE_URL: "javascript:alert(1)" })).toEqual({ kind: "none" });
    expect(appLink({ NEXT_PUBLIC_TESTFLIGHT_URL: "http://testflight.apple.com/join/abc" })).toEqual({ kind: "none" });
  });

  it("an explicit app id wins, and a non-numeric one is dropped", () => {
    expect(appLink({ NEXT_PUBLIC_APP_STORE_URL: STORE, NEXT_PUBLIC_APP_STORE_ID: "id123" })).toMatchObject({ appId: "123" });
    expect(appLink({ NEXT_PUBLIC_APP_STORE_URL: "https://apps.apple.com/app/maya", NEXT_PUBLIC_APP_STORE_ID: "x\"><script>" })).toMatchObject({ appId: null });
  });
});

describe("joinDestination", () => {
  it("carries the campaign token and provider token to the App Store", () => {
    const url = new URL(joinDestination(appLink({ NEXT_PUBLIC_APP_STORE_URL: STORE }), "tiktok-bio", { NEXT_PUBLIC_APP_STORE_PROVIDER_TOKEN: "118" }));
    expect(url.searchParams.get("ct")).toBe("tiktok-bio");
    expect(url.searchParams.get("pt")).toBe("118");
  });
  it("sends the beta to TestFlight and, with neither, the web sign-up", () => {
    expect(joinDestination({ kind: "beta", url: "https://testflight.apple.com/join/abc" }, "x", {})).toBe("https://testflight.apple.com/join/abc");
    expect(joinDestination({ kind: "none" }, "x", {})).toBe("/sign-up");
  });
});

describe("campaignToken (adversarial)", () => {
  it("keeps what App Store Connect accepts and drops the rest", () => {
    expect(campaignToken("TikTok Bio!!")).toBe("tiktok-bio");
    expect(campaignToken("<script>")).toBe("script");
    expect(campaignToken("a".repeat(90))).toHaveLength(40);
    expect(campaignToken("   ")).toBeNull();
    expect(campaignToken(null)).toBeNull();
  });
});

describe("ctaLabel (sibling coherence)", () => {
  it("names the place the button goes", () => {
    expect(ctaLabel({ kind: "store", url: STORE, appId: null })).toMatch(/App Store/);
    expect(ctaLabel({ kind: "beta", url: "https://testflight.apple.com/join/abc" })).toMatch(/beta/);
    expect(ctaLabel({ kind: "none" })).not.toMatch(/App Store/);
  });
});
